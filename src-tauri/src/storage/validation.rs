use super::{failure, StoreError};
use serde_json::Value;
use sha2::{Digest, Sha256};
use uuid::Uuid;
#[path = "producer_registry.rs"]
mod producer_registry;

pub const MAX_PAYLOAD: usize = 3 * 1024 * 1024;
pub const BUILD_IDENTITY: &str = include_str!("../../../src/features/storage/build-identity.json");
pub fn digest(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }
pub fn uuid(value: &str) -> bool { Uuid::parse_str(value).map(|id| id.get_version_num() == 4 && id.to_string() == value).unwrap_or(false) }
pub fn civil(value: &str) -> bool {
    if !value.is_ascii() || value.len() != 10 || &value[4..5] != "-" || &value[7..8] != "-" || !value.bytes().enumerate().all(|(i,b)| i == 4 || i == 7 || b.is_ascii_digit()) { return false; }
    let y = value[..4].parse::<u32>().unwrap_or(0); let m = value[5..7].parse::<usize>().unwrap_or(0); let d = value[8..].parse::<u32>().unwrap_or(0);
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let days = [31, if leap {29} else {28},31,30,31,30,31,31,30,31,30,31];
    y > 0 && (1..=12).contains(&m) && d > 0 && d <= days[m-1]
}
pub fn instant(value: &str) -> bool {
    if !value.is_ascii() || value.len() != 24 || !civil(&value[..10]) { return false; }
    let b = value.as_bytes();
    b[10] == b'T' && b[13] == b':' && b[16] == b':' && b[19] == b'.' && b[23] == b'Z'
        && [11..13,14..16,17..19,20..23].iter().all(|r| value[r.clone()].bytes().all(|b| b.is_ascii_digit()))
        && value[11..13].parse::<u32>().unwrap_or(99) < 24 && value[14..16].parse::<u32>().unwrap_or(99) < 60 && value[17..19].parse::<u32>().unwrap_or(99) < 60
}
fn local_time(value:&str)->bool {
    value.is_ascii() && value.len()==8 && value.as_bytes()[2]==b':' && value.as_bytes()[5]==b':'
        && [0..2,3..5,6..8].iter().all(|r|value[r.clone()].bytes().all(|b|b.is_ascii_digit()))
        && value[0..2].parse::<u32>().unwrap_or(99)<24 && value[3..5].parse::<u32>().unwrap_or(99)<60 && value[6..8].parse::<u32>().unwrap_or(99)<60
}
pub fn decimal(value: &str, max_fraction: usize) -> bool {
    let value = value.strip_prefix('-').unwrap_or(value);
    if value.is_empty() || value.len() > 256 { return false; }
    let parts: Vec<_> = value.split('.').collect();
    parts.len() <= 2 && !parts[0].is_empty() && parts[0].bytes().all(|b| b.is_ascii_digit())
        && (parts.len() == 1 || (!parts[1].is_empty() && parts[1].len() <= max_fraction && parts[1].bytes().all(|b| b.is_ascii_digit())))
}
fn text<'a>(v: &'a Value, key: &str) -> Result<&'a str, StoreError> { v.get(key).and_then(Value::as_str).ok_or_else(|| failure("INVALID_SNAPSHOT")) }
fn money(v: &Value) -> bool { v.is_null() || v.as_str().map(|s| decimal(s, 2)).unwrap_or(false) }
fn scalar_tree(v: &Value, depth: usize) -> bool {
    if depth > 96 { return false; }
    match v {
        Value::Array(a) => a.iter().all(|v| scalar_tree(v, depth+1)),
        Value::Object(o) => o.iter().all(|(key,v)| {
            // No se aceptan floats/números en campos monetarios. Los contadores y
            // métricas del reporte sí mantienen su tipo numérico de metadatos.
            let monetary = matches!(key.as_str(), "amount" | "gross" | "net" | "grossPeriodSalary" | "targetNet" | "recommendedGross" | "obtainedNet" | "difference" | "absoluteDifference" | "isrByTariff" | "estimatedSbc");
            (!monetary || v.is_object() || money(v)) && scalar_tree(v, depth+1)
        }),
        Value::Number(n) => n.as_i64().map(|n| n.unsigned_abs() <= 9_007_199_254_740_991).or_else(|| n.as_u64().map(|n| n <= 9_007_199_254_740_991)).unwrap_or_else(|| n.as_f64().map(|n| n.is_finite() && n.abs() <= 9_007_199_254_740_991.0).unwrap_or(false)),
        _ => true,
    }
}

