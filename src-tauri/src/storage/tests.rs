use super::*;
use std::sync::{Arc, Barrier};
use std::thread;

struct TempStore { root:PathBuf }
impl TempStore {
    fn new()->Self {Self{root:std::env::temp_dir().join(format!("nomina-storage-test-{}",Uuid::new_v4()))}}
    fn service(&self)->StorageService {StorageService::new(Ok(self.root.clone()))}
    fn db(&self)->PathBuf {self.root.join("payroll.sqlite3")}
}
impl Drop for TempStore {fn drop(&mut self){let _=fs::remove_dir_all(&self.root);}}
fn fixtures()->Vec<Value>{let cases:Vec<Value>=serde_json::from_str(include_str!("fixtures-v2.json")).unwrap();assert_eq!(cases.len(),6,"Ejecutar primero las pruebas Vitest documentales v2");cases}
fn payload(n:u32)->String{
    let first=fixtures()[0]["payload"].as_str().unwrap().to_string();
    let mut v:Value=serde_json::from_str(&first).unwrap();
    v["value"]["executionId"]=Value::String(format!("00000000-0000-4000-8000-{n:012}"));
    v["value"]["execution"]["completedAt"]=Value::String(format!("2026-02-01T12:00:{:02}.000Z",n%60));
    v["value"]["execution"]["completedLocalTime"]=Value::String(format!("12:00:{:02}",n%60));
    serde_json::to_string(&v).unwrap()
}
fn id(p:&str)->String{serde_json::from_str::<Value>(p).unwrap()["value"]["executionId"].as_str().unwrap().into()}
fn insert(s:&StorageService,p:&str){s.set_preferences(PreferencePatch{theme:None,history_auto_save:Some(true)}).unwrap();let epoch=s.begin_write().unwrap();assert!(s.insert(&epoch.generation,p).unwrap().inserted);}

