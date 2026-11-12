//! Construction of the approved closed v3 subset. No result signature, new
//! codec, discarded evidence or changes to a pre-existing document.
use super::*;
use nomina_fiscal_package::{canonical,hashes};
use serde_json::{Value,json};
#[derive(Clone)]pub(super) struct LocalStamp{pub date:String,pub time:String,pub offset:i64}
pub(super) fn local_stamp(utc:&str)->Result<LocalStamp>{
 if !nomina_fiscal_package::time::instant(utc){return Err(fail("INVALID_NATIVE_TIME"));}
 #[cfg(windows)]{
  #[repr(C)]#[derive(Default)]struct SystemTime{year:u16,month:u16,weekday:u16,day:u16,hour:u16,minute:u16,second:u16,millis:u16}
  #[link(name="kernel32")]unsafe extern "system"{fn SystemTimeToTzSpecificLocalTime(zone:*const std::ffi::c_void,utc:*const SystemTime,local:*mut SystemTime)->i32;}
  let n=|r:std::ops::Range<usize>|utc[r].parse::<u16>().map_err(|_|fail("INVALID_NATIVE_TIME"));let input=SystemTime{year:n(0..4)?,month:n(5..7)?,day:n(8..10)?,hour:n(11..13)?,minute:n(14..16)?,second:n(17..19)?,..Default::default()};let mut out=SystemTime::default();
  if unsafe{SystemTimeToTzSpecificLocalTime(std::ptr::null(),&input,&mut out)}==0{return Err(fail("NATIVE_TIMEZONE_UNAVAILABLE"));}let local=format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",out.year,out.month,out.day,out.hour,out.minute,out.second);let a=nomina_fiscal_package::time::seconds(&local).ok_or_else(||fail("INVALID_NATIVE_TIME"))?;let b=nomina_fiscal_package::time::seconds(utc).ok_or_else(||fail("INVALID_NATIVE_TIME"))?;let offset=(a-b)/60;if !(-840..=840).contains(&offset){return Err(fail("INVALID_NATIVE_TIME"));}return Ok(LocalStamp{date:local[..10].into(),time:local[11..19].into(),offset});
 }
 #[cfg(not(windows))]Ok(LocalStamp{date:utc[..10].into(),time:utc[11..19].into(),offset:0})
}
fn millis(utc:&str)->String{format!("{}.000Z",&utc[..19])}
pub(super) fn known_size(material:&str)->Result<usize>{let m=json::parse(material)?;let known=json!({"packageEnvelope":m["packageEnvelope"],"trustHeadEnvelope":m["trustHeadEnvelope"],"history":m["history"],"capture":m["capture"],"scenario":m["scenario"],"effectiveSets":m["context"]["effectiveSets"],"producer":serde_json::from_str::<Value>(include_str!("../../../src/features/documents/document-producer-v3.json")).map_err(|_|fail("UNAVAILABLE"))?});let size=canonical::bytes(&known).map_err(|_|fail("SERIALIZATION_ERROR"))?.len();if size>RESULT_MAX{return Err(fail("INITIAL_DOCUMENT_TOO_LARGE"));}Ok(size)}
pub(super) fn build(material:&str,result:&str,completed:&str,start:&LocalStamp,end:&LocalStamp,reference_mode:&str)->Result<String>{
 let mut m=json::parse(material)?;let mut r=json::parse(result)?;let outcome=r.as_object_mut().ok_or_else(||fail("INVALID_RESULT_JSON"))?.remove("outcome").ok_or_else(||fail("INVALID_RESULT_JSON"))?;
 let ctx=m["context"].clone();let root=m.as_object_mut().ok_or_else(||fail("INVALID_MATERIAL"))?;let package=root.remove("packageEnvelope").ok_or_else(||fail("INVALID_MATERIAL"))?;let head=root.remove("trustHeadEnvelope").ok_or_else(||fail("INVALID_MATERIAL"))?;let history=root.remove("history").ok_or_else(||fail("INVALID_MATERIAL"))?;let capture=root.remove("capture").ok_or_else(||fail("INVALID_MATERIAL"))?;let scenario=root.remove("scenario").ok_or_else(||fail("INVALID_MATERIAL"))?;
 let descriptor:Value=serde_json::from_str(include_str!("../../../src/features/documents/document-producer-v3.json")).map_err(|_|fail("UNAVAILABLE"))?;let identity:Value=serde_json::from_str(include_str!("../../../src/features/storage/build-identity.json")).map_err(|_|fail("UNAVAILABLE"))?;
 if ctx["motorIdentity"]!=identity["engineVersion"]{return Err(fail("ENGINE_IDENTITY_MISMATCH"));}let signed=&package["signed"];let manifest=&signed["manifest"];let inverse=ctx["operation"]=="net-to-gross";let forward=if inverse{&outcome["report"]["recommendedForwardResult"]}else{&outcome["report"]};let mut policies=forward["provenance"]["policyVersions"].as_array().ok_or_else(||fail("DOCUMENT_NOT_REPRESENTABLE"))?.clone();if inverse{policies.push(json!({"component":"net-to-gross","version":outcome["report"]["provenance"]["policyVersion"]}));}
 let keys=|purpose:&str|package["signatures"].as_array().map(|a|a.iter().filter(|s|s["protected"]["purpose"]==purpose).map(|s|s["protected"]["keyId"].clone()).collect::<Vec<_>>()).unwrap_or_default();let prepared=ctx["verifiedAt"].as_str().ok_or_else(||fail("INVALID_NATIVE_TIME"))?;
 let snapshot=json!({"schemaVersion":3,"documentKind":"execution-record","completion":"result","executionId":m["executionId"],"capture":capture,
  "execution":{"requestId":m["requestId"],"consultationLocalDate":start.date,"referenceMode":reference_mode,"fiscalDate":ctx["fiscalDate"],"preparedAt":millis(prepared),"startedAt":millis(prepared),"completedAt":millis(completed),"completedLocalDate":end.date,"completedLocalTime":end.time,"utcOffsetMinutes":end.offset,"packageId":ctx["packageId"]},
  "outcome":outcome,"versions":{"application":identity["applicationVersion"],"engine":ctx["motorIdentity"]},
  "fiscalPackage":{"id":ctx["packageId"],"version":ctx["parameterVersion"],"sha256":ctx["contentSha256"],"hashScheme":manifest["contentIdentity"]["scheme"],"exercise":ctx["exercise"],"supportedDates":manifest["supportedDates"],"parameterSchemaId":manifest["parameterSchemaId"],"containerIdentity":{"sha256":ctx["envelopeSha256"],"payloadSha256":ctx["payloadSha256"],"byteLength":canonical::bytes(&package).map_err(|_|fail("SERIALIZATION_ERROR"))?.len()},"verification":{"origin":"external-signed","basis":"historical-observation","currentTrust":"not-checked"}},
  "executionProvenance":{"schemaVersion":1,"producerId":descriptor["producerId"],"reportContractId":descriptor["reportContractId"],"presentationContractId":descriptor["presentationContractId"],"resolution":{"exercise":ctx["exercise"],"fiscalDate":ctx["fiscalDate"],"periodicity":ctx["periodicity"],"operation":ctx["operation"],"simulationProfileId":ctx["simulationProfile"],"ruleProfileId":ctx["ruleProfile"],"contextualPolicyId":ctx["contextualPolicy"]},"requestScenario":scenario,"verificationObservation":{"verifiedAt":prepared,"rootVersion":ctx["rootVersion"],"trustEpoch":ctx["trustEpoch"],"publishingKeys":keys("package"),"approvalKeys":keys("content-approval"),"evidenceScope":descriptor["evidenceScope"],"currentTrust":"not-checked"},"authorizationObservation":{"kind":"native-observation-v1","nativeExecutionId":m["executionId"],"installationId":ctx["selection"]["installationId"],"admissionId":ctx["selection"]["admissionId"],"selectionId":ctx["selection"]["id"],"selectionGeneration":ctx["selection"]["generation"],"operation":ctx["operation"],"authorizedOperations":ctx["authorizedOperations"]},"policyVersions":policies},
  "fiscalEvidence":{"representation":descriptor["representation"],"trustEnvelopeSha256":ctx["trustHeadSha256"],"trustPayloadSha256":hashes::canonical_hash(&head["signed"]).map_err(|_|fail("SERIALIZATION_ERROR"))?,"packageEnvelope":package,"trustHeadEnvelope":head,"history":history},
  "effectiveContext":{"registryVersion":ctx["parameterVersion"],"conventionsId":ctx["simulationProfile"],"ruleSourcesRef":"fiscalEvidence.packageEnvelope.signed.ruleSources","sets":ctx["effectiveSets"]}});
 let bytes=canonical::bytes(&json!({"codec":"nomina-json-v1","value":snapshot})).map_err(|_|fail("SERIALIZATION_ERROR"))?;if bytes.len()>RESULT_MAX{return Err(fail("DOCUMENT_TOO_LARGE"));}let payload=String::from_utf8(bytes).map_err(|_|fail("SERIALIZATION_ERROR"))?;crate::storage::StorageService::validate_finalized_document(&payload).map_err(|_|fail("DOCUMENT_NOT_REPRESENTABLE"))?;Ok(payload)
}

