mod validation;
mod backup;
mod strict_json;
mod budget_v3;
mod validation_v3;
mod validation_compat_v1;
mod v3_authority;
mod persistence_v3;
pub(crate) use persistence_v3::compat_complete;
pub(crate) use v3_authority::{InitialEligibility,StoreRoute,StoreOutcome};
pub mod commands;
#[cfg(test)] mod tests;
#[cfg(test)] mod migration_tests;
#[cfg(test)] mod v3_tests;
#[cfg(test)] mod compatibility_tests;
#[cfg(test)] mod compat_finalization_tests;
#[cfg(test)] mod compat_persistence_tests;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs, path::{Path, PathBuf}, sync::Mutex, time::Duration};
use uuid::Uuid;
use validation::{digest, validate_snapshot};

const SCHEMA_VERSION: i64 = 4;
const MIGRATION_1: &str = include_str!("migrations/001.sql");
const MIGRATION_2: &str = include_str!("migrations/002.sql");
const MIGRATION_3: &str = include_str!("migrations/003.sql");
const MIGRATION_4: &str = include_str!("migrations/004.sql");

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all="camelCase")]
pub struct StoreError { pub code: String, pub message: String, pub retryable: bool }
pub fn failure(code: &str) -> StoreError {
    let message = match code {
        "CORRUPT_DATABASE" => "La base local está dañada. Se conserva sin reemplazarla automáticamente.",
        "INCOMPATIBLE_SCHEMA" => "La versión almacenada no es compatible con esta aplicación.",
        "MIGRATION_FAILED" => "La migración local no pudo completarse; se conserva la evidencia para verificar y reintentar.",
        "MIGRATION_COMMITTED_VERIFICATION_PENDING" => "La migración fue confirmada, pero falta completar su verificación o limpieza. No se afirma una reversión.",
        "MIGRATION_OUTCOME_UNKNOWN" => "No se pudo determinar el estado final de la migración. Se conserva el respaldo; no se afirma éxito ni reversión.",
        "V3_WRITE_CLOSED" => "Snapshot v3 requiere una finalización nativa vigente y su referencia de autoridad. Este intento no las aporta.",
        "INVALID_SNAPSHOT" => "El snapshot fiscal está incompleto, es incompatible o excede los límites.",
        "INVALID_ARGUMENT" => "Los argumentos de la operación local no son válidos.",
        "STALE_GENERATION" => "La escritura o página pertenece a una generación anterior del historial.",
        "AUTO_SAVE_DISABLED" => "El guardado automático está desactivado; no se insertó la simulación.",
        "BACKUP_FAILED" => "No se pudo verificar el respaldo temporal del Historial salarial. La migración no se confirmó; se conserva el respaldo disponible para recuperación.",
        "BACKUP_CLEANUP_PENDING" => "El respaldo temporal contiene Historial salarial y no pudo eliminarse. La limpieza y cualquier borrado completo siguen pendientes; revisa permisos y reintenta.",
        "RECOVERY_PENDING" => "Hay un respaldo de Historial salarial que todavía requiere recuperación o verificación. No se eliminó ni se restauró automáticamente; el borrado completo no ha concluido.",
        "DELETED_EXECUTION" => "La ejecución fue eliminada y no puede reinsertarse accidentalmente.",
        "DUPLICATE_CONFLICT" => "El ID ya existe con otro snapshot; el original se conserva.",
        "CORRUPT_RECORD" => "Un registro local no superó la verificación de integridad.",
        "BUSY" => "El almacenamiento local está ocupado; vuelve a intentar la operación.",
        "RECOVERY_NOT_ALLOWED" => "La recuperación solo se admite para una base corrupta y con confirmación explícita.",
        "UNAVAILABLE" => "No está disponible el almacenamiento local de la aplicación.",
        _ => "No se pudo completar la lectura o escritura local. Los cálculos no se modificaron.",
    };
    StoreError { code:code.into(), message:message.into(), retryable:code=="BUSY" }
}
fn db_error(e: rusqlite::Error) -> StoreError {
    use rusqlite::ErrorCode;
    match e.sqlite_error_code() {
        Some(ErrorCode::DatabaseCorrupt|ErrorCode::NotADatabase) => failure("CORRUPT_DATABASE"),
        Some(ErrorCode::DatabaseBusy|ErrorCode::DatabaseLocked) => failure("BUSY"),
        _ => failure("IO_ERROR"),
    }
}
type Result<T> = std::result::Result<T, StoreError>;
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Preferences { pub theme: Theme, pub history_auto_save: bool }
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all="lowercase")]
pub enum Theme { Light, Dark }
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct PreferencePatch { pub theme: Option<Theme>, pub history_auto_save: Option<bool> }
#[derive(Debug, Clone, Serialize)]
pub struct WriteSession { pub generation: String }
#[derive(Debug, Serialize)]
#[serde(rename_all="camelCase")]
pub struct StorageInfo { pub schema_version: i64, pub database_path: String, pub generation: String, pub encrypted: bool }
#[derive(Debug, Serialize)]
#[serde(rename_all="camelCase")]
pub struct InsertResult { pub execution_id: String, pub inserted: bool }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Cursor { pub completed_at: String, pub execution_id: String, pub generation: String }
#[derive(Debug, Serialize)]
#[serde(rename_all="camelCase")]
pub struct HistoryItem { pub execution_id:String, pub direction:String, pub requested_amount:String, pub periodicity:String, pub completed_at:String, pub reference_date:String, pub classification:String, pub gross:Option<String>, pub net:Option<String> }
#[derive(Debug, Serialize)]
#[serde(rename_all="camelCase")]
pub struct HistoryPage { pub items:Vec<HistoryItem>, pub next_cursor:Option<Cursor>, pub generation:String }
#[derive(Debug, Serialize)]
pub struct DeleteResult { pub deleted: bool }
#[derive(Debug, Serialize)]
#[serde(rename_all="camelCase")]
pub struct RecoveryResult { pub quarantine_path: String, pub generation: String }

