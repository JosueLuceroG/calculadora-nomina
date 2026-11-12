//! Persisted originals, backup copies, recovery and closed dispatch; no permits.
use super::*;
fn evidence()->PathBuf{Path::new(env!("CARGO_MANIFEST_DIR")).join("../docs/evidence/snapshot-v3-compat/cd4")}
impl StorageService{
 pub(crate) fn cd4_backup_recovery_probe(&self,id:&str,payload:&str)->Value{
  let path=self.path().unwrap();let root=path.parent().unwrap();
  self.with(|c|{backup::check_integrity(c)?;backup::check_records(c)?;let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(db_error)?;backup::create_backup(&path,&tx)?;tx.rollback().map_err(db_error)}).unwrap();
  let dirs=fs::read_dir(root.join("migration-backups")).unwrap().map(|x|x.unwrap().path()).filter(|p|p.is_dir()).collect::<Vec<_>>();assert_eq!(dirs.len(),1);let backup_path=dirs[0].join("payroll.sqlite3");
  let copy=Connection::open_with_flags(&backup_path,rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();backup::check_integrity(&copy).unwrap();backup::check_records(&copy).unwrap();
  let exact:String=copy.query_row("SELECT payload FROM simulations WHERE execution_id=?1",[id],|r|r.get(0)).unwrap();assert_eq!(exact,payload);drop(copy);
  // Test-only restore of the exact native-created database copy; no payload
  // import endpoint is introduced, and no RAM session is reconstructed.
  let restored_root=std::env::temp_dir().join("opencode").join(format!("nomina-cd4-restored-{}",Uuid::new_v4()));fs::create_dir(&restored_root).unwrap();fs::copy(&backup_path,restored_root.join("payroll.sqlite3")).unwrap();
  let restored=StorageService::new(Ok(restored_root.clone()));assert_eq!(restored.get(id).unwrap().as_deref(),Some(payload));assert_eq!(restored.reconcile_v3(id,&digest(payload.as_bytes())).unwrap().stored,Some(true));
  let saved_hash=backup::file_digest(&backup_path).unwrap();
  // Interrupt backup cleanup after its durable per-copy marker, then reopen.
  backup::set_fault(Some("cleanup-after-marker"),false);assert!(self.info().is_err());backup::set_fault(None,false);
  assert!(root.join("migration-backups").exists());let reopened=StorageService::new(Ok(root.to_path_buf()));reopened.info().unwrap();assert!(!root.join("migration-backups").exists());assert_eq!(reopened.get(id).unwrap().as_deref(),Some(payload));
  // Mutating a salary index in a restored copy is detected even though SQLite
  // is healthy and the original payload/checksum are left untouched.
  let c=Connection::open(restored_root.join("payroll.sqlite3")).unwrap();c.execute("UPDATE simulations SET net='1.00' WHERE execution_id=?1",[id]).unwrap();assert_eq!(backup::check_records(&c).unwrap_err().code,"CORRUPT_RECORD");drop(c);
  assert_eq!(restored.reconcile_v3(id,&digest(payload.as_bytes())).unwrap_err().code,"CORRUPT_RECORD");fs::remove_dir_all(restored_root).unwrap();
  serde_json::json!({"nativeCommittedOriginal":true,"vacuumBackupCreated":true,"backupFileSha256":saved_hash,"exactBytesValidated":true,"testCopyRestoredAndReconciled":true,"cleanupInterruptedAfterDurableMarker":true,"reopenCompletedRecovery":true,"corruptRestoredIndex":"CORRUPT_RECORD","newJsonImportEndpoint":false})
 }
}

#[test]
fn cd4_persisted_dispatch_preserves_all_historical_vectors_and_rejects_fixtures(){
 let corpus:Vec<Value>=serde_json::from_slice(&fs::read(evidence().join("../cd2/cases.json")).unwrap()).unwrap();let mut historical=vec![];let mut rejected=vec![];
 for case in &corpus{
  let payload=case["payload"].as_str().unwrap();
  if case["historical"]==true{
   let old=validate_snapshot(payload,false);let persisted=persistence_v3::index(payload);assert_eq!(old.is_ok(),persisted.is_ok(),"{}",case["name"]);
   if let(Ok(a),Ok(b))=(&old,&persisted){assert_eq!((&a.classification,&a.gross,&a.net,a.snapshot_version),(&b.classification,&b.gross,&b.net,b.snapshot_version));}
   historical.push(serde_json::json!({"name":case["name"],"accepted":old.is_ok(),"classification":old.ok().map(|x|x.classification),"payloadSha256":digest(payload.as_bytes())}));
  }else if case["accepted"]==true{
   let wire:Value=serde_json::from_str(payload).unwrap();if wire["value"]["executionProvenance"]["producerId"]=="nomina-signed-fiscal-document-v3-v2"{
    let error=persistence_v3::index(payload).err().expect("Documentary fixture must not become a persisted execution");rejected.push(serde_json::json!({"name":case["name"],"error":error.code}));
   }
  }
 }
 assert_eq!(historical.len(),44);assert_eq!(historical.iter().filter(|x|x["accepted"]==true).count(),18);assert!(!rejected.is_empty());
 fs::write(evidence().join("historical-dispatch.json"),serde_json::to_vec_pretty(&serde_json::json!({"historical":historical,"compatDocumentaryFixturesRejected":rejected,"historicalDifferences":0,"privatePermitsIssued":0})).unwrap()).unwrap();
}