pub struct SnapshotIndex {
    pub execution_id: String, pub completed_at: String, pub direction: String, pub requested_amount: String,
    pub periodicity: String, pub reference_date: String, pub classification: String,
    pub gross: Option<String>, pub net: Option<String>, pub package_sha: String,
    pub snapshot_version: i64,
}
/// Explicit reader capability. The legacy entry below remains the boundary
/// for insertion, finalization, authority, reconciliation and backup checks.
/// Do not route those callers through this function in CD-2.
pub fn validate_snapshot_for_read(payload:&str)->Result<SnapshotIndex,StoreError>{
    if payload.len()>MAX_PAYLOAD{return Err(failure("INVALID_SNAPSHOT"));}
    super::budget_v3::scan(payload)?;
    let peek:Value=serde_json::from_str(payload).map_err(|_|failure("INVALID_SNAPSHOT"))?;
    let ids=&peek["value"]["executionProvenance"];
    let reserved=ids["producerId"]=="nomina-signed-fiscal-document-v3-v2"
        ||ids["reportContractId"]=="standard-payroll-2026-contextual-document-compat-v1"
        ||ids["presentationContractId"]=="nomina-presentation-document-compat-v1";
    if reserved&&peek["value"]["schemaVersion"]!=3{return Err(failure("INCOMPATIBLE_SCHEMA"));}
    if peek["value"]["schemaVersion"].as_i64()!=Some(3){return validate_snapshot(payload,false);}
    let wire=super::strict_json::parse(payload).map_err(|_|failure("INVALID_SNAPSHOT"))?;
    let s=&wire["value"];let p=&s["executionProvenance"];
    if s["schemaVersion"]!=3||p["schemaVersion"]!=1{return Err(failure("INCOMPATIBLE_SCHEMA"));}
    match(p["producerId"].as_str(),p["reportContractId"].as_str(),p["presentationContractId"].as_str()){
        (Some("nomina-signed-fiscal-document-v3-v1"),Some("standard-payroll-2026-contextual-v2"),Some("nomina-presentation-5c2-v1"))=>super::validation_v3::validate(wire),
        (Some("nomina-signed-fiscal-document-v3-v2"),Some("standard-payroll-2026-contextual-document-compat-v1"),Some("nomina-presentation-document-compat-v1"))=>{
            nomina_fiscal_package::canonical::require_wire(payload.as_bytes(),&wire).map_err(|_|failure("INVALID_COMPAT_ENCODING"))?;
            super::validation_compat_v1::validate(wire)
        },
        _=>Err(failure("INCOMPATIBLE_SCHEMA")),
    }
}
pub fn validate_snapshot(payload: &str, current_build: bool) -> Result<SnapshotIndex, StoreError> {
    if payload.len() > MAX_PAYLOAD { return Err(failure("INVALID_SNAPSHOT")); }
    super::budget_v3::scan(payload)?;
    let wire:Value=serde_json::from_str(payload).map_err(|_|failure("INVALID_SNAPSHOT"))?;
    match wire["value"]["schemaVersion"].as_i64() {
        Some(1) if !current_build => validate_v1(payload,false),
        Some(2) => validate_v2(super::strict_json::parse(payload).map_err(|_|failure("INVALID_SNAPSHOT"))?,current_build),
        Some(3) if current_build => Err(failure("V3_WRITE_CLOSED")),
        Some(3) => super::validation_v3::validate(super::strict_json::parse(payload).map_err(|_|failure("INVALID_SNAPSHOT"))?),
        Some(1) => Err(failure("INVALID_SNAPSHOT")), // new productive writes are v2 only
        _ => Err(failure("INCOMPATIBLE_SCHEMA")),
    }
}
pub(super) fn validate_v1(payload: &str, current_build: bool) -> Result<SnapshotIndex, StoreError> {
    if payload.len() > MAX_PAYLOAD { return Err(failure("INVALID_SNAPSHOT")); }
    let wire: Value = serde_json::from_str(payload).map_err(|_| failure("INVALID_SNAPSHOT"))?;
    if wire["codec"] != "nomina-json-v1" || wire.as_object().map(|o| o.len()) != Some(2) { return Err(failure("INCOMPATIBLE_SCHEMA")); }
    let s = &wire["value"];
    if s["schemaVersion"] != 1 { return Err(failure("INCOMPATIBLE_SCHEMA")); }
    let expected = ["schemaVersion","completion","executionId","capture","execution","outcome","versions","fiscalPackage"];
    if s.as_object().map(|o| o.len()) != Some(expected.len()) || !expected.iter().all(|k| s.get(k).is_some()) || s["completion"] != "result" || !scalar_tree(s,0) { return Err(failure("INVALID_SNAPSHOT")); }
    let id = text(s,"executionId")?;
    let capture = &s["capture"]; let form = &capture["form"]; let execution = &s["execution"]; let outcome = &s["outcome"]; let report = &outcome["report"]; let p = &outcome["presentation"];
    let direction = text(form,"mode")?; let amount = text(form,"amount")?; let period = text(form,"period")?; let reference = text(form,"effectiveDate")?; let completed = text(execution,"completedAt")?;
    if !uuid(id) || capture["area"] != "general-zone" || !["gross-to-net","net-to-gross"].contains(&direction) || !["weekly","fortnightly","monthly"].contains(&period)
        || !decimal(amount,2) || amount.starts_with('-') || !amount.bytes().any(|b| (b'1'..=b'9').contains(&b)) || !civil(reference) || !instant(completed)
        || execution["fiscalDate"] != reference || !matches!(execution["referenceMode"].as_str(), Some("automatic"|"manual")) || !form["includeImss"].is_boolean()
        || !execution["requestId"].as_u64().map(|n| n > 0).unwrap_or(false) || !instant(text(execution,"startedAt")?) || !instant(text(execution,"preparedAt")?)
        || !civil(text(execution,"consultationLocalDate")?) || !civil(text(execution,"completedLocalDate")?) || !local_time(text(execution,"completedLocalTime")?) || !execution["utcOffsetMinutes"].as_i64().map(|n|(-840..=840).contains(&n)).unwrap_or(false)
    { return Err(failure("INVALID_SNAPSHOT")); }
    for key in ["bonusDays","vacationDays","vacationPremium"] { let v = text(form,key)?; if !decimal(v,64) || v.starts_with('-') { return Err(failure("INVALID_SNAPSHOT")); } }
    let direct = direction == "gross-to-net";
    if outcome["kind"] != if direct {"direct"} else {"inverse"} || report["operation"] != direction || p["kind"] != outcome["kind"] || report["status"] != "estimated" { return Err(failure("INVALID_SNAPSHOT")); }
    let forward = if direct { report } else { &report["recommendedForwardResult"] };
    if forward["status"] != "estimated" || forward["complete"] != true || forward["reconciliationVerified"] != true || !forward["net"]["amount"].is_string() || !forward["gross"]["amount"].is_string() { return Err(failure("INVALID_SNAPSHOT")); }
    if p["values"]["grossSalary"] != forward["gross"]["amount"] || p["values"]["netSalary"] != forward["net"]["amount"] || p["values"]["isr"] != forward["isr"]["withheld"]["amount"] || p["values"]["workerImss"] != forward["imss"]["deducted"]["amount"] { return Err(failure("INVALID_SNAPSHOT")); }
    for key in ["grossSalary","netSalary","workerImss","taxableIncome","isr","employmentSubsidy","dailySalary","integratedDailySalary","contributionBaseSalary","integratedVariableIncome"] {
        if p["values"].get(key).is_none() || !money(&p["values"][key]) { return Err(failure("INVALID_SNAPSHOT")); }
    }
    if !direct && (report["recommended"].is_null() || !matches!(report["match"].as_str(), Some("exact"|"approximate")) || report["metrics"]["stopReason"] == "aborted" || report["targetNet"] != p["inverse"]["targetNet"] || report["recommended"]["gross"] != forward["gross"]["amount"]) { return Err(failure("INVALID_SNAPSHOT")); }
    for key in ["isr","subsidy","imss","integration","sbc","provenance","warnings","issues"] { if forward.get(key).is_none() { return Err(failure("INVALID_SNAPSHOT")); } }
    if !report["warnings"].is_array() && direct { return Err(failure("INVALID_SNAPSHOT")); }
    let package = &s["fiscalPackage"]; let sha = text(package,"sha256")?;
    if sha.len() != 64 || !sha.bytes().all(|c| c.is_ascii_hexdigit()) || text(package,"id")? != text(execution,"packageId")? || text(package,"version")? != text(&report["provenance"],"fiscalPackageVersion")?
        || text(&s["versions"],"application")?.is_empty() || text(&s["versions"],"engine")?.is_empty() { return Err(failure("INVALID_SNAPSHOT")); }
    if current_build {
        let build: Value = serde_json::from_str(BUILD_IDENTITY).map_err(|_| failure("UNAVAILABLE"))?;
        if package["id"] != build["fiscalPackage"]["id"] || package["version"] != build["fiscalPackage"]["version"] || package["sha256"] != build["fiscalPackage"]["sha256"] || s["versions"]["engine"] != build["engineVersion"] || s["versions"]["application"] != build["applicationVersion"]
            || reference < build["fiscalPackage"]["supportedDates"]["from"].as_str().unwrap_or("") || reference > build["fiscalPackage"]["supportedDates"]["through"].as_str().unwrap_or("") { return Err(failure("INVALID_SNAPSHOT")); }
    }
    let conditioned = !p["confirmation"].is_null() || forward["retention"]["kind"] == "conditional-no-withholding-LISR-96" || (!direct && report["coverage"]["state"] == "fiscally-incomplete");
    let classification = if !direct && report["coverage"]["state"] == "limited" { "limited" } else if conditioned { "conditioned" } else if !direct && report["match"] == "approximate" { "approximate" } else if !direct { "exact" } else { "estimated" };
    Ok(SnapshotIndex { execution_id:id.into(), completed_at:completed.into(), direction:direction.into(), requested_amount:amount.into(), periodicity:period.into(), reference_date:reference.into(), classification:classification.into(), gross:forward["gross"]["amount"].as_str().map(str::to_string), net:forward["net"]["amount"].as_str().map(str::to_string), package_sha:sha.into(), snapshot_version:1 })
}

