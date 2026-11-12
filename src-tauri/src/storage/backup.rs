use super::*;
use sha2::{Digest,Sha256};
use std::{fs::OpenOptions,io::{Write,Read},thread,time::Instant};

#[cfg(test)] thread_local!{static FAULT:std::cell::Cell<Option<&'static str>>=const{std::cell::Cell::new(None)};static CRASH:std::cell::Cell<bool>=const{std::cell::Cell::new(false)};}
#[cfg(test)] pub fn set_fault(point:Option<&'static str>,crash:bool){FAULT.with(|f|f.set(point));CRASH.with(|f|f.set(crash));}
#[cfg(test)] pub fn fault(point:&str)->Result<()> {if std::env::var("NOMINA_V3_STOP").ok().as_deref()==Some(point){println!("V3_READY:{point}");use std::io::Write;std::io::stdout().flush().unwrap();loop{thread::park();}}if FAULT.with(|f|f.get()==Some(point)){if CRASH.with(|c|c.get()){std::process::exit(73);}return Err(failure("MIGRATION_FAILED"));}Ok(())}

/** All new repository instances coordinate filesystem maintenance as well as SQL.
 * The file contains no salaries; the OS releases its advisory lock on a crash. */
pub fn maintenance_lock(root:&Path)->Result<fs::File>{
    fs::create_dir_all(root).map_err(|_|failure("IO_ERROR"))?;
    let file=OpenOptions::new().create(true).truncate(false).read(true).write(true).open(root.join(".history-maintenance.lock")).map_err(|_|failure("IO_ERROR"))?;
    let start=Instant::now();loop {match file.try_lock(){Ok(())=>return Ok(file),Err(_) if start.elapsed()<Duration::from_secs(5)=>thread::sleep(Duration::from_millis(20)),Err(_)=>return Err(failure("BUSY"))}}
}
fn table_exists(c:&Connection,name:&str)->Result<bool>{c.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",[name],|r|r.get(0)).map_err(db_error)}
pub fn table_digest(c:&Connection,name:&str,identity:&str)->Result<String>{
    // All names are internal constants, not IPC arguments.
    if !["schema_version","store_meta","fiscal_packages","simulations","simulations_new","preferences","deleted_executions"].contains(&name){return Err(failure("INVALID_ARGUMENT"));}
    let mut hash=Sha256::new();hash.update(identity.as_bytes());
    if !table_exists(c,name)?{return Ok(format!("{:x}",hash.finalize()));}
    let mut stmt=c.prepare(&format!("SELECT * FROM {name} ORDER BY 1")).map_err(db_error)?;let columns=stmt.column_count();let mut rows=stmt.query([]).map_err(db_error)?;
    while let Some(row)=rows.next().map_err(db_error)? {for i in 0..columns {
        use rusqlite::types::ValueRef;
        let (kind,bytes)=match row.get_ref(i).map_err(db_error)? {ValueRef::Null=>(0,vec![]),ValueRef::Integer(v)=>(1,v.to_le_bytes().to_vec()),ValueRef::Real(v)=>(2,v.to_bits().to_le_bytes().to_vec()),ValueRef::Text(v)=>(3,v.to_vec()),ValueRef::Blob(v)=>(4,v.to_vec())};
        hash.update([kind]);hash.update((bytes.len() as u64).to_le_bytes());hash.update(bytes);
    }}Ok(format!("{:x}",hash.finalize()))
}
pub fn logical_digest(c:&Connection)->Result<String>{
    let mut hash=Sha256::new();
    for name in ["schema_version","store_meta","fiscal_packages","simulations","preferences","deleted_executions"] {hash.update(table_digest(c,name,name)?.as_bytes());}
    let version:i64=c.query_row("PRAGMA user_version",[],|r|r.get(0)).map_err(db_error)?;hash.update(version.to_le_bytes());Ok(format!("{:x}",hash.finalize()))
}
pub fn preserved_digest(c:&Connection)->Result<String>{
    let mut hash=Sha256::new();for name in ["store_meta","fiscal_packages","simulations","preferences","deleted_executions"]{hash.update(table_digest(c,name,name)?.as_bytes());}Ok(format!("{:x}",hash.finalize()))
}
pub fn check_integrity(c:&Connection)->Result<()> {
    let mut stmt=c.prepare("PRAGMA integrity_check").map_err(db_error)?;
    let messages=stmt.query_map([],|r|r.get::<_,String>(0)).map_err(db_error)?.collect::<std::result::Result<Vec<_>,_>>().map_err(db_error)?;
    if messages!=["ok"]{return Err(failure("CORRUPT_DATABASE"));}
    let mut check=c.prepare("PRAGMA foreign_key_check").map_err(db_error)?;
    if check.query([]).map_err(db_error)?.next().map_err(db_error)?.is_some(){return Err(failure("CORRUPT_DATABASE"));}
    Ok(())
}
pub fn check_records(c:&Connection)->Result<()> {
    c.set_limit(rusqlite::limits::Limit::SQLITE_LIMIT_LENGTH,(validation::MAX_PAYLOAD+65536) as i32).map_err(db_error)?;
    if !table_exists(c,"simulations")?{return Ok(());}
    let mut stmt=c.prepare("SELECT execution_id,payload,payload_sha256,snapshot_version,package_sha256,completed_at,direction,requested_amount,periodicity,reference_date,classification,gross,net FROM simulations").map_err(db_error)?;
    let mut rows=stmt.query([]).map_err(db_error)?;
    while let Some(row)=rows.next().map_err(db_error)? {
        let id:String=row.get(0).map_err(db_error)?;let payload:String=row.get(1).map_err(db_error)?;let hash:String=row.get(2).map_err(db_error)?;let version:i64=row.get(3).map_err(db_error)?;let package:String=row.get(4).map_err(db_error)?;
        if validation::digest(payload.as_bytes())!=hash{return Err(failure("CORRUPT_RECORD"));}
        let index=persistence_v3::index(&payload)?;
        if index.execution_id!=id||index.snapshot_version!=version||index.package_sha!=package{return Err(failure("CORRUPT_RECORD"));}
        let expected=[&index.completed_at,&index.direction,&index.requested_amount,&index.periodicity,&index.reference_date,&index.classification];
        for (offset,value) in expected.iter().enumerate(){if row.get::<_,String>(5+offset).map_err(db_error)?!=**value{return Err(failure("CORRUPT_RECORD"));}}
        if row.get::<_,Option<String>>(11).map_err(db_error)?!=index.gross||row.get::<_,Option<String>>(12).map_err(db_error)?!=index.net{return Err(failure("CORRUPT_RECORD"));}
        let registered:Option<(String,String)>=c.query_row("SELECT package_id,version FROM fiscal_packages WHERE sha256=?1",[&package],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(db_error)?;
        let wire:Value=serde_json::from_str(&payload).map_err(|_|failure("CORRUPT_RECORD"))?;let p=&wire["value"]["fiscalPackage"];
        if !registered.map(|(id,version)|p["id"]==id&&p["version"]==version).unwrap_or(false){return Err(failure("CORRUPT_RECORD"));}
    }Ok(())
}
fn durable_json(path:&Path,value:&Value)->Result<()> {
    let mut file=OpenOptions::new().create_new(true).write(true).open(path).map_err(|_|failure("IO_ERROR"))?;
    file.write_all(value.to_string().as_bytes()).and_then(|_|file.sync_all()).map_err(|_|failure("IO_ERROR"))
}
/** Run while another connection owns BEGIN IMMEDIATE, before any DDL. */
pub fn create_backup(path:&Path,source:&Connection)->Result<()> {
    let root=path.parent().ok_or_else(||failure("UNAVAILABLE"))?;let backups=root.join("migration-backups");fs::create_dir_all(&backups).map_err(|_|failure("BACKUP_FAILED"))?;
    if fs::symlink_metadata(&backups).map_err(|_|failure("BACKUP_FAILED"))?.file_type().is_symlink(){return Err(failure("BACKUP_FAILED"));}
    let dir=backups.join(Uuid::new_v4().to_string());fs::create_dir(&dir).map_err(|_|failure("BACKUP_FAILED"))?;
    durable_json(&dir.join("creating.json"),&serde_json::json!({"purpose":"history-schema-4","containsSalaryHistory":true}))?;
    #[cfg(test)] fault("backup-created")?;
    let target=dir.join("payroll.sqlite3");let before=logical_digest(source)?;
    let auxiliary=Connection::open_with_flags(path,rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(db_error)?;
    auxiliary.execute_batch("PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;").map_err(db_error)?;
    auxiliary.execute("VACUUM main INTO ?1",[target.to_string_lossy().as_ref()]).map_err(|_|failure("BACKUP_FAILED"))?;drop(auxiliary);
    #[cfg(test)] fault("backup-unverified")?;
    let backup=Connection::open_with_flags(&target,rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(db_error)?;
    check_integrity(&backup)?;check_records(&backup)?;
    if logical_digest(&backup)?!=before{return Err(failure("BACKUP_FAILED"));}drop(backup);
    OpenOptions::new().read(true).write(true).open(&target).and_then(|f|f.sync_all()).map_err(|_|failure("BACKUP_FAILED"))?;
    durable_json(&dir.join("ready.json"),&serde_json::json!({"purpose":"history-schema-4","containsSalaryHistory":true,"logicalSha256":before,"preservedSha256":preserved_digest(source)?,"fileSha256":file_digest(&target)?}))?;
    Ok(())
}
pub fn file_digest(path:&Path)->Result<String>{let mut f=fs::File::open(path).map_err(|_|failure("BACKUP_FAILED"))?;let mut h=Sha256::new();let mut b=[0;65536];loop{let n=f.read(&mut b).map_err(|_|failure("BACKUP_FAILED"))?;if n==0{break;}h.update(&b[..n]);}Ok(format!("{:x}",h.finalize()))}
fn control(path:&Path)->Result<Value>{let m=fs::symlink_metadata(path).map_err(|_|failure("BACKUP_CLEANUP_PENDING"))?;if !m.is_file()||m.file_type().is_symlink()||m.len()>8192{return Err(failure("BACKUP_CLEANUP_PENDING"));}let mut b=String::new();fs::File::open(path).map_err(|_|failure("BACKUP_CLEANUP_PENDING"))?.take(8193).read_to_string(&mut b).map_err(|_|failure("BACKUP_CLEANUP_PENDING"))?;if b.len()>8192{return Err(failure("BACKUP_CLEANUP_PENDING"));}strict_json::parse(&b).map_err(|_|failure("BACKUP_CLEANUP_PENDING"))}
fn purpose(v:&Value)->bool{matches!(v["purpose"].as_str(),Some("history-schema-3"|"history-schema-4"))}
fn fields(v:&Value,keys:&[&str])->bool{v.as_object().map(|o|o.len()==keys.len()&&keys.iter().all(|k|o.contains_key(*k))).unwrap_or(false)}
/** Inventory and validate EVERY copy before deleting ANY. Approval is bound to
 * the individual UUID/file, never inferred from a different valid ready file. */
pub fn cleanup_backups(root:&Path,c:&Connection)->Result<()> {
    let dir=root.join("migration-backups");if !dir.exists(){return Ok(());}let m=fs::symlink_metadata(&dir).map_err(|_|failure("BACKUP_CLEANUP_PENDING"))?;if !m.is_dir()||m.file_type().is_symlink(){return Err(failure("BACKUP_CLEANUP_PENDING"));}
    let expected=preserved_digest(c)?;let legacy=dir.join("cleanup-approved.json");if legacy.exists(){let v=control(&legacy)?;if !purpose(&v)||!fields(&v,&["purpose","preservedSha256"])||v["preservedSha256"]!=expected{return Err(failure("RECOVERY_PENDING"));}}
    let mut plans=vec![];
    for e in fs::read_dir(&dir).map_err(|_|failure("BACKUP_CLEANUP_PENDING"))?{let e=e.map_err(|_|failure("BACKUP_CLEANUP_PENDING"))?;let p=e.path();if p==legacy{continue;}if !e.file_type().map_err(|_|failure("BACKUP_CLEANUP_PENDING"))?.is_dir()||!validation::uuid(&e.file_name().to_string_lossy()){return Err(failure("BACKUP_CLEANUP_PENDING"));}
        let id=e.file_name().to_string_lossy().into_owned();let mut empty=true;for child in fs::read_dir(&p).map_err(|_|failure("BACKUP_CLEANUP_PENDING"))?{let child=child.map_err(|_|failure("BACKUP_CLEANUP_PENDING"))?;empty=false;if !child.file_type().map_err(|_|failure("BACKUP_CLEANUP_PENDING"))?.is_file()||!["creating.json","ready.json","cleanup.json","payroll.sqlite3","payroll.sqlite3-journal","payroll.sqlite3-wal","payroll.sqlite3-shm"].contains(&child.file_name().to_string_lossy().as_ref()){return Err(failure("BACKUP_CLEANUP_PENDING"));}}
        if empty{plans.push((p,None));continue;}
        let approval=p.join("cleanup.json");let db=p.join("payroll.sqlite3");if approval.exists(){let a=control(&approval)?;if !fields(&a,&["purpose","directoryId","preservedSha256","validatedFileSha256"])||a["purpose"]!="history-schema-4-cleanup"||a["directoryId"]!=id||a["preservedSha256"]!=expected||(db.exists()&&a["validatedFileSha256"]!=file_digest(&db)?){return Err(failure("RECOVERY_PENDING"));}plans.push((p,Some(a)));continue;}
        let creating=control(&p.join("creating.json"))?;if !purpose(&creating)||!fields(&creating,&["purpose","containsSalaryHistory"])||creating["containsSalaryHistory"]!=true{return Err(failure("BACKUP_CLEANUP_PENDING"));}
        let ready=if p.join("ready.json").exists(){let v=control(&p.join("ready.json"))?;if !purpose(&v)||!fields(&v,&["purpose","containsSalaryHistory","logicalSha256","preservedSha256","fileSha256"])||v["containsSalaryHistory"]!=true||v["preservedSha256"]!=expected{return Err(failure("RECOVERY_PENDING"));}Some(v)}else{None};
        let file_sha=if db.exists(){let copy=Connection::open_with_flags(&db,rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|_|failure("RECOVERY_PENDING"))?;check_integrity(&copy).map_err(|_|failure("RECOVERY_PENDING"))?;check_records(&copy).map_err(|_|failure("RECOVERY_PENDING"))?;let version:i64=copy.query_row("PRAGMA user_version",[],|r|r.get(0)).map_err(db_error)?;if !(1..=4).contains(&version){return Err(failure("RECOVERY_PENDING"));}super::check_schema(&copy,version)?;if preserved_digest(&copy)?!=expected{return Err(failure("RECOVERY_PENDING"));}let logical=logical_digest(&copy)?;drop(copy);let actual=file_digest(&db)?;if let Some(v)=&ready{if v["fileSha256"]!=actual||v["logicalSha256"]!=logical{return Err(failure("RECOVERY_PENDING"));}}Some(actual)}else{if ["payroll.sqlite3-journal","payroll.sqlite3-wal","payroll.sqlite3-shm"].iter().any(|n|p.join(n).exists()){return Err(failure("RECOVERY_PENDING"));}None};
        plans.push((p,Some(serde_json::json!({"purpose":"history-schema-4-cleanup","directoryId":id,"preservedSha256":expected,"validatedFileSha256":file_sha}))));
    }
    for (p,plan) in plans{if let Some(plan)=plan{let a=p.join("cleanup.json");if !a.exists(){durable_json(&a,&plan)?;}for name in ["payroll.sqlite3","payroll.sqlite3-journal","payroll.sqlite3-wal","payroll.sqlite3-shm","ready.json","creating.json"]{let file=p.join(name);if file.exists(){fs::remove_file(file).map_err(|_|failure("BACKUP_CLEANUP_PENDING"))?;}}
        #[cfg(test)]fault("cleanup-after-marker")?;
        fs::remove_file(a).map_err(|_|failure("BACKUP_CLEANUP_PENDING"))?;}fs::remove_dir(p).map_err(|_|failure("BACKUP_CLEANUP_PENDING"))?;}
    if legacy.exists(){fs::remove_file(legacy).map_err(|_|failure("BACKUP_CLEANUP_PENDING"))?;}
    #[cfg(test)]fault("cleanup-after-approval")?;
    fs::remove_dir(dir).map_err(|_|failure("BACKUP_CLEANUP_PENDING"))?;Ok(())
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn vacuum_into_under_writer_lock_is_recoverable_in_both_modes(){
        for mode in ["WAL","DELETE"] {
            let root=std::env::temp_dir().join(format!("nomina-backup-probe-{}",Uuid::new_v4()));fs::create_dir(&root).unwrap();let path=root.join("payroll.sqlite3");
            let c=Connection::open(&path).unwrap();c.execute_batch(&format!("PRAGMA journal_mode={mode}; CREATE TABLE schema_version(id INTEGER PRIMARY KEY,version INTEGER);INSERT INTO schema_version VALUES(1,2);PRAGMA user_version=2;CREATE TABLE preferences(id INTEGER PRIMARY KEY, history_auto_save INTEGER);INSERT INTO preferences VALUES(1,0);")).unwrap();
            c.execute_batch("BEGIN IMMEDIATE").unwrap();create_backup(&path,&c).unwrap();
            println!("SQLite {}: VACUUM INTO while BEGIN IMMEDIATE, journal={mode}: passed",c.query_row("SELECT sqlite_version()",[],|r|r.get::<_,String>(0)).unwrap());
            c.execute_batch("ROLLBACK").unwrap();drop(c);fs::remove_dir_all(root).unwrap();
        }
    }
}
