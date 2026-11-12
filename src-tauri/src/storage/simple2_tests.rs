use super::*;
use crate::storage::{StorageService, PreferencePatch, validation};
use uuid::Uuid;

fn cases() -> Vec<Value> { serde_json::from_str(include_str!("fixtures-v2.json")).unwrap() }
fn original() -> Value { serde_json::from_str(cases()[0]["payload"].as_str().unwrap()).unwrap() }

#[test]
fn simple2_update_catalog_keeps_historical_reader_and_retires_writer() {
    let old: Value = serde_json::from_str(HISTORICAL_2026).unwrap();
    let mut future=old.clone();
    future["producerId"]="fixture-only-simple2-producer".into();
    future["versions"]["application"]="0.2.0-fixture".into();
    future["manifest"]["packageId"]="fixture-only-2026-revision".into();
    future["manifest"]["parameterVersion"]="fixture-only-2026-revision".into();
    future["manifest"]["contentIdentity"]["sha256"]="f".repeat(64).into();
    future["authorization"]["content"]=serde_json::json!({"packageId":"fixture-only-2026-revision","parameterVersion":"fixture-only-2026-revision","scheme":"legacy-registry-v1","sha256":"f".repeat(64)});
    let active=serde_json::json!([future["producerId"]]); let known=[old.clone(),future.clone()];
    let mut wire=original();
    wire["value"]["versions"]=old["versions"].clone();
    wire["value"]["executionProvenance"]["versions"]=old["versions"].clone();
    wire["value"]["executionProvenance"]["producerId"]=old["producerId"].clone();
    let s=&wire["value"]; let before=wire.to_string();
    assert!(assert_with_catalog(s,false,&known,&active).is_ok());
    assert!(assert_with_catalog(s,true,&known,&active).is_err());
    assert_eq!(wire.to_string(),before);
    let mut new=s.clone();
    new["versions"]=future["versions"].clone();
    new["executionProvenance"]["versions"]=future["versions"].clone();
    new["executionProvenance"]["producerId"]=future["producerId"].clone();
    new["executionProvenance"]["authorization"]=future["authorization"].clone();
    for (key, value) in [("id",future["manifest"]["packageId"].clone()),("version",future["manifest"]["parameterVersion"].clone()),("sha256",future["manifest"]["contentIdentity"]["sha256"].clone())] {new["fiscalPackage"][key]=value;}
    new["executionProvenance"]["fiscalPackage"]=new["fiscalPackage"].clone();
    assert!(assert_with_catalog(&new,true,&known,&active).is_ok());
    // A fixture is never registered with the production reader/writer.
    assert!(assert_snapshot(&new,false).is_err());
    assert!(assert_with_catalog(s,false,&known,&serde_json::json!([old["producerId"],future["producerId"]])).is_err());
    assert!(assert_with_catalog(s,false,&known,&serde_json::json!(["unknown"])).is_err());
}

#[test]
fn simple2_originals_survive_restart_byte_exact_with_same_indexes_and_checksum() {
    let root=std::env::temp_dir().join("opencode").join(format!("simple2-originals-{}",Uuid::new_v4()));
    let service=StorageService::new(Ok(root.clone()));
    service.set_preferences(PreferencePatch{theme:None,history_auto_save:Some(true)}).unwrap();
    let generation=service.begin_write().unwrap().generation;
    for case in cases(){assert!(service.insert(&generation,case["payload"].as_str().unwrap()).unwrap().inserted);}
    drop(service);
    let service=StorageService::new(Ok(root.clone()));
    assert_eq!(service.begin_write().unwrap().generation,generation);
    assert_eq!(service.info().unwrap().schema_version,4);
    for case in cases(){
        let payload=case["payload"].as_str().unwrap(); let wire:Value=serde_json::from_str(payload).unwrap();
        let id=wire["value"]["executionId"].as_str().unwrap();
        let read=service.get(id).unwrap().unwrap();assert_eq!(read,payload);assert_eq!(validation::digest(read.as_bytes()),validation::digest(payload.as_bytes()));
        let index=validation::validate_snapshot_for_read(&read).unwrap();
        let stored=service.list(100,None).unwrap().items.into_iter().find(|x|x.execution_id==id).unwrap();
        assert_eq!(stored.classification,index.classification);assert_eq!(stored.gross,index.gross);assert_eq!(stored.net,index.net);
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn simple2_unknown_or_incompatible_descriptors_rejected_without_repair() {
    for path in ["producerId","reportContractId","presentationContractId"] {
        let mut wire=original();wire["value"]["executionProvenance"][path]="unknown".into();
        let bytes=wire.to_string();assert_eq!(validation::validate_snapshot_for_read(&bytes).err().unwrap().code,"INCOMPATIBLE_SCHEMA");assert!(validation::validate_snapshot(&bytes,true).is_err());
    }
    let mut wire=original();wire["value"]["executionProvenance"]["versions"]["application"]="unknown".into();
    assert!(validation::validate_snapshot_for_read(&wire.to_string()).is_err());
    wire=original();wire["value"]["fiscalPackage"]["version"]="unknown".into();
    assert!(validation::validate_snapshot_for_read(&wire.to_string()).is_err());
}

#[test]
fn simple2_consent_generations_tombstones_and_idempotence_unchanged() {
    let root=std::env::temp_dir().join("opencode").join(format!("simple2-consent-{}",Uuid::new_v4()));
    let service=StorageService::new(Ok(root.clone()));let p=cases()[0]["payload"].as_str().unwrap().to_string();
    let id=original()["value"]["executionId"].as_str().unwrap().to_string();
    let initial=service.begin_write().unwrap().generation;
    assert_eq!(service.insert(&initial,&p).unwrap_err().code,"AUTO_SAVE_DISABLED");
    assert_eq!(service.insert_automatic(&initial,&p).unwrap_err().code,"AUTO_SAVE_DISABLED");
    service.set_preferences(PreferencePatch{theme:None,history_auto_save:Some(true)}).unwrap();
    assert!(service.insert_automatic(&initial,&p).unwrap().inserted);assert!(!service.insert(&initial,&p).unwrap().inserted);
    service.set_preferences(PreferencePatch{theme:None,history_auto_save:Some(false)}).unwrap();
    assert_eq!(service.get(&id).unwrap().unwrap(),p);
    service.set_preferences(PreferencePatch{theme:None,history_auto_save:Some(true)}).unwrap();
    assert_eq!(service.insert(&initial,&p).unwrap_err().code,"STALE_GENERATION");
    let current=service.begin_write().unwrap().generation;assert!(service.delete(&id).unwrap().deleted);
    assert_eq!(service.insert(&current,&p).unwrap_err().code,"DELETED_EXECUTION");
    let after=service.clear().unwrap().generation;assert_ne!(current,after);drop(service);
    let service=StorageService::new(Ok(root.clone()));assert_eq!(service.begin_write().unwrap().generation,after);
    assert!(service.preferences().unwrap().history_auto_save);assert!(service.list(100,None).unwrap().items.is_empty());
    assert_eq!(service.insert(&current,&p).unwrap_err().code,"STALE_GENERATION");
    std::fs::remove_dir_all(root).unwrap();
}
