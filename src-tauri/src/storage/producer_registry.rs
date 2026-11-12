//! Immutable embedded v2 readers, separate from the active writer selection.
//! App version, parameter revision and producer ID are independent pins.
use super::{failure, StoreError};
use serde_json::Value;

const HISTORICAL_2026: &str = include_str!("../../../src/infrastructure/fiscal/document-producer.json");
const POLICY: &str = include_str!("../../../src/infrastructure/fiscal/embedded-document-policy.json");
const RELEASE_011_RC1: &str = include_str!("../../../src/infrastructure/fiscal/document-producer-0.1.1-rc.1.json");

fn current_descriptor() -> Result<Value, StoreError> {
    let mut d: Value = serde_json::from_str(HISTORICAL_2026).map_err(|_|failure("UNAVAILABLE"))?;
    let release: Value = serde_json::from_str(RELEASE_011_RC1).map_err(|_|failure("UNAVAILABLE"))?;
    if release["baseProducerId"] != d["producerId"] || release["baseDescriptorSha256"] != super::digest(HISTORICAL_2026.as_bytes())
        || release["producerId"] == d["producerId"] { return Err(failure("UNAVAILABLE")); }
    d["producerId"] = release["producerId"].clone();
    d["versions"]["application"] = release["applicationVersion"].clone();
    Ok(d)
}

pub(super) fn assert_snapshot(s: &Value, inserting: bool) -> Result<(), StoreError> {
    // Append future descriptors here; never replace the bytes of historical ones.
    let known = [serde_json::from_str(HISTORICAL_2026).map_err(|_| failure("UNAVAILABLE"))?, current_descriptor()?];
    let policy: Value = serde_json::from_str(POLICY).map_err(|_| failure("UNAVAILABLE"))?;
    assert_with_catalog(s, inserting, &known, &policy["activeProducerIds"])
}

fn assert_with_catalog(s: &Value, inserting: bool, known: &[Value], active: &Value) -> Result<(), StoreError> {
    let ids = active.as_array().ok_or_else(||failure("UNAVAILABLE"))?;
    let mut unique = std::collections::BTreeSet::new();
    let mut writers: Vec<&Value> = vec![];
    for id in ids {
        if !unique.insert(id.as_str().ok_or_else(||failure("UNAVAILABLE"))?) { return Err(failure("UNAVAILABLE")); }
        let found: Vec<_> = known.iter().filter(|d|d["producerId"]==*id).collect();
        if found.len()!=1 { return Err(failure("UNAVAILABLE")); }
        let a=found[0];
        for b in &writers {
            if a["manifest"]["exercise"]==b["manifest"]["exercise"] && a["authorization"]["simulationProfileId"]==b["authorization"]["simulationProfileId"]
                && a["manifest"]["supportedDates"]["from"].as_str()<=b["manifest"]["supportedDates"]["through"].as_str()
                && b["manifest"]["supportedDates"]["from"].as_str()<=a["manifest"]["supportedDates"]["through"].as_str() { return Err(failure("UNAVAILABLE")); }
        }
        writers.push(a);
    }
    let p = &s["executionProvenance"]; let r = &p["resolution"]; let package = &s["fiscalPackage"];
    let matches: Vec<_> = known.iter().filter(|d| d["producerId"] == p["producerId"]).collect();
    if matches.len() != 1 { return Err(failure("INCOMPATIBLE_SCHEMA")); }
    let d = matches[0]; let m = &d["manifest"];
    if p["schemaVersion"] != 1 || p["reportContractId"] != d["reportContractId"] || p["presentationContractId"] != d["presentationContractId"] {
        return Err(failure("INCOMPATIBLE_SCHEMA"));
    }
    if inserting && !active.as_array().map(|ids| ids.contains(&p["producerId"])).unwrap_or(false) { return Err(failure("INVALID_SNAPSHOT")); }
    if p["versions"] != d["versions"] || p["authorization"] != d["authorization"] || p["sourceCatalog"] != m["sources"] || p["ruleSources"] != d["ruleSources"]
        || r["packageRegistryRevision"] != d["packageRegistryRevision"] || r["capabilityRegistryVersion"] != d["capabilityRegistryVersion"]
        || package["id"] != m["packageId"] || package["version"] != m["parameterVersion"] || package["hashScheme"] != m["contentIdentity"]["scheme"]
        || package["sha256"] != m["contentIdentity"]["sha256"] || package["supportedDates"] != m["supportedDates"] || package["exercise"] != m["exercise"] || package["parameterSchemaId"] != m["parameterSchemaId"]
        || r["simulationProfileId"] != d["authorization"]["simulationProfileId"] || r["ruleProfileId"] != d["authorization"]["ruleProfileId"] || r["contextualPolicyId"] != d["authorization"]["contextualPolicyId"]
        || !d["authorization"]["periodicities"].as_array().map(|a|a.contains(&r["periodicity"])).unwrap_or(false) { return Err(failure("INVALID_SNAPSHOT")); }
    let date = r["fiscalDate"].as_str().ok_or_else(||failure("INVALID_SNAPSHOT"))?;
    if date < m["supportedDates"]["from"].as_str().unwrap_or("") || date > m["supportedDates"]["through"].as_str().unwrap_or("") { return Err(failure("INVALID_SNAPSHOT")); }
    let expected: Vec<Value> = d["effectiveSeries"].as_array().ok_or_else(||failure("UNAVAILABLE"))?.iter().filter(|set|set["effectiveFrom"].as_str().map(|s|s<=date).unwrap_or(false)
        && (set["effectiveThrough"].is_null() || set["effectiveThrough"].as_str().map(|s|date<=s).unwrap_or(false)) && (set["role"]!="isrTariff" || set["key"]==r["periodicity"])).cloned().collect();
    if p["effectiveParameterSets"] != Value::Array(expected) { return Err(failure("INVALID_SNAPSHOT")); }
    Ok(())
}