#[test]
fn lazy_creation_defaults_and_schema_versions(){
    let t=TempStore::new();let s=t.service();assert!(!t.root.exists());
    let info=s.info().unwrap();assert_eq!(info.schema_version,4);assert!(!info.encrypted);assert!(t.db().exists());
    assert_eq!(s.preferences().unwrap(),Preferences{theme:Theme::Light,history_auto_save:false});assert!(s.list(20,None).unwrap().items.is_empty());
    let c=Connection::open(t.db()).unwrap();assert_eq!(c.query_row("PRAGMA user_version",[],|r|r.get::<_,i64>(0)).unwrap(),4);
    assert_eq!(c.query_row("SELECT version FROM schema_version",[],|r|r.get::<_,i64>(0)).unwrap(),4);
}
#[test]
fn six_real_fiscal_snapshots_round_trip_byte_exact_after_restart(){
    let t=TempStore::new();let s=t.service();
    for case in fixtures(){let p=case["payload"].as_str().unwrap();insert(&s,p);assert_eq!(s.get(&id(p)).unwrap().unwrap(),p);}
    drop(s);let restarted=t.service();assert_eq!(restarted.list(100,None).unwrap().items.len(),6);
    for case in fixtures(){let p=case["payload"].as_str().unwrap();assert_eq!(restarted.get(&id(p)).unwrap().unwrap(),p);}
}
#[test]
fn original_amount_strings_null_zero_and_versions_are_not_normalized(){
    let t=TempStore::new();let s=t.service();let p=payload(1);insert(&s,&p);
    let v:Value=serde_json::from_str(&s.get(&id(&p)).unwrap().unwrap()).unwrap();
    assert_eq!(v["value"]["capture"]["form"]["amount"],"00015000.50");
    assert!(v["value"]["outcome"]["presentation"]["values"]["integratedVariableIncome"].is_null());
    assert_eq!(v["value"]["fiscalPackage"]["version"],"mx-fiscal-2026-source-v3");
    let off=fixtures().into_iter().find(|c|c["name"]=="direct-imss-off-auto").unwrap();let p=off["payload"].as_str().unwrap();insert(&s,p);
    let v:Value=serde_json::from_str(&s.get(&id(p)).unwrap().unwrap()).unwrap();
    assert_eq!(v["value"]["outcome"]["presentation"]["values"]["workerImss"],"0.00");
    assert_eq!(v["value"]["execution"]["referenceMode"],"automatic");
}
#[test]
fn duplicate_id_is_idempotent_and_conflicts_never_overwrite(){
    let t=TempStore::new();let s=t.service();let p=payload(2);let token=s.begin_write().unwrap();
    s.set_preferences(PreferencePatch{theme:None,history_auto_save:Some(true)}).unwrap();
    assert!(s.insert(&token.generation,&p).unwrap().inserted);assert!(!s.insert(&token.generation,&p).unwrap().inserted);
    let mut altered:Value=serde_json::from_str(&p).unwrap();altered["value"]["execution"]["completedAt"]="2026-02-01T12:01:00.000Z".into();
    assert_eq!(s.insert(&token.generation,&altered.to_string()).unwrap_err().code,"DUPLICATE_CONFLICT");
    assert_eq!(s.get(&id(&p)).unwrap().unwrap(),p);
}
#[test]
fn ordered_keyset_pages_and_lookup_missing_id(){
    let t=TempStore::new();let s=t.service();for n in [1,3,2,4,5]{insert(&s,&payload(n));}
    let first=s.list(2,None).unwrap();assert_eq!(first.items.iter().map(|v|v.execution_id.clone()).collect::<Vec<_>>(),vec![id(&payload(5)),id(&payload(4))]);
    let second=s.list(2,first.next_cursor).unwrap();assert_eq!(second.items[0].execution_id,id(&payload(3)));
    let third=s.list(2,second.next_cursor).unwrap();assert_eq!(third.items.len(),1);assert!(third.next_cursor.is_none());
    assert!(s.get(&Uuid::new_v4().to_string()).unwrap().is_none());
    assert_eq!(s.list(0,None).unwrap_err().code,"INVALID_ARGUMENT");assert_eq!(s.list(101,None).unwrap_err().code,"INVALID_ARGUMENT");
}
#[test]
fn individual_delete_is_tombstoned_and_other_records_survive(){
    let t=TempStore::new();let s=t.service();let a=payload(1);let b=payload(2);insert(&s,&a);insert(&s,&b);let token=s.begin_write().unwrap();
    assert!(s.delete(&id(&a)).unwrap().deleted);assert!(!s.delete(&id(&a)).unwrap().deleted);
    assert!(s.get(&id(&a)).unwrap().is_none());assert_eq!(s.get(&id(&b)).unwrap().unwrap(),b);
    assert_eq!(s.insert(&token.generation,&a).unwrap_err().code,"DELETED_EXECUTION");
}
#[test]
fn clear_invalidates_writes_and_pagination_across_restart(){
    let t=TempStore::new();let s=t.service();insert(&s,&payload(1));insert(&s,&payload(2));
    let token=s.begin_write().unwrap();let cursor=s.list(1,None).unwrap().next_cursor;
    let after=s.clear().unwrap();assert_ne!(token.generation,after.generation);drop(s);
    let s=t.service();assert_eq!(s.begin_write().unwrap().generation,after.generation);
    assert!(s.list(20,None).unwrap().items.is_empty());assert_eq!(s.insert(&token.generation,&payload(3)).unwrap_err().code,"STALE_GENERATION");
    assert_eq!(s.list(1,cursor).unwrap_err().code,"STALE_GENERATION");assert!(s.insert(&after.generation,&payload(3)).unwrap().inserted);
}
#[test]
fn pending_write_started_before_clear_cannot_restore_history(){
    let t=TempStore::new();let s=Arc::new(t.service());let token=s.begin_write().unwrap();
    let ready=Arc::new(Barrier::new(2));let release=Arc::new(Barrier::new(2));let ss=s.clone();let r=ready.clone();let go=release.clone();
    let pending=thread::spawn(move||{r.wait();go.wait();ss.insert(&token.generation,&payload(9))});
    ready.wait();s.clear().unwrap();release.wait();assert_eq!(pending.join().unwrap().unwrap_err().code,"STALE_GENERATION");
    assert!(s.list(10,None).unwrap().items.is_empty());
}
#[test]
fn concurrent_writes_duplicate_clicks_and_clear_are_linearizable(){
    let t=TempStore::new();let s=Arc::new(t.service());let token=s.begin_write().unwrap().generation;
    s.set_preferences(PreferencePatch{theme:None,history_auto_save:Some(true)}).unwrap();
    let handles:Vec<_>=(1..=12).map(|n|{let s=s.clone();let e=token.clone();thread::spawn(move||s.insert(&e,&payload(n)))}).collect();
    for h in handles{assert!(h.join().unwrap().unwrap().inserted);}
    assert_eq!(s.list(100,None).unwrap().items.len(),12);
    let handles:Vec<_>=(0..8).map(|_|{let s=s.clone();let e=token.clone();thread::spawn(move||s.insert(&e,&payload(20)))}).collect();
    let results:Vec<_>=handles.into_iter().map(|h|h.join().unwrap().unwrap().inserted).collect();assert_eq!(results.iter().filter(|v|**v).count(),1);
    let handles:Vec<_>=(21..=32).map(|n|{let s=s.clone();let e=token.clone();thread::spawn(move||s.insert(&e,&payload(n)))}).collect();
    s.clear().unwrap();for h in handles{match h.join().unwrap(){Ok(_) => {},Err(e)=>assert_eq!(e.code,"STALE_GENERATION")}}
    assert!(s.list(100,None).unwrap().items.is_empty());
}
#[test]
fn separate_repository_instances_share_durable_epoch_and_transactions(){
    let t=TempStore::new();let root=t.root.clone();let s=t.service();let epoch=s.begin_write().unwrap().generation;
    s.set_preferences(PreferencePatch{theme:None,history_auto_save:Some(true)}).unwrap();
    let jobs:Vec<_>=(1..=8).map(|n|{let root=root.clone();let epoch=epoch.clone();thread::spawn(move||StorageService::new(Ok(root)).insert(&epoch,&payload(n)))}).collect();
    for j in jobs{assert!(j.join().unwrap().unwrap().inserted);}
    assert_eq!(s.list(100,None).unwrap().items.len(),8);
}
#[test]
fn preferences_are_typed_persistent_and_clear_does_not_reset_them(){
    let t=TempStore::new();let s=t.service();s.set_preferences(PreferencePatch{theme:Some(Theme::Dark),history_auto_save:Some(true)}).unwrap();s.clear().unwrap();drop(s);
    assert_eq!(t.service().preferences().unwrap(),Preferences{theme:Theme::Dark,history_auto_save:true});
    assert!(serde_json::from_str::<PreferencePatch>(r#"{"theme":"rainbow"}"#).is_err());assert!(serde_json::from_str::<PreferencePatch>(r#"{"sql":"DELETE"}"#).is_err());
}
#[test]
fn migrates_v1_without_losing_original_simulation_or_preferences(){
    let t=TempStore::new();let cases=super::migration_tests::seed_old_database(&t.db(),1,"WAL");let p=cases[0]["payload"].as_str().unwrap();let s=t.service();
    assert_eq!(s.info().unwrap().schema_version,4);assert_eq!(s.get(&id(&p)).unwrap().unwrap(),p);assert_eq!(s.preferences().unwrap().theme,Theme::Dark);
}
#[test]
fn migration_failure_rolls_back_and_can_be_retried_after_repair(){
    let t=TempStore::new();let cases=super::migration_tests::seed_old_database(&t.db(),1,"WAL");let p=cases[0]["payload"].as_str().unwrap();let s=t.service();super::backup::set_fault(Some("after-copy"),false);
    assert_eq!(s.info().unwrap_err().code,"MIGRATION_FAILED");
    super::backup::set_fault(None,false);let c=Connection::open(t.db()).unwrap();assert_eq!(c.query_row("SELECT version FROM schema_version",[],|r|r.get::<_,i64>(0)).unwrap(),1);assert_eq!(c.query_row("SELECT payload FROM simulations WHERE execution_id=?1",[id(&p)],|r|r.get::<_,String>(0)).unwrap(),p);
    drop(c);assert_eq!(s.get(&id(&p)).unwrap().unwrap(),p);
}
#[test]
fn incompatible_database_is_not_reset_or_downgraded(){
    let t=TempStore::new();let s=t.service();insert(&s,&payload(1));let c=Connection::open(t.db()).unwrap();c.execute_batch("UPDATE schema_version SET version=99; PRAGMA user_version=99;").unwrap();drop(c);
    let bytes=fs::read(t.db()).unwrap();assert_eq!(s.info().unwrap_err().code,"INCOMPATIBLE_SCHEMA");assert_eq!(s.recover_corrupt("quarantine-corrupt-database").unwrap_err().code,"RECOVERY_NOT_ALLOWED");assert_eq!(fs::read(t.db()).unwrap(),bytes);
}
#[test]
fn corrupt_database_requires_explicit_quarantine_and_preserves_original_bytes(){
    let t=TempStore::new();fs::create_dir_all(&t.root).unwrap();let original=b"not a sqlite database - synthetic test";fs::write(t.db(),original).unwrap();let s=t.service();
    assert_eq!(s.info().unwrap_err().code,"CORRUPT_DATABASE");assert_eq!(fs::read(t.db()).unwrap(),original);
    assert_eq!(s.recover_corrupt("wrong").unwrap_err().code,"RECOVERY_NOT_ALLOWED");
    let result=s.recover_corrupt("quarantine-corrupt-database").unwrap();assert_eq!(fs::read(Path::new(&result.quarantine_path).join("payroll.sqlite3")).unwrap(),original);
    assert!(s.list(10,None).unwrap().items.is_empty());assert_eq!(s.info().unwrap().generation,result.generation);
}
#[test]
fn malformed_payloads_floats_future_versions_and_package_mismatch_are_rejected_atomically(){
    let t=TempStore::new();let s=t.service();let p=payload(1);insert(&s,&p);let e=s.begin_write().unwrap().generation;
    for change in [0,1,2,3,4,5,6] {
        let mut v:Value=serde_json::from_str(&payload(2)).unwrap();
        match change {0=>v["value"]["schemaVersion"]=99.into(),1=>v["value"]["capture"]["form"]["amount"]=15000.5.into(),2=>v["value"]["fiscalPackage"]["sha256"]="0".repeat(64).into(),3=>v["value"]["outcome"]["report"]["net"]["amount"]=13202.64.into(),4=>v["value"]["execution"]["fiscalDate"]="2027-02-01".into(),5=>v["value"]["execution"]["completedLocalTime"]="99:99:99".into(),_=>v["value"]["execution"]["utcOffsetMinutes"]=99999.into()}
        assert!(s.insert(&e,&v.to_string()).is_err());
    }
    assert!(s.insert(&e,&"x".repeat(validation::MAX_PAYLOAD+1)).is_err());assert_eq!(s.get(&id(&p)).unwrap().unwrap(),p);assert_eq!(s.list(100,None).unwrap().items.len(),1);
}
#[test]
fn record_checksum_and_snapshot_version_errors_are_visible_not_silently_recalculated(){
    let t=TempStore::new();let s=t.service();let p=payload(1);insert(&s,&p);let c=Connection::open(t.db()).unwrap();c.execute("UPDATE simulations SET payload='{}'",[]).unwrap();drop(c);
    assert_eq!(s.get(&id(&p)).unwrap_err().code,"CORRUPT_RECORD");
    let mut future:Value=serde_json::from_str(&p).unwrap();future["value"]["schemaVersion"]=5.into();let text=future.to_string();let c=Connection::open(t.db()).unwrap();c.execute("UPDATE simulations SET payload=?1,payload_sha256=?2",params![text,validation::digest(text.as_bytes())]).unwrap();drop(c);
    assert_eq!(s.get(&id(&p)).unwrap_err().code,"INCOMPATIBLE_SCHEMA");
}
#[test]
fn storage_failures_are_generic_and_cannot_log_salary_or_sql(){
    let t=TempStore::new();fs::write(&t.root,b"a file, not a directory").unwrap();let s=t.service();let e=s.info().unwrap_err();assert_eq!(e.code,"IO_ERROR");assert!(!e.message.contains("15000"));fs::remove_file(&t.root).unwrap();
    assert_eq!(StorageService::new(Err(failure("UNAVAILABLE"))).info().unwrap_err().code,"UNAVAILABLE");
    assert_eq!(t.service().get("'; DROP TABLE simulations;--").unwrap_err().code,"INVALID_ARGUMENT");
}
#[test]
fn validation_never_panics_on_invalid_unicode_dates(){
    assert!(!validation::civil("ééééé"));assert!(!validation::instant("éééééééééééé"));assert!(!validation::civil("2026-02-30"));
    assert!(!validation::uuid("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"));
}
#[test]
fn corrupt_list_index_is_not_presented_as_an_original_result(){
    let t=TempStore::new();let s=t.service();insert(&s,&payload(1));let c=Connection::open(t.db()).unwrap();c.execute("UPDATE simulations SET requested_amount='999.99'",[]).unwrap();drop(c);
    assert_eq!(s.list(10,None).unwrap_err().code,"CORRUPT_RECORD");
}
#[test]
fn concurrent_first_open_applies_migrations_once(){
    let t=TempStore::new();let barrier=Arc::new(Barrier::new(4));
    let jobs:Vec<_>=(0..4).map(|_|{let root=t.root.clone();let b=barrier.clone();thread::spawn(move||{b.wait();StorageService::new(Ok(root)).info()})}).collect();
    let generations:Vec<_>=jobs.into_iter().map(|j|j.join().unwrap().unwrap().generation).collect();
    assert!(generations.iter().all(|g|g==&generations[0]));assert_eq!(t.service().info().unwrap().schema_version,4);
}
#[test]
fn sqlite_write_failure_rolls_back_and_preserves_confirmed_records(){
    let t=TempStore::new();let s=t.service();let p=payload(1);insert(&s,&p);let e=s.begin_write().unwrap().generation;
    let c=Connection::open(t.db()).unwrap();c.execute_batch("CREATE TRIGGER synthetic_write_failure BEFORE INSERT ON simulations BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;").unwrap();drop(c);
    assert_eq!(s.insert(&e,&payload(2)).unwrap_err().code,"IO_ERROR");assert_eq!(s.get(&id(&p)).unwrap().unwrap(),p);assert_eq!(s.list(100,None).unwrap().items.len(),1);
    let c=Connection::open(t.db()).unwrap();c.execute("DROP TRIGGER synthetic_write_failure",[]).unwrap();drop(c);assert!(s.insert(&e,&payload(2)).unwrap().inserted);
}
#[test]
fn automatic_insert_requires_persisted_consent(){
    let t=TempStore::new();let s=t.service();let e=s.begin_write().unwrap().generation;
    assert_eq!(s.insert_automatic(&e,&payload(1)).unwrap_err().code,"AUTO_SAVE_DISABLED");
    assert_eq!(s.insert(&e,&payload(1)).unwrap_err().code,"AUTO_SAVE_DISABLED");
    s.set_preferences(PreferencePatch{theme:None,history_auto_save:Some(true)}).unwrap();
    assert!(s.insert_automatic(&e,&payload(1)).unwrap().inserted);
}
#[test]
fn disabling_has_atomic_cutoff_preserves_records_and_fences_reenable(){
    let t=TempStore::new();let s=t.service();s.set_preferences(PreferencePatch{theme:None,history_auto_save:Some(true)}).unwrap();
    let before=s.begin_write().unwrap().generation;s.insert_automatic(&before,&payload(1)).unwrap();
    s.set_preferences(PreferencePatch{theme:None,history_auto_save:Some(false)}).unwrap();
    assert_eq!(s.insert_automatic(&before,&payload(2)).unwrap_err().code,"STALE_GENERATION");assert_eq!(s.list(100,None).unwrap().items.len(),1);
    let disabled=s.begin_write().unwrap().generation;assert_eq!(s.insert_automatic(&disabled,&payload(2)).unwrap_err().code,"AUTO_SAVE_DISABLED");
    s.set_preferences(PreferencePatch{theme:None,history_auto_save:Some(true)}).unwrap();assert_eq!(s.insert_automatic(&before,&payload(2)).unwrap_err().code,"STALE_GENERATION");
    assert!(s.insert_automatic(&disabled,&payload(2)).unwrap().inserted);
}
#[test]
fn pending_automatic_writes_cannot_commit_after_disable_cutoff(){
    let t=TempStore::new();let s=Arc::new(t.service());s.set_preferences(PreferencePatch{theme:None,history_auto_save:Some(true)}).unwrap();let epoch=s.begin_write().unwrap().generation;
    let ready=Arc::new(Barrier::new(2));let go=Arc::new(Barrier::new(2));let ss=s.clone();let r=ready.clone();let g=go.clone();
    let job=thread::spawn(move||{r.wait();g.wait();ss.insert_automatic(&epoch,&payload(2))});ready.wait();s.set_preferences(PreferencePatch{theme:None,history_auto_save:Some(false)}).unwrap();go.wait();
    assert_eq!(job.join().unwrap().unwrap_err().code,"STALE_GENERATION");assert!(s.list(10,None).unwrap().items.is_empty());
}
