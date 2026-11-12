//! Closed persisted-document dispatch, never an authority constructor.
//! Historical validators remain literal. New writes still require DocumentPermit.
use super::*;

/// Only call on an already validated compat document. This is eligibility, not
/// proof that the report is mathematically honest or the document was committed.
pub(crate) fn compat_complete(s:&Value)->bool{
    let r=&s["outcome"]["report"];
    if r["status"]!="estimated"||!s["outcome"]["presentation"]["confirmation"].is_null(){return false;}
    let inverse=s["outcome"]["kind"]=="inverse";
    let forward=if inverse{&r["recommendedForwardResult"]}else{r};
    if forward["status"]!="estimated"||forward["complete"]!=true||forward["reconciliationVerified"]!=true{return false;}
    if inverse&&(r["recommended"].is_null()||r["coverage"]["state"]!="complete"||r["coverage"]["exactSetComplete"]!=true){return false;}
    true
}

pub(super) fn index(payload:&str)->Result<validation::SnapshotIndex>{
    if payload.len()>validation::MAX_PAYLOAD{return Err(failure("INVALID_SNAPSHOT"));}
    budget_v3::scan(payload)?;
    let wire:Value=serde_json::from_str(payload).map_err(|_|failure("INVALID_SNAPSHOT"))?;
    let s=&wire["value"];let p=&s["executionProvenance"];
    let reserved=p["producerId"]=="nomina-signed-fiscal-document-v3-v2"
        ||p["reportContractId"]=="standard-payroll-2026-contextual-document-compat-v1"
        ||p["presentationContractId"]=="nomina-presentation-document-compat-v1";
    if !reserved{return validation::validate_snapshot(payload,false);}
    // Exact tuple, strict JSON, canonical wire, signatures and full semantics.
    // No fallback to a different producer after a failure.
    let index=validation::validate_snapshot_for_read(payload)?;
    if index.snapshot_version!=3||s["documentKind"]!="execution-record"||p["authorizationObservation"]["kind"]!="native-observation-v1"{return Err(failure("NATIVE_DOCUMENT_REQUIRED"));}
    if !compat_complete(s){return Err(failure("DOCUMENT_MANUAL_FLOW_REQUIRED"));}
    Ok(index)
}

impl StorageService{
    pub(crate) fn validate_authorized_document(payload:&str)->Result<validation::SnapshotIndex>{
        let index=index(payload)?;
        let wire:Value=serde_json::from_str(payload).map_err(|_|failure("INVALID_SNAPSHOT"))?;
        let s=&wire["value"];
        if index.snapshot_version!=3||s["documentKind"]!="execution-record"||s["executionProvenance"]["authorizationObservation"]["kind"]!="native-observation-v1"{return Err(failure("NATIVE_DOCUMENT_REQUIRED"));}
        Ok(index)
    }
}