#[cfg(test)]
#[path = "simple2_tests.rs"]
mod simple2_tests;

#[cfg(test)]
#[test]
fn final1_app_only_release_keeps_old_reader_and_changes_only_writer_identity() {
    let old: Value = serde_json::from_str(HISTORICAL_2026).unwrap();
    let current = current_descriptor().unwrap();
    assert_eq!(current["versions"]["application"], "0.1.1-rc.1");
    let mut restored = current.clone();
    restored["producerId"] = old["producerId"].clone();
    restored["versions"] = old["versions"].clone();
    assert_eq!(restored, old);
    let cases: Vec<Value> = serde_json::from_str(include_str!("fixtures-v2.json")).unwrap();
    for case in cases {
        let payload = case["payload"].as_str().unwrap();
        let wire: Value = serde_json::from_str(payload).unwrap();
        let mut s = wire["value"].clone();
        s["versions"] = old["versions"].clone();
        s["executionProvenance"]["versions"] = old["versions"].clone();
        s["executionProvenance"]["producerId"] = old["producerId"].clone();
        let old_wire = serde_json::json!({"codec":"nomina-json-v1","value":s}).to_string();
        assert!(super::validate_snapshot_for_read(&old_wire).is_ok());
        assert!(assert_snapshot(&s, true).is_err());
        assert!(super::validate_snapshot(&old_wire, false).is_ok());
        let mut current_s = wire["value"].clone();
        current_s["versions"] = current["versions"].clone();
        current_s["executionProvenance"]["versions"] = current["versions"].clone();
        current_s["executionProvenance"]["producerId"] = current["producerId"].clone();
        let new_wire = serde_json::json!({"codec":"nomina-json-v1","value":current_s}).to_string();
        assert!(super::validate_snapshot(&new_wire, true).is_ok());
        assert!(assert_snapshot(&current_s, true).is_ok());
    }
}
