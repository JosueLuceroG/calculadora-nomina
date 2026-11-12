use super::*;
use std::process::Command;
use std::sync::{Arc,Barrier};
use std::thread;
thread_local! {static DISK_FULL:std::cell::Cell<bool>=const{std::cell::Cell::new(false)};}
pub(super) fn disk_full_requested()->bool{DISK_FULL.with(|f|f.get())}
struct Qa {root:PathBuf}
impl Qa {fn new()->Self{Self{root:std::env::temp_dir().join(format!("nomina-5d2b-{}",Uuid::new_v4()))}}fn db(&self)->PathBuf{self.root.join("payroll.sqlite3")}fn service(&self)->StorageService{StorageService::new(Ok(self.root.clone()))}}
impl Drop for Qa{fn drop(&mut self){let _=fs::remove_dir_all(&self.root);}}

pub(super) fn seed_old_database(path:&Path,version:i64,mode:&str)->Vec<Value>{
    assert!([1,2].contains(&version));assert!(["WAL","DELETE"].contains(&mode));fs::create_dir_all(path.parent().unwrap()).unwrap();
    let c=Connection::open(path).unwrap();c.execute_batch(&format!("PRAGMA journal_mode={mode};")).unwrap();c.execute_batch(MIGRATION_1).unwrap();
    c.execute("INSERT INTO store_meta VALUES(1,?1)",[Uuid::new_v4().to_string()]).unwrap();
    c.execute("UPDATE preferences SET theme='dark',history_auto_save=1",[]).unwrap();
    if version==2{c.execute_batch(MIGRATION_2).unwrap();c.execute("INSERT INTO deleted_executions VALUES(?1)",["99999999-9999-4999-8999-999999999999"]).unwrap();}
    c.pragma_update(None,"user_version",version).unwrap();
    let corpus:Vec<Value>=serde_json::from_str(include_str!("../../../docs/evidence/5d2b/originals-v1.json")).unwrap();
    for item in &corpus {
        let payload=item["payload"].as_str().unwrap();let wire:Value=serde_json::from_str(payload).unwrap();let p=&wire["value"]["fiscalPackage"];let s=validate_snapshot(payload,false).unwrap();
        c.execute("INSERT OR IGNORE INTO fiscal_packages VALUES(?1,?2,?3,?4)",params![s.package_sha,p["id"].as_str(),p["version"].as_str(),p.to_string()]).unwrap();
        c.execute("INSERT INTO simulations VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,1,?11,?12)",params![s.execution_id,s.completed_at,s.direction,s.requested_amount,s.periodicity,s.reference_date,s.classification,s.gross,s.net,s.package_sha,payload,item["checksum"].as_str()]).unwrap();
    }corpus
}
fn assert_old(q:&Qa,corpus:&[Value]){
    let c=Connection::open(q.db()).unwrap();for item in corpus {let payload=item["payload"].as_str().unwrap();let wire:Value=serde_json::from_str(payload).unwrap();let id=wire["value"]["executionId"].as_str().unwrap();
        let row:(String,String,i64)=c.query_row("SELECT payload,payload_sha256,snapshot_version FROM simulations WHERE execution_id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert!(row.0==payload,"Original payload changed");assert_eq!(row.1,item["checksum"].as_str().unwrap());assert_eq!(row.2,1);
    }
}
#[test]fn original_corpus_v1_both_policies_migrates_byte_exact_in_wal_and_delete(){
    for mode in ["WAL","DELETE"]{for version in [1,2]{let q=Qa::new();let corpus=seed_old_database(&q.db(),version,mode);let c=Connection::open(q.db()).unwrap();let before=backup::preserved_digest(&c).unwrap();drop(c);
        let info=q.service().info().unwrap();assert_eq!(info.schema_version,4);assert_old(&q,&corpus);
        let c=Connection::open(q.db()).unwrap();assert_eq!(backup::preserved_digest(&c).unwrap(),before);backup::check_integrity(&c).unwrap();drop(c);
        assert!(!q.root.join("migration-backups").exists());assert_eq!(q.service().list(100,None).unwrap().items.len(),corpus.len());
        assert_eq!(q.service().preferences().unwrap(),Preferences{theme:Theme::Dark,history_auto_save:true});
        for item in &corpus{let p=item["payload"].as_str().unwrap();let wire:Value=serde_json::from_str(p).unwrap();assert!(q.service().get(wire["value"]["executionId"].as_str().unwrap()).unwrap().unwrap()==p);}
    }}
}
#[test]fn every_transaction_failure_keeps_originals_and_valid_backup_then_retries(){
    for point in ["backup-created","backup-unverified","after-backup","after-copy","after-drop","before-commit","after-commit"]{
        let q=Qa::new();let corpus=seed_old_database(&q.db(),2,"WAL");backup::set_fault(Some(point),false);assert!(q.service().info().is_err());backup::set_fault(None,false);
        assert_old(&q,&corpus);assert!(q.root.join("migration-backups").exists());
        let c=Connection::open(q.db()).unwrap();let version:i64=c.query_row("PRAGMA user_version",[],|r|r.get(0)).unwrap();assert_eq!(version,if point=="after-commit"{4}else{2});drop(c);
        assert_eq!(q.service().info().unwrap().schema_version,4);assert_old(&q,&corpus);assert!(!q.root.join("migration-backups").exists());
    }
}
#[test]fn sqlite_full_during_copy_never_drops_the_original(){
    let q=Qa::new();let corpus=seed_old_database(&q.db(),2,"DELETE");DISK_FULL.with(|f|f.set(true));let result=q.service().info();DISK_FULL.with(|f|f.set(false));
    assert!(result.is_err());assert_old(&q,&corpus);assert!(q.root.join("migration-backups").exists());assert_eq!(q.service().info().unwrap().schema_version,4);assert_old(&q,&corpus);
}
#[test]fn crash_process_rolls_back_ddl_or_reopens_committed_migration(){
    for point in ["after-drop","after-commit","cleanup-after-marker","cleanup-after-approval"]{let q=Qa::new();let corpus=seed_old_database(&q.db(),2,"WAL");
        let status=Command::new(std::env::current_exe().unwrap()).args(["--exact","storage::migration_tests::crash_child","--ignored","--nocapture"]).env("NOMINA_QA_CRASH_ROOT",&q.root).env("NOMINA_QA_CRASH_POINT",point).status().unwrap();
        assert_eq!(status.code(),Some(73));assert!(q.root.join("migration-backups").exists());assert_eq!(q.service().info().unwrap().schema_version,4);assert_old(&q,&corpus);assert!(!q.root.join("migration-backups").exists());
    }
}
#[test]#[ignore="Subprocess helper; exercised by crash_process test"]fn crash_child(){
    let root=PathBuf::from(std::env::var_os("NOMINA_QA_CRASH_ROOT").unwrap());assert!(root.starts_with(std::env::temp_dir()));assert!(root.file_name().unwrap().to_string_lossy().starts_with("nomina-5d2b-"));
    let point=match std::env::var("NOMINA_QA_CRASH_POINT").unwrap().as_str(){"after-drop"=>"after-drop","after-commit"=>"after-commit","cleanup-after-marker"=>"cleanup-after-marker","cleanup-after-approval"=>"cleanup-after-approval",_=>panic!("Invalid QA point")};backup::set_fault(Some(point),true);let _=StorageService::new(Ok(root)).info();panic!("Expected process interruption");
}
#[test]fn two_repository_instances_migrate_once_and_keep_one_generation(){
    let q=Qa::new();let corpus=seed_old_database(&q.db(),2,"WAL");let barrier=Arc::new(Barrier::new(2));let tasks:Vec<_>=(0..2).map(|_|{let root=q.root.clone();let b=barrier.clone();thread::spawn(move||{b.wait();StorageService::new(Ok(root)).info().unwrap()})}).collect();let infos:Vec<_>=tasks.into_iter().map(|t|t.join().unwrap()).collect();assert_eq!(infos[0].generation,infos[1].generation);assert_old(&q,&corpus);assert!(!q.root.join("migration-backups").exists());
}
#[test]fn valid_backup_is_not_overwritten_or_restored_over_newer_state(){
    let q=Qa::new();let corpus=seed_old_database(&q.db(),2,"WAL");backup::set_fault(Some("after-commit"),false);assert!(q.service().info().is_err());backup::set_fault(None,false);
    let dir=fs::read_dir(q.root.join("migration-backups")).unwrap().next().unwrap().unwrap().path();let before=fs::read(dir.join("payroll.sqlite3")).unwrap();
    let c=Connection::open(q.db()).unwrap();c.execute("UPDATE preferences SET theme='light'",[]).unwrap();drop(c);
    assert_eq!(q.service().info().unwrap_err().code,"RECOVERY_PENDING");assert_eq!(q.service().clear().unwrap_err().code,"RECOVERY_PENDING");assert_eq!(fs::read(dir.join("payroll.sqlite3")).unwrap(),before);assert_old(&q,&corpus);
}
#[test]fn verified_backup_can_be_restored_to_a_separate_qa_database(){
    let source=Qa::new();let corpus=seed_old_database(&source.db(),2,"WAL");backup::set_fault(Some("after-backup"),false);assert!(source.service().info().is_err());backup::set_fault(None,false);
    let dir=fs::read_dir(source.root.join("migration-backups")).unwrap().next().unwrap().unwrap().path();let before=fs::read(dir.join("payroll.sqlite3")).unwrap();
    let restored=Qa::new();fs::create_dir_all(&restored.root).unwrap();fs::copy(dir.join("payroll.sqlite3"),restored.db()).unwrap();assert_eq!(restored.service().info().unwrap().schema_version,4);assert_old(&restored,&corpus);assert_eq!(fs::read(dir.join("payroll.sqlite3")).unwrap(),before);
}
#[cfg(windows)]#[test]fn permission_denied_removing_backup_is_reported_and_retry_is_controlled(){
    use std::os::windows::fs::OpenOptionsExt;let q=Qa::new();seed_old_database(&q.db(),2,"WAL");backup::set_fault(Some("after-commit"),false);assert!(q.service().info().is_err());backup::set_fault(None,false);
    let dir=fs::read_dir(q.root.join("migration-backups")).unwrap().next().unwrap().unwrap().path();let locked=fs::OpenOptions::new().read(true).share_mode(1).open(dir.join("payroll.sqlite3")).unwrap();
    assert_eq!(q.service().info().unwrap_err().code,"BACKUP_CLEANUP_PENDING");assert_eq!(q.service().clear().unwrap_err().code,"BACKUP_CLEANUP_PENDING");assert!(dir.join("payroll.sqlite3").exists());drop(locked);
    assert_eq!(q.service().info().unwrap().schema_version,4);assert!(!q.root.join("migration-backups").exists());q.service().clear().unwrap();assert!(q.service().list(20,None).unwrap().items.is_empty());
}
#[test]fn corrupt_original_blocks_migration_without_repair_or_deletion(){
    for sql in ["UPDATE simulations SET payload='{}' WHERE execution_id=(SELECT execution_id FROM simulations LIMIT 1)","UPDATE simulations SET requested_amount='999.99' WHERE execution_id=(SELECT execution_id FROM simulations LIMIT 1)","UPDATE fiscal_packages SET package_id='incompatible-identity'"]{
        let q=Qa::new();seed_old_database(&q.db(),2,"WAL");let c=Connection::open(q.db()).unwrap();c.execute(sql,[]).unwrap();drop(c);
        assert_eq!(q.service().info().unwrap_err().code,"CORRUPT_RECORD");let c=Connection::open(q.db()).unwrap();assert_eq!(c.query_row("PRAGMA user_version",[],|r|r.get::<_,i64>(0)).unwrap(),2);
    }
}
#[test]fn v2_payload_cannot_grant_itself_an_authorization(){
    let fixtures:Vec<Value>=serde_json::from_str(include_str!("fixtures-v2.json")).unwrap();let original=fixtures[0]["payload"].as_str().unwrap();
    for field in ["producer","hash","policy","sources","sets","unknown","unicode","amounts","allocation"]{let mut wire:Value=serde_json::from_str(original).unwrap();match field{
        "producer"=>wire["value"]["executionProvenance"]["producerId"]="self-trusted".into(),
        "hash"=>wire["value"]["executionProvenance"]["fiscalPackage"]["sha256"]="0".repeat(64).into(),
        "policy"=>wire["value"]["executionProvenance"]["authorization"]["inverse"]=false.into(),
        "sources"=>wire["value"]["executionProvenance"]["sourceCatalog"]=serde_json::json!([]),
        "sets"=>wire["value"]["executionProvenance"]["effectiveParameterSets"][0]["version"]="future-v99".into(),
        "unknown"=>wire["value"]["executionProvenance"]["arbitraryCode"]="not executed".into(),
        "amounts"=>{wire["value"]["outcome"]["report"]["net"]["amount"]="1.00".into();wire["value"]["outcome"]["presentation"]["values"]["netSalary"]="1.00".into();},
        "allocation"=>wire["value"]["outcome"]["report"]["imss"]["absorbedByEmployer"]["amount"]="1.00".into(),
        _=>wire["value"]["executionProvenance"]["resolution"]["fiscalDate"]="é".into(),}
        assert!(validate_snapshot(&wire.to_string(),true).is_err());
    }
    let old:Vec<Value>=serde_json::from_str(include_str!("fixtures.json")).unwrap();assert!(validate_snapshot(old[0]["payload"].as_str().unwrap(),true).is_err());
    let duplicate=original.replacen("\"schemaVersion\":2","\"schemaVersion\":2,\"schemaVersion\":2",1);assert_ne!(duplicate,original);assert!(validate_snapshot(&duplicate,true).is_err());
}
#[test]fn clear_removes_owned_recovery_salary_archives_but_not_unrelated_files(){
    let q=Qa::new();q.service().info().unwrap();let dir=q.root.join("recovery").join(Uuid::new_v4().to_string());fs::create_dir_all(&dir).unwrap();fs::write(dir.join("payroll.sqlite3"),b"QA old salary data").unwrap();q.service().clear().unwrap();assert!(!q.root.join("recovery").exists());
    let dir=q.root.join("recovery").join(Uuid::new_v4().to_string());fs::create_dir_all(&dir).unwrap();fs::write(dir.join("unrecognized.txt"),b"must not remove").unwrap();assert_eq!(q.service().clear().unwrap_err().code,"BACKUP_CLEANUP_PENDING");assert!(dir.join("unrecognized.txt").exists());
}
