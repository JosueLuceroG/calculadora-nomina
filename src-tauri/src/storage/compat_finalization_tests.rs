//! CD-3 finalization regression under the CD-4 persistence policy.
//! Test-only in-memory rows are inputs to the verifier, not salary persistence.
use super::*;
#[test]
fn cd3_native_finalized_compat_keeps_legacy_writer_closed_and_uses_complete_restore_policy(){
 let root=Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
 let out=root.join("docs/evidence/snapshot-v3-compat/cd3");
 let records:Vec<Value>=serde_json::from_slice(&fs::read(out.join("native-finalization.json")).unwrap()).unwrap();
 let mut results=vec![];
 for record in records{
  let path=root.join(record["run"].as_str().unwrap()).join("finalized.json");let payload=fs::read_to_string(&path).unwrap();
  let index=validation::validate_snapshot_for_read(&payload).unwrap();assert!(StorageService::validate_finalized_document(&payload).is_err());assert_eq!(validate_snapshot(&payload,true).err().unwrap().code,"V3_WRITE_CLOSED");assert!(validate_snapshot(&payload,false).is_err());
  let wire:Value=serde_json::from_str(&payload).unwrap();let p=&wire["value"]["fiscalPackage"];let c=Connection::open_in_memory().unwrap();
  for migration in [MIGRATION_1,MIGRATION_2,MIGRATION_3,MIGRATION_4]{c.execute_batch(migration).unwrap();}
  c.execute("INSERT INTO fiscal_packages VALUES(?1,?2,?3,?4)",params![index.package_sha,p["id"].as_str(),p["version"].as_str(),p.to_string()]).unwrap();
  c.execute("INSERT INTO simulations VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",params![index.execution_id,index.completed_at,index.direction,index.requested_amount,index.periodicity,index.reference_date,index.classification,index.gross,index.net,index.package_sha,index.snapshot_version,payload,validation::digest(payload.as_bytes())]).unwrap();
  let verified=backup::check_records(&c);let complete=compat_complete(&wire["value"]);assert_eq!(verified.is_ok(),complete);
  results.push(serde_json::json!({"label":record["label"],"nativeDocumentSha256":validation::digest(payload.as_bytes()),"readAccepted":true,"legacyFinalizedWriterGateRejected":true,"ordinaryWriterRejected":true,"restoreRecordVerifierAccepted":verified.is_ok(),"restoreError":verified.err().map(|e|e.code),"storageKind":"test-only in-memory verifier fixture; acceptance is document consistency, not issuance or native write permission"}));
 }
 fs::write(out.join("restore-dispatch.json"),serde_json::to_vec_pretty(&results).unwrap()).unwrap();
}
