use super::*;
use self::core::canonical;

// This copy is migration evidence, separate from the existing single managed
// backup. Neither is restored or deleted automatically.
fn migration_base(repo:&Repository)->PathBuf{repo.root.join("fiscal/recovery/migration-2")}
pub(super) fn check_copy(repo:&Repository,c:&Connection,m:&Marker,exact:bool)->Result<Option<PathBuf>>{
    let recovery=repo.root.join("fiscal/recovery");if !paths::present(&recovery)?{return Ok(None);}paths::directory(&recovery)?;
    for e in fs::read_dir(&recovery)?{if e?.file_name()!="migration-2"{return Err(fail("RECOVERY_PENDING"));}}
    let base=migration_base(repo);if !paths::present(&base)?{return Ok(None);}paths::directory(&base)?;let dirs=fs::read_dir(&base)?.collect::<std::io::Result<Vec<_>>>()?;if dirs.len()!=1{return Err(fail("RECOVERY_PENDING"));}
    let dir=dirs[0].path();paths::directory(&dir)?;if uuid::Uuid::parse_str(&dirs[0].file_name().to_string_lossy()).is_err(){return Err(fail("RECOVERY_PENDING"));}
    for e in fs::read_dir(&dir)?{let e=e?;if !["creating.json","ready.json","repository.sqlite3"].contains(&e.file_name().to_string_lossy().as_ref()){return Err(fail("RECOVERY_PENDING"));}paths::regular(&e.path())?;}
    let bytes=paths::bounded(&dir.join("ready.json"),limits::MANIFEST)?;let v=core::strict_json::parse_with_limit(&bytes,limits::MANIFEST as usize)?;canonical::require_wire(&bytes,&v)?;let ready:BackupManifest=core::decode_closed(&v)?;
    if ready.version!=1||ready.purpose!="mx.nomina.fiscal-backup.v1"||ready.repository_id!=m.repository_id||paths::marker(&dir.join("creating.json"))?!=*m{return Err(fail("RECOVERY_PENDING"));}
    let copy=schema::open(&dir.join("repository.sqlite3"),true)?;if schema::version(&copy)?!=1{return Err(fail("RECOVERY_PENDING"));}replay::rebuild(&copy,&repo.policy,m)?;
    let(_,generation,head,_)=meta(&copy)?;let expected=if generation==0{"0".repeat(64)}else{c.query_row("SELECT entry_hash FROM operations WHERE seq=?1",[generation],|r|r.get::<_,String>(0))?};
    if generation!=ready.generation||head!=ready.head||head!=expected||recovery::file_hash(&dir.join("repository.sqlite3"))?!=ready.file_sha256||(exact&&schema::preserved(&copy)?!=schema::preserved(c)?){return Err(fail("RECOVERY_PENDING"));}Ok(Some(dir))
}
pub(super) fn ensure(repo:&Repository,mut c:Connection,m:&Marker)->Result<Connection>{
    if schema::version(&c)?==2{check_copy(repo,&c,m,false)?;return Ok(c);}schema::check(&c)?;
    let tx=c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;replay::rebuild(&tx,&repo.policy,m)?;recovery::check_pending(repo,&tx,m)?;let preserved=schema::preserved(&tx)?;
    if check_copy(repo,&tx,m,true)?.is_none(){let recovery=repo.root.join("fiscal/recovery");if !paths::present(&recovery)?{fs::create_dir(&recovery)?;paths::private_directory(&recovery)?;}recovery::copy_at(repo,&tx,m,&migration_base(repo))?;}
    point("migration-backup-ready")?;schema::upgrade(&tx)?;point("migration-after-ddl")?;schema::check(&tx)?;replay::rebuild(&tx,&repo.policy,m)?;if schema::preserved(&tx)?!=preserved{return Err(fail("MIGRATION_PRESERVATION_FAILED"));}point("migration-before-commit")?;
    let committed=tx.commit();if committed.is_ok(){point("migration-after-commit").map_err(|_|fail("MIGRATION_COMMITTED_RECOVERY_PENDING"))?;}drop(c);
    let reopened=schema::open(&repo.db(),false).map_err(|_|fail("MIGRATION_OUTCOME_UNKNOWN"))?;let version=schema::version(&reopened).map_err(|_|fail("MIGRATION_OUTCOME_UNKNOWN"))?;
    if version!=2{return Err(if version==1&&committed.is_err(){fail("MIGRATION_NOT_COMMITTED")}else{fail("MIGRATION_OUTCOME_UNKNOWN")});}
    replay::rebuild(&reopened,&repo.policy,m).map_err(|_|fail("MIGRATION_COMMITTED_RECOVERY_PENDING"))?;if schema::preserved(&reopened)?!=preserved{return Err(fail("MIGRATION_COMMITTED_RECOVERY_PENDING"));}check_copy(repo,&reopened,m,false)?;point("migration-reopened")?;Ok(reopened)
}