pub(super) fn known_size_bound(material:&str,contract:DocumentContract)->Result<usize>{
 if contract==DocumentContract::LegacyV3{return known_size(material);}
 let m=json::parse(material)?;
 if m["context"]["documentContract"]!=contract.binding(){return Err(fail("DOCUMENT_CONTRACT_MISMATCH"));}
 let known=canonical::bytes(&json!({"material":m,"producer":contract.binding()})).map_err(|_|fail("SERIALIZATION_ERROR"))?.len();
 if known>RESULT_MAX{return Err(fail("INITIAL_DOCUMENT_TOO_LARGE"));}Ok(known)
}

pub(super) fn build_bound(contract:DocumentContract,material:&str,result:&str,completed:&str,start:&LocalStamp,end:&LocalStamp,reference_mode:&str)->Result<String>{
 if contract==DocumentContract::LegacyV3{return build(material,result,completed,start,end,reference_mode);}
 let m=json::parse(material)?;let r=json::parse(result)?;let ctx=&m["context"];let outcome=&r["outcome"];let report=&outcome["report"];
 if ctx["documentContract"]!=contract.binding()||ctx["version"]!=contract.version()||m["version"]!=contract.version(){return Err(fail("DOCUMENT_CONTRACT_MISMATCH"));}
 if r["capture"]!=m["capture"]||r["scenario"]!=m["scenario"]||r["contextSha256"]!=hashes::canonical_hash(ctx).map_err(|_|fail("SERIALIZATION_ERROR"))?{return Err(fail("RESULT_CONTEXT_MISMATCH"));}
 if r["executionId"]!=m["executionId"]||r["materialSha256"]!=hashes::sha256(material.as_bytes()){return Err(fail("RESULT_CONTEXT_MISMATCH"));}
 let descriptor:Value=serde_json::from_str(include_str!("../../../src/features/documents/document-producer-compat-v1.json")).map_err(|_|fail("UNAVAILABLE"))?;
 let binding=contract.binding();for key in ["producerId","reportContractId","presentationContractId"]{if descriptor[key]!=binding[key]{return Err(fail("DOCUMENT_CONTRACT_MISMATCH"));}}
 let identity:Value=serde_json::from_str(include_str!("../../../src/features/storage/build-identity.json")).map_err(|_|fail("UNAVAILABLE"))?;
 if ctx["motorIdentity"]!=identity["engineVersion"]{return Err(fail("ENGINE_IDENTITY_MISMATCH"));}
 let inverse=ctx["operation"]=="net-to-gross";let forward=if inverse{&report["recommendedForwardResult"]}else{report};
 let observed_policies=if forward.is_object(){&forward["provenance"]["policyVersions"]}else{&report["provenance"]["forwardPolicyVersions"]};
 let mut policies=observed_policies.as_array().ok_or_else(||fail("DOCUMENT_NOT_REPRESENTABLE"))?.clone();
 if inverse{policies.push(json!({"component":"net-to-gross","version":report["provenance"]["policyVersion"]}));}
 let parameter_versions=if inverse{Value::Null}else{report["provenance"]["parameterSetVersions"].clone()};
 let forward_policies=if inverse{report["provenance"]["forwardPolicyVersions"].clone()}else{report["provenance"]["policyVersions"].clone()};
 let evaluations=if inverse{report["metrics"]["directEvaluations"].clone()}else{Value::Null};
 let availability=if parameter_versions.is_null()&&forward_policies.is_null()&&evaluations.is_null(){"not-reported"}else{"reported"};
 let package=&m["packageEnvelope"];let head=&m["trustHeadEnvelope"];let manifest=&package["signed"]["manifest"];
 let keys=|purpose:&str|package["signatures"].as_array().map(|a|a.iter().filter(|s|s["protected"]["purpose"]==purpose).map(|s|s["protected"]["keyId"].clone()).collect::<Vec<_>>()).unwrap_or_default();
 let prepared=ctx["verifiedAt"].as_str().ok_or_else(||fail("INVALID_NATIVE_TIME"))?;
 let snapshot=json!({"schemaVersion":3,"documentKind":"execution-record","completion":"result","executionId":m["executionId"],"capture":m["capture"],
  "execution":{"requestId":m["requestId"],"consultationLocalDate":start.date,"referenceMode":reference_mode,"fiscalDate":ctx["fiscalDate"],"preparedAt":millis(prepared),"startedAt":millis(prepared),"completedAt":millis(completed),"completedLocalDate":end.date,"completedLocalTime":end.time,"utcOffsetMinutes":end.offset,"packageId":ctx["packageId"]},
  "outcome":outcome,"versions":{"application":identity["applicationVersion"],"engine":ctx["motorIdentity"]},
  "fiscalPackage":{"id":ctx["packageId"],"version":ctx["parameterVersion"],"sha256":ctx["contentSha256"],"hashScheme":manifest["contentIdentity"]["scheme"],"exercise":ctx["exercise"],"supportedDates":manifest["supportedDates"],"parameterSchemaId":manifest["parameterSchemaId"],"containerIdentity":{"sha256":ctx["envelopeSha256"],"payloadSha256":ctx["payloadSha256"],"byteLength":canonical::bytes(package).map_err(|_|fail("SERIALIZATION_ERROR"))?.len()},"verification":{"origin":"external-signed","basis":"historical-observation","currentTrust":"not-checked"}},
  "executionProvenance":{"schemaVersion":1,"producerId":descriptor["producerId"],"reportContractId":descriptor["reportContractId"],"presentationContractId":descriptor["presentationContractId"],"resolution":{"exercise":ctx["exercise"],"fiscalDate":ctx["fiscalDate"],"periodicity":ctx["periodicity"],"operation":ctx["operation"],"simulationProfileId":ctx["simulationProfile"],"ruleProfileId":ctx["ruleProfile"],"contextualPolicyId":ctx["contextualPolicy"]},"requestScenario":m["scenario"],"verificationObservation":{"verifiedAt":prepared,"rootVersion":ctx["rootVersion"],"trustEpoch":ctx["trustEpoch"],"publishingKeys":keys("package"),"approvalKeys":keys("content-approval"),"evidenceScope":descriptor["evidenceScope"],"currentTrust":"not-checked"},"authorizationObservation":{"kind":"native-observation-v1","nativeExecutionId":m["executionId"],"installationId":ctx["selection"]["installationId"],"admissionId":ctx["selection"]["admissionId"],"selectionId":ctx["selection"]["id"],"selectionGeneration":ctx["selection"]["generation"],"operation":ctx["operation"],"authorizedOperations":ctx["authorizedOperations"]},"policyVersions":policies},
  "fiscalEvidence":{"representation":descriptor["representation"],"trustEnvelopeSha256":ctx["trustHeadSha256"],"trustPayloadSha256":hashes::canonical_hash(&head["signed"]).map_err(|_|fail("SERIALIZATION_ERROR"))?,"packageEnvelope":package,"trustHeadEnvelope":head,"history":m["history"]},
  "effectiveContext":{"registryVersion":ctx["parameterVersion"],"conventionsId":ctx["simulationProfile"],"ruleSourcesRef":"fiscalEvidence.packageEnvelope.signed.ruleSources","sets":ctx["effectiveSets"],"evaluationObservation":{"basis":"report-not-attested","availability":availability,"reportedParameterSetVersions":parameter_versions,"reportedForwardPolicyVersions":forward_policies,"reportedDirectEvaluations":evaluations}}});
 let bytes=canonical::bytes(&json!({"codec":"nomina-json-v1","value":snapshot})).map_err(|_|fail("SERIALIZATION_ERROR"))?;
 if bytes.len()>RESULT_MAX{return Err(fail("DOCUMENT_TOO_LARGE"));}
 let payload=String::from_utf8(bytes).map_err(|_|fail("SERIALIZATION_ERROR"))?;
 crate::storage::StorageService::validate_readonly_finalization(&payload).map_err(|_|fail("DOCUMENT_NOT_REPRESENTABLE"))?;Ok(payload)
}