/** Sin conexión persistente. Cada frontera explícita usa
 * una conexión breve bajo exclusión mutua y transacciones SQLite entre procesos. */
pub struct StorageService { root: Result<PathBuf>, gate: Mutex<()> }
impl StorageService {
    pub(crate) fn validate_compat_material(package:&Value,head:&Value)->Result<()>{validation_compat_v1::material_shape(Some(package),head)}
    pub(crate) fn validate_compat_head(head:&Value)->Result<()>{validation_compat_v1::material_shape(None,head)}
    /// Native finalization validation ONLY. The legacy writer gate in
    /// v3_authority is deliberately not redirected through this method.
    pub(crate) fn validate_readonly_finalization(payload:&str)->Result<()>{
        let index=validation::validate_snapshot_for_read(payload)?;
        let wire:Value=serde_json::from_str(payload).map_err(|_|failure("INVALID_SNAPSHOT"))?;
        let s=&wire["value"];let p=&s["executionProvenance"];
        if index.snapshot_version!=3||s["documentKind"]!="execution-record"||p["producerId"]!="nomina-signed-fiscal-document-v3-v2"||p["authorizationObservation"]["kind"]!="native-observation-v1"{return Err(failure("INVALID_SNAPSHOT"));}
        Ok(())
    }
    pub fn new(root: Result<PathBuf>) -> Self { Self { root, gate:Mutex::new(()) } }
    fn path(&self) -> Result<PathBuf> { let root = self.root.clone()?; if !root.is_absolute() {return Err(failure("UNAVAILABLE"));} Ok(root.join("payroll.sqlite3")) }
    fn with<T>(&self, action: impl FnOnce(&mut Connection)->Result<T>) -> Result<T> {
        let _guard = self.gate.lock().map_err(|_| failure("UNAVAILABLE"))?;
        let path=self.path()?;let _maintenance=backup::maintenance_lock(path.parent().ok_or_else(||failure("UNAVAILABLE"))?)?;
        let mut conn = open_database(&path)?; action(&mut conn)
    }
    pub fn info(&self) -> Result<StorageInfo> { self.with(|c| Ok(StorageInfo { schema_version:SCHEMA_VERSION, database_path:self.path()?.to_string_lossy().into(), generation:generation(c)?, encrypted:false })) }
    pub fn begin_write(&self) -> Result<WriteSession> { self.with(|c| Ok(WriteSession { generation:generation(c)? })) }
    pub fn insert(&self, epoch:&str, payload:&str) -> Result<InsertResult> {
        // No productive explicit-save UI exists. Both exposed write commands
        // require persisted opt-in; storage_insert cannot bypass privacy.
        self.insert_internal(epoch,payload,true)
    }
    pub fn insert_automatic(&self, epoch:&str, payload:&str) -> Result<InsertResult> {
        self.insert_internal(epoch,payload,true)
    }
    fn insert_internal(&self, epoch:&str, payload:&str, automatic:bool) -> Result<InsertResult> {
        if !validation::uuid(epoch) { return Err(failure("INVALID_ARGUMENT")); }
        let s = validate_snapshot(payload,true)?; let checksum = digest(payload.as_bytes());
        self.with(|c| {
            let tx = c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(db_error)?;
            if generation(&tx)? != epoch { return Err(failure("STALE_GENERATION")); }
            if automatic && !read_preferences(&tx)?.history_auto_save { return Err(failure("AUTO_SAVE_DISABLED")); }
            let deleted:bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM deleted_executions WHERE execution_id=?1)",[&s.execution_id],|r|r.get(0)).map_err(db_error)?;
            if deleted { return Err(failure("DELETED_EXECUTION")); }
            let existing:Option<(String,String)> = tx.query_row("SELECT payload_sha256,payload FROM simulations WHERE execution_id=?1",[&s.execution_id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(db_error)?;
            if let Some((old,bytes)) = existing { if digest(bytes.as_bytes())!=old{return Err(failure("CORRUPT_RECORD"));} if old != checksum {return Err(failure("DUPLICATE_CONFLICT"));} return Ok(InsertResult{execution_id:s.execution_id,inserted:false}); }
            let wire:Value=serde_json::from_str(payload).map_err(|_|failure("INVALID_SNAPSHOT"))?;let p=&wire["value"]["fiscalPackage"];
            tx.execute("INSERT OR IGNORE INTO fiscal_packages(sha256,package_id,version,metadata_json) VALUES(?1,?2,?3,?4)",params![s.package_sha,p["id"].as_str(),p["version"].as_str(),p.to_string()]).map_err(db_error)?;
            let registered:(String,String)=tx.query_row("SELECT package_id,version FROM fiscal_packages WHERE sha256=?1",[&s.package_sha],|r|Ok((r.get(0)?,r.get(1)?))).map_err(db_error)?;
            if Some(registered.0.as_str())!=p["id"].as_str()||Some(registered.1.as_str())!=p["version"].as_str(){return Err(failure("INVALID_SNAPSHOT"));}
            tx.execute("INSERT INTO simulations(execution_id,completed_at,direction,requested_amount,periodicity,reference_date,classification,gross,net,package_sha256,snapshot_version,payload,payload_sha256) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",params![s.execution_id,s.completed_at,s.direction,s.requested_amount,s.periodicity,s.reference_date,s.classification,s.gross,s.net,s.package_sha,s.snapshot_version,payload,checksum]).map_err(db_error)?;
            tx.commit().map_err(db_error)?;
            Ok(InsertResult{execution_id:s.execution_id,inserted:true})
        })
    }
    pub fn get(&self,id:&str) -> Result<Option<String>> {
        if !validation::uuid(id) {return Err(failure("INVALID_ARGUMENT"));}
        self.with(|c| {
            let row:Option<(String,String,String,i64)> = c.query_row("SELECT payload,payload_sha256,package_sha256,snapshot_version FROM simulations WHERE execution_id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(db_error)?;
            row.map(|(payload,checksum,package,version)| {
                if digest(payload.as_bytes()) != checksum {return Err(failure("CORRUPT_RECORD"));}
                let index = validation::validate_snapshot_for_read(&payload).map_err(|e| if e.code=="INCOMPATIBLE_SCHEMA" {e} else {failure("CORRUPT_RECORD")})?;
                if index.execution_id != id || index.package_sha != package || index.snapshot_version!=version {return Err(failure("CORRUPT_RECORD"));}
                let meta:Option<(String,String)> = c.query_row("SELECT package_id,version FROM fiscal_packages WHERE sha256=?1",[package],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(db_error)?;
                let wire:Value=serde_json::from_str(&payload).map_err(|_|failure("CORRUPT_RECORD"))?;
                if !meta.map(|(id,v)|wire["value"]["fiscalPackage"]["id"]==id && wire["value"]["fiscalPackage"]["version"]==v).unwrap_or(false) {return Err(failure("CORRUPT_RECORD"));} Ok(payload)
            }).transpose()
        })
    }
    pub fn list(&self,limit:u32,cursor:Option<Cursor>) -> Result<HistoryPage> {
        if !(1..=100).contains(&limit) || cursor.as_ref().map(|p| !validation::uuid(&p.execution_id)||!validation::instant(&p.completed_at)||!validation::uuid(&p.generation)).unwrap_or(false) {return Err(failure("INVALID_ARGUMENT"));}
        self.with(|c| {
            let tx = c.transaction().map_err(db_error)?; let epoch = generation(&tx)?;
            if cursor.as_ref().map(|p|p.generation != epoch).unwrap_or(false) {return Err(failure("STALE_GENERATION"));}
            let mut stmt = tx.prepare("SELECT execution_id,direction,requested_amount,periodicity,completed_at,reference_date,classification,gross,net,payload,payload_sha256,snapshot_version,package_sha256,length(CAST(payload AS BLOB)) FROM simulations WHERE (?1 IS NULL OR completed_at < ?1 OR (completed_at = ?1 AND execution_id < ?2)) ORDER BY completed_at DESC,execution_id DESC LIMIT ?3").map_err(db_error)?;
            let mut rows=stmt.query(params![cursor.as_ref().map(|p|p.completed_at.as_str()),cursor.as_ref().map(|p|p.execution_id.as_str()),limit+1]).map_err(db_error)?;
            let mut items=Vec::new();
            while let Some(row)=rows.next().map_err(db_error)? {
                if row.get::<_,i64>(13).map_err(db_error)?>validation::MAX_PAYLOAD as i64{return Err(failure("CORRUPT_RECORD"));}
                let item=HistoryItem{execution_id:row.get(0).map_err(db_error)?,direction:row.get(1).map_err(db_error)?,requested_amount:row.get(2).map_err(db_error)?,periodicity:row.get(3).map_err(db_error)?,completed_at:row.get(4).map_err(db_error)?,reference_date:row.get(5).map_err(db_error)?,classification:row.get(6).map_err(db_error)?,gross:row.get(7).map_err(db_error)?,net:row.get(8).map_err(db_error)?};
                let payload:String=row.get(9).map_err(db_error)?;let checksum:String=row.get(10).map_err(db_error)?;
                if digest(payload.as_bytes())!=checksum{return Err(failure("CORRUPT_RECORD"));}
                let index=validation::validate_snapshot_for_read(&payload).map_err(|e|if e.code=="INCOMPATIBLE_SCHEMA"{e}else{failure("CORRUPT_RECORD")})?;
                if row.get::<_,i64>(11).map_err(db_error)?!=index.snapshot_version||row.get::<_,String>(12).map_err(db_error)?!=index.package_sha{return Err(failure("CORRUPT_RECORD"));}
                if item.execution_id!=index.execution_id || item.direction!=index.direction || item.requested_amount!=index.requested_amount || item.periodicity!=index.periodicity || item.completed_at!=index.completed_at || item.reference_date!=index.reference_date || item.classification!=index.classification || item.gross!=index.gross || item.net!=index.net {return Err(failure("CORRUPT_RECORD"));}
                items.push(item);
            }
            let more = items.len() > limit as usize; items.truncate(limit as usize);
            let next_cursor = if more {items.last().map(|s|Cursor{completed_at:s.completed_at.clone(),execution_id:s.execution_id.clone(),generation:epoch.clone()})} else {None};
            drop(rows);drop(stmt); tx.commit().map_err(db_error)?; Ok(HistoryPage{items,next_cursor,generation:epoch})
        })
    }
    pub fn delete(&self,id:&str) -> Result<DeleteResult> {
        if !validation::uuid(id) {return Err(failure("INVALID_ARGUMENT"));}
        self.with(|c| {let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(db_error)?;
            tx.execute("INSERT OR IGNORE INTO deleted_executions VALUES(?1)",[id]).map_err(db_error)?;
            let deleted=tx.execute("DELETE FROM simulations WHERE execution_id=?1",[id]).map_err(db_error)? > 0;
            tx.commit().map_err(db_error)?; Ok(DeleteResult{deleted})})
    }
    pub fn clear(&self) -> Result<WriteSession> {
        let root=self.root.clone()?;
        self.with(|c| {purge_recovery_archives(&root)?;let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(db_error)?;let epoch=Uuid::new_v4().to_string();
            tx.execute("DELETE FROM simulations",[]).map_err(db_error)?;
            tx.execute("DELETE FROM deleted_executions",[]).map_err(db_error)?;
            tx.execute("UPDATE store_meta SET generation=?1 WHERE id=1",[&epoch]).map_err(db_error)?;
            tx.commit().map_err(db_error)?; Ok(WriteSession{generation:epoch})})
    }
    pub fn preferences(&self) -> Result<Preferences> { self.with(|c|read_preferences(c)) }
    pub fn set_preferences(&self,patch:PreferencePatch) -> Result<Preferences> {
        self.with(|c| {let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(db_error)?;
            let mut p=read_preferences(&tx)?; if let Some(theme)=patch.theme {p.theme=theme;} if let Some(auto)=patch.history_auto_save {p.history_auto_save=auto;}
            // Punto de corte: preferencia y generación se confirman juntas. No
            // borra registros, pero invalida toda escritura aceptada con token viejo.
            if patch.history_auto_save==Some(false) {tx.execute("UPDATE store_meta SET generation=?1 WHERE id=1",[Uuid::new_v4().to_string()]).map_err(db_error)?;}
            tx.execute("UPDATE preferences SET theme=?1,history_auto_save=?2 WHERE id=1",params![if p.theme==Theme::Light {"light"} else {"dark"},p.history_auto_save]).map_err(db_error)?;
            tx.commit().map_err(db_error)?; Ok(p)})
    }
    pub fn recover_corrupt(&self,ack:&str) -> Result<RecoveryResult> {
        if ack!="quarantine-corrupt-database" {return Err(failure("RECOVERY_NOT_ALLOWED"));}
        let _guard=self.gate.lock().map_err(|_|failure("UNAVAILABLE"))?; let path=self.path()?;
        let _maintenance=backup::maintenance_lock(path.parent().ok_or_else(||failure("UNAVAILABLE"))?)?;
        if path.parent().unwrap().join("migration-backups").exists(){return Err(failure("RECOVERY_PENDING"));}
        match open_database(&path) {Err(e) if e.code=="CORRUPT_DATABASE" => {}, _ => return Err(failure("RECOVERY_NOT_ALLOWED"))}
        let root=path.parent().ok_or_else(||failure("UNAVAILABLE"))?;let token=Uuid::new_v4().to_string();
        let staging=root.join(format!(".fresh-{token}.sqlite3")); let conn=open_database(&staging)?; let epoch=generation(&conn)?; drop(conn);
        let quarantine=root.join("recovery").join(token);fs::create_dir_all(&quarantine).map_err(|_|failure("IO_ERROR"))?;
        let mut moved:Vec<(PathBuf,PathBuf)>=Vec::new();
        for suffix in ["","-wal","-shm"] {
            let original=PathBuf::from(format!("{}{suffix}",path.to_string_lossy()));
            if original.exists() {let backup=quarantine.join(format!("payroll.sqlite3{suffix}"));
                if fs::rename(&original,&backup).is_err() {for (o,b) in moved.iter().rev() {let _=fs::rename(b,o);}let _=fs::remove_file(&staging);return Err(failure("IO_ERROR"));}
                moved.push((original,backup));}
        }
        if fs::rename(&staging,&path).is_err() {for(o,b)in moved.iter().rev(){let _=fs::rename(b,o);}return Err(failure("IO_ERROR"));}
        Ok(RecoveryResult{quarantine_path:quarantine.to_string_lossy().into(),generation:epoch})
    }
}
fn generation(c:&Connection)->Result<String>{c.query_row("SELECT generation FROM store_meta WHERE id=1",[],|r|r.get(0)).map_err(db_error)}
fn read_preferences(c:&Connection)->Result<Preferences>{
    let (version,theme,auto):(i64,String,i64)=c.query_row("SELECT version,theme,history_auto_save FROM preferences WHERE id=1",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(db_error)?;
    if version!=1 || ![0,1].contains(&auto) {return Err(failure("CORRUPT_RECORD"));}
    Ok(Preferences{theme:match theme.as_str(){"light"=>Theme::Light,"dark"=>Theme::Dark,_=>return Err(failure("CORRUPT_RECORD"))},history_auto_save:auto==1})
}
fn open_database(path:&Path)->Result<Connection>{
    fs::create_dir_all(path.parent().ok_or_else(||failure("UNAVAILABLE"))?).map_err(|_|failure("IO_ERROR"))?;
    let mut c=Connection::open(path).map_err(db_error)?;c.busy_timeout(Duration::from_secs(5)).map_err(db_error)?;
    c.set_limit(rusqlite::limits::Limit::SQLITE_LIMIT_LENGTH,(validation::MAX_PAYLOAD+65536) as i32).map_err(db_error)?;
    let health:String=c.query_row("PRAGMA quick_check",[],|r|r.get(0)).map_err(db_error)?;if health!="ok"{return Err(failure("CORRUPT_DATABASE"));}
    c.execute_batch("PRAGMA foreign_keys=OFF; PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL;").map_err(db_error)?;
    // La versión se lee bajo el mismo bloqueo de escritura que las migraciones:
    // dos instancias que estrenan una base no aplican el esquema dos veces.
    let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(db_error)?;
    let version:i64=tx.query_row("PRAGMA user_version",[],|r|r.get(0)).map_err(db_error)?;
    if version>SCHEMA_VERSION || version<0 {return Err(failure("INCOMPATIBLE_SCHEMA"));}
    if version==0 {let count:i64=tx.query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",[],|r|r.get(0)).map_err(db_error)?;if count!=0{return Err(failure("INCOMPATIBLE_SCHEMA"));}}
    else {let declared:i64=tx.query_row("SELECT version FROM schema_version WHERE id=1",[],|r|r.get(0)).map_err(|_|failure("INCOMPATIBLE_SCHEMA"))?;if declared!=version{return Err(failure("INCOMPATIBLE_SCHEMA"));}}
    if version>0 {check_schema(&tx,version)?;}
    if version<SCHEMA_VERSION {
        let objects:i64=tx.query_row("SELECT count(*) FROM sqlite_master WHERE type IN ('trigger','view') AND (tbl_name='simulations' OR type='view')",[],|r|r.get(0)).map_err(db_error)?;
        if objects!=0{return Err(failure("INCOMPATIBLE_SCHEMA"));}
        if version>0{backup::check_integrity(&tx)?;backup::check_records(&tx)?;backup::cleanup_backups(path.parent().ok_or_else(||failure("UNAVAILABLE"))?,&tx)?;backup::create_backup(path,&tx)?;}
        #[cfg(test)] backup::fault("after-backup")?;
        let preserved=if version>0{Some(backup::preserved_digest(&tx)?)}else{None};
        if version==0 {#[cfg(test)]v3_tests::STEPS.with(|s|s.borrow_mut().push(1));tx.execute_batch(MIGRATION_1).map_err(|_|failure("MIGRATION_FAILED"))?;tx.execute("INSERT INTO store_meta VALUES(1,?1)",[Uuid::new_v4().to_string()]).map_err(db_error)?;}
        if version<2 {#[cfg(test)]v3_tests::STEPS.with(|s|s.borrow_mut().push(2));tx.execute_batch(MIGRATION_2).map_err(|_|failure("MIGRATION_FAILED"))?;}
        for (target,migration) in [(3,MIGRATION_3),(4,MIGRATION_4)] { if version>=target {continue;}
        #[cfg(test)]v3_tests::STEPS.with(|s|s.borrow_mut().push(target));
        let (copy,finish)=migration.split_once("-- VERIFY_COPY_BEFORE_DROP").ok_or_else(||failure("MIGRATION_FAILED"))?;
        #[cfg(test)] if migration_tests::disk_full_requested(){let pages:i64=tx.query_row("PRAGMA page_count",[],|r|r.get(0)).map_err(db_error)?;tx.execute_batch(&format!("PRAGMA max_page_count={pages}")).map_err(db_error)?;}
        tx.execute_batch(copy).map_err(|_|failure("MIGRATION_FAILED"))?;
        #[cfg(test)] backup::fault("after-copy")?;
        #[cfg(test)] if target==4{backup::fault("after-copy-4")?;}
        if backup::table_digest(&tx,"simulations","simulations")?!=backup::table_digest(&tx,"simulations_new","simulations")?{return Err(failure("MIGRATION_FAILED"));}
        let (drop_sql,rest)=finish.split_once("-- AFTER_DROP").ok_or_else(||failure("MIGRATION_FAILED"))?;tx.execute_batch(drop_sql).map_err(|_|failure("MIGRATION_FAILED"))?;
        #[cfg(test)] backup::fault("after-drop")?;
        #[cfg(test)] if target==4{backup::fault("after-drop-4")?;}
        tx.execute_batch(rest).map_err(|_|failure("MIGRATION_FAILED"))?;backup::check_integrity(&tx)?;backup::check_records(&tx)?;
        }
        check_schema(&tx,SCHEMA_VERSION)?;
        let actual:i64=tx.query_row("PRAGMA user_version",[],|r|r.get(0)).map_err(db_error)?;let declared:i64=tx.query_row("SELECT version FROM schema_version WHERE id=1",[],|r|r.get(0)).map_err(db_error)?;if actual!=SCHEMA_VERSION||declared!=SCHEMA_VERSION{return Err(failure("MIGRATION_FAILED"));}
        if let Some(expected)=&preserved{if backup::preserved_digest(&tx)?!=*expected{return Err(failure("MIGRATION_FAILED"));}}
        #[cfg(test)] backup::fault("before-commit")?;
        let committed=tx.commit();
        #[cfg(test)] if committed.is_ok(){backup::fault("after-commit").map_err(|_|failure("MIGRATION_COMMITTED_VERIFICATION_PENDING"))?;}
        drop(c);
        c=Connection::open_with_flags(path,rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE).map_err(|_|failure("MIGRATION_OUTCOME_UNKNOWN"))?;c.busy_timeout(Duration::from_secs(5)).map_err(db_error)?;
        c.set_limit(rusqlite::limits::Limit::SQLITE_LIMIT_LENGTH,(validation::MAX_PAYLOAD+65536) as i32).map_err(db_error)?;
        let reopened:i64=c.query_row("PRAGMA user_version",[],|r|r.get(0)).map_err(|_|failure("MIGRATION_OUTCOME_UNKNOWN"))?;if reopened!=SCHEMA_VERSION{return Err(if committed.is_err()&&reopened==version{failure("MIGRATION_FAILED")}else{failure("MIGRATION_OUTCOME_UNKNOWN")});}
        c.execute_batch("PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL;").map_err(db_error)?;
        check_schema(&c,SCHEMA_VERSION).map_err(|_|failure("MIGRATION_COMMITTED_VERIFICATION_PENDING"))?;
        if c.query_row("SELECT version FROM schema_version WHERE id=1",[],|r|r.get::<_,i64>(0)).map_err(db_error)?!=SCHEMA_VERSION{return Err(failure("MIGRATION_COMMITTED_VERIFICATION_PENDING"));}
        backup::check_integrity(&c)?;backup::check_records(&c)?;
        if let Some(expected)=&preserved{if backup::preserved_digest(&c)?!=*expected{return Err(failure("MIGRATION_COMMITTED_VERIFICATION_PENDING"));}}
        backup::cleanup_backups(path.parent().ok_or_else(||failure("UNAVAILABLE"))?,&c)?;
    }else{
        tx.commit().map_err(db_error)?;
        c.execute_batch("PRAGMA foreign_keys=ON;").map_err(db_error)?;
        if path.parent().unwrap().join("migration-backups").exists(){backup::check_integrity(&c)?;backup::check_records(&c)?;backup::cleanup_backups(path.parent().unwrap(),&c)?;}
    }
    c.pragma_update(None,"journal_mode","WAL").map_err(db_error)?;
    Ok(c)
}

fn check_schema(c:&Connection,version:i64)->Result<()> {
    for (table,columns) in [("schema_version",vec!["id","version"]),("store_meta",vec!["id","generation"]),("fiscal_packages",vec!["sha256","package_id","version","metadata_json"]),("preferences",vec!["id","version","theme","history_auto_save"])] {
        let mut info=c.prepare(&format!("PRAGMA table_info({table})")).map_err(db_error)?;let actual=info.query_map([],|r|r.get::<_,String>(1)).map_err(db_error)?.collect::<std::result::Result<Vec<_>,_>>().map_err(db_error)?;
        if actual!=columns{return Err(failure("INCOMPATIBLE_SCHEMA"));}
    }
    if !validation::uuid(&generation(c)?){return Err(failure("CORRUPT_DATABASE"));}read_preferences(c)?;
    if version>=2 {let mut info=c.prepare("PRAGMA table_info(deleted_executions)").map_err(db_error)?;let columns=info.query_map([],|r|r.get::<_,String>(1)).map_err(db_error)?.collect::<std::result::Result<Vec<_>,_>>().map_err(db_error)?;if columns!=["execution_id"]{return Err(failure("INCOMPATIBLE_SCHEMA"));}}
    let mut stmt=c.prepare("PRAGMA table_info(simulations)").map_err(db_error)?;let names=stmt.query_map([],|r|r.get::<_,String>(1)).map_err(db_error)?.collect::<std::result::Result<Vec<_>,_>>().map_err(db_error)?;
    if names!=["execution_id","completed_at","direction","requested_amount","periodicity","reference_date","classification","gross","net","package_sha256","snapshot_version","payload","payload_sha256"]{return Err(failure("INCOMPATIBLE_SCHEMA"));}
    let sql:String=c.query_row("SELECT sql FROM sqlite_master WHERE name='simulations' AND type='table'",[],|r|r.get(0)).map_err(db_error)?;
    let compact=sql.chars().filter(|c|!c.is_whitespace()).collect::<String>().to_lowercase();
    if !compact.contains(if version<3{"check(snapshot_version=1)"}else if version==3{"check(snapshot_versionin(1,2))"}else{"check(snapshot_versionin(1,2,3))"}){return Err(failure("INCOMPATIBLE_SCHEMA"));}
    if version>=2{let mut s=c.prepare("SELECT name,desc FROM pragma_index_xinfo('simulations_date_id') WHERE key=1 ORDER BY seqno").map_err(db_error)?;let actual=s.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?))).map_err(db_error)?.collect::<std::result::Result<Vec<_>,_>>().map_err(db_error)?;if actual!=vec![("completed_at".into(),1),("execution_id".into(),1)]{return Err(failure("INCOMPATIBLE_SCHEMA"));}}
    let mut fk=c.prepare("PRAGMA foreign_key_list(simulations)").map_err(db_error)?;let refs=fk.query_map([],|r|Ok((r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?))).map_err(db_error)?.collect::<std::result::Result<Vec<_>,_>>().map_err(db_error)?;
    if refs!=[("fiscal_packages".into(),"package_sha256".into(),"sha256".into())]{return Err(failure("INCOMPATIBLE_SCHEMA"));}
    Ok(())
}

fn purge_recovery_archives(root:&Path)->Result<()> {
    let recovery=root.join("recovery");if !recovery.exists(){return Ok(());}
    if fs::symlink_metadata(&recovery).map_err(|_|failure("BACKUP_CLEANUP_PENDING"))?.file_type().is_symlink(){return Err(failure("BACKUP_CLEANUP_PENDING"));}
    for entry in fs::read_dir(&recovery).map_err(|_|failure("BACKUP_CLEANUP_PENDING"))? {
        let entry=entry.map_err(|_|failure("BACKUP_CLEANUP_PENDING"))?;let path=entry.path();
        if !entry.file_type().map_err(|_|failure("BACKUP_CLEANUP_PENDING"))?.is_dir()||!validation::uuid(&entry.file_name().to_string_lossy()){return Err(failure("BACKUP_CLEANUP_PENDING"));}
        for file in fs::read_dir(&path).map_err(|_|failure("BACKUP_CLEANUP_PENDING"))?{let file=file.map_err(|_|failure("BACKUP_CLEANUP_PENDING"))?;
            if !file.file_type().map_err(|_|failure("BACKUP_CLEANUP_PENDING"))?.is_file()||!["payroll.sqlite3","payroll.sqlite3-wal","payroll.sqlite3-shm"].contains(&file.file_name().to_string_lossy().as_ref()){return Err(failure("BACKUP_CLEANUP_PENDING"));}}
        fs::remove_dir_all(path).map_err(|_|failure("BACKUP_CLEANUP_PENDING"))?;
    }fs::remove_dir(recovery).map_err(|_|failure("BACKUP_CLEANUP_PENDING"))?;Ok(())
}