fn closed(v:&Value,keys:&[&str])->bool {v.as_object().map(|o|o.len()==keys.len()&&keys.iter().all(|k|o.contains_key(*k))).unwrap_or(false)}
fn policy_map(v:&Value)->Option<std::collections::BTreeMap<String,String>> {
    let mut result=std::collections::BTreeMap::new();
    for item in v.as_array()? {let key=item["component"].as_str()?.to_string();if result.insert(key,item["version"].as_str()?.to_string()).is_some(){return None;}}
    Some(result)
}
fn cents128(v:&Value)->Result<i128,StoreError>{
    let raw=v.as_str().ok_or_else(||failure("INVALID_SNAPSHOT"))?;if !decimal(raw,2){return Err(failure("INVALID_SNAPSHOT"));}
    let negative=raw.starts_with('-');let mut parts=raw.trim_start_matches('-').split('.');let whole=parts.next().unwrap_or("").parse::<i128>().map_err(|_|failure("INVALID_SNAPSHOT"))?;
    let fraction=parts.next().unwrap_or("");let padded=format!("{fraction:0<2}");let fraction=padded.parse::<i128>().map_err(|_|failure("INVALID_SNAPSHOT"))?;
    let value=whole.checked_mul(100).and_then(|n|n.checked_add(fraction)).ok_or_else(||failure("INVALID_SNAPSHOT"))?;
    if negative{value.checked_neg().ok_or_else(||failure("INVALID_SNAPSHOT"))}else{Ok(value)}
}
/** Documentary reconciliation in integer cents, not a second fiscal calculation. */
pub(super) fn reconcile_document(s:&Value,forward:&Value)->Result<(),StoreError>{
    let gross=cents128(&forward["gross"]["amount"])?;let net=cents128(&forward["net"]["amount"])?;let isr=cents128(&forward["isr"]["withheld"]["amount"])?;let imss=cents128(&forward["imss"]["deducted"]["amount"])?;
    if [gross,net,isr,imss].iter().any(|v|*v<0)||net.checked_add(isr).and_then(|v|v.checked_add(imss))!=Some(gross){return Err(failure("INVALID_SNAPSHOT"));}
    for (module,total,parts) in [("imss","calculated",["deducted","absorbedByEmployer","excludedBySimulation"]),("subsidy","determined",["applied","notAppliedDueToNoWithholding","excessOverTariffIsrNotDelivered"])]{
        let total=cents128(&forward[module][total]["amount"])?;let mut sum=0_i128;
        for key in parts{let amount=cents128(&forward[module][key]["amount"])?;if amount<0{return Err(failure("INVALID_SNAPSHOT"));}sum=sum.checked_add(amount).ok_or_else(||failure("INVALID_SNAPSHOT"))?;}
        if total!=sum{return Err(failure("INVALID_SNAPSHOT"));}
    }
    let requested=cents128(&s["capture"]["form"]["amount"])?;let report=&s["outcome"]["report"];
    if report["operation"]=="gross-to-net"{if requested!=gross{return Err(failure("INVALID_SNAPSHOT"));}}
    else {let candidate=&report["recommended"];let difference=net.checked_sub(requested).ok_or_else(||failure("INVALID_SNAPSHOT"))?;
        if cents128(&report["targetNet"])?!=requested||cents128(&candidate["gross"])?!=gross||cents128(&candidate["net"])?!=net||cents128(&candidate["difference"])?!=difference
            ||Some(cents128(&candidate["absoluteDifference"])? )!=difference.checked_abs()||(report["match"]=="exact"&&difference!=0)||(report["match"]=="approximate"&&difference==0){return Err(failure("INVALID_SNAPSHOT"));}
    }Ok(())
}
fn validate_v2(wire:Value, inserting:bool)->Result<SnapshotIndex,StoreError> {
    let s=&wire["value"]; let p=&s["executionProvenance"];let r=&p["resolution"];let package=&s["fiscalPackage"];let a=&p["authorization"];
    if !closed(s,&["schemaVersion","completion","executionId","capture","execution","outcome","versions","fiscalPackage","executionProvenance"])
        || !closed(p,&["schemaVersion","producerId","reportContractId","presentationContractId","versions","fiscalPackage","resolution","authorization","requestScenario","effectiveParameterSets","sourceCatalog","ruleSources"])
        || !closed(r,&["exercise","fiscalDate","periodicity","operation","simulationProfileId","ruleProfileId","contextualPolicyId","packageRegistryRevision","capabilityRegistryVersion"])
        || !closed(package,&["id","version","sha256","hashScheme","exercise","supportedDates","parameterSchemaId","containerIdentity","verification"])
        || p["schemaVersion"]!=1 || p["reportContractId"]!="standard-payroll-2026-contextual-v2" || p["presentationContractId"]!="nomina-presentation-5c2-v1" {return Err(failure("INCOMPATIBLE_SCHEMA"));}
    let form=&s["capture"]["form"];let report=&s["outcome"]["report"];
    if !civil(text(r,"fiscalDate")?) {return Err(failure("INVALID_SNAPSHOT"));}
    if s["versions"]!=p["versions"] || package!=&p["fiscalPackage"] || r["fiscalDate"]!=form["effectiveDate"] || r["periodicity"]!=form["period"] || r["operation"]!=form["mode"]
        || r["exercise"]!=package["exercise"] || r["exercise"].as_u64()!=text(r,"fiscalDate")?[..4].parse::<u64>().ok()
        || package["hashScheme"]!="legacy-registry-v1" || !package["containerIdentity"].is_null()
        || package["verification"]!=serde_json::json!({"origin":"embedded","data":"source-verified","basis":"embedded-build","integrity":"build-asserted"})
        || a["exercise"]!=r["exercise"] || a["simulationProfileId"]!=r["simulationProfileId"] || a["ruleProfileId"]!=r["ruleProfileId"] || a["contextualPolicyId"]!=r["contextualPolicyId"]
        || a["content"]["packageId"]!=package["id"] || a["content"]["parameterVersion"]!=package["version"] || a["content"]["sha256"]!=package["sha256"] || a["content"]["scheme"]!=package["hashScheme"]
        || a["parameterSchemaId"]!=package["parameterSchemaId"] || a["direct"]!=true || (r["operation"]=="net-to-gross"&&a["inverse"]!=true) {return Err(failure("INVALID_SNAPSHOT"));}
    let forward=if r["operation"]=="gross-to-net"{report}else{&report["recommendedForwardResult"]};
    let scenario=if r["operation"]=="gross-to-net"{&forward["retention"]["assessment"]["context"]}else{&report["provenance"]["retentionContext"]};
    if p["requestScenario"]!=*scenario || scenario["kind"]!="contextual-retention-2026-v2" || scenario["referenceMonth"].as_str()!=Some(&text(r,"fiscalDate")?[..7])
        || forward["retention"]["policyVersion"]!=r["contextualPolicyId"] {return Err(failure("INVALID_SNAPSHOT"));}
    let sets=p["effectiveParameterSets"].as_array().ok_or_else(||failure("INVALID_SNAPSHOT"))?;
    if sets.len()!=7 {return Err(failure("INVALID_SNAPSHOT"));}
    let mut roles=std::collections::BTreeSet::new();
    for set in sets {
        let role=text(set,"role")?;
        if !["isrTariff","uma","minimumWages","subsidy","imssConstants","contractualDivisors","laborBenefitMinima"].contains(&role) || !roles.insert(role)
            || text(set,"effectiveFrom")?>text(r,"fiscalDate")? || (!set["effectiveThrough"].is_null()&&text(set,"effectiveThrough")?<text(r,"fiscalDate")?)
            || set["validation"]!="source-verified" || set["validationScope"]!="source-data-only" || set["sources"].as_array().map(|a|a.is_empty()).unwrap_or(true)
            || !forward["provenance"]["parameterSetVersions"].as_array().map(|versions|versions.iter().any(|v|v["id"]==set["id"]&&v["version"]==set["version"])).unwrap_or(false) {return Err(failure("INVALID_SNAPSHOT"));}
    }
    let mut expected_policies=policy_map(&a["policyVersions"]).ok_or_else(||failure("INVALID_SNAPSHOT"))?;expected_policies.remove("net-to-gross");
    if policy_map(&forward["provenance"]["policyVersions"])!=Some(expected_policies) {return Err(failure("INVALID_SNAPSHOT"));}
    if r["operation"]=="net-to-gross" && report["provenance"]["policyVersion"]!="standard-net-to-gross-2026-contextual-partitions-v2" {return Err(failure("INVALID_SNAPSHOT"));}
    // Historical reads use their own compiled descriptor, never today's writer.
    producer_registry::assert_snapshot(s, inserting)?;
    // Reuse v1 structural/result checks on an in-memory projection only. Never
    // store/re-hash this projection: the caller keeps the original v2 bytes.
    let mut legacy=wire.clone();let original=legacy["value"].as_object_mut().ok_or_else(||failure("INVALID_SNAPSHOT"))?;
    original.remove("executionProvenance");original.insert("schemaVersion".into(),1.into());original.insert("fiscalPackage".into(),serde_json::json!({"id":package["id"],"version":package["version"],"sha256":package["sha256"]}));
    let mut index=validate_v1(&legacy.to_string(),false)?;reconcile_document(s,forward)?;index.snapshot_version=2;Ok(index)
}
