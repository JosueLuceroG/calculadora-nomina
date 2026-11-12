use super::*;
use self::core::canonical;
pub(super) fn check_pending(repo:&Repository,c:&Connection,m:&Marker)->Result<()>{
    let dir=repo.root.join("fiscal/backups");if !paths::present(&dir)?{return Ok(());}paths::directory(&dir)?;let entries=fs::read_dir(&dir)?.collect::<std::io::Result<Vec<_>>>()?;if entries.len()>1{return Err(fail("RECOVERY_PENDING"));}
    for e in entries{let p=e.path();paths::directory(&p)?;if uuid::Uuid::parse_str(&e.file_name().to_string_lossy()).is_err(){return Err(fail("RECOVERY_PENDING"));}for child in fs::read_dir(&p)?{let child=child?;if !["creating.json","ready.json","repository.sqlite3"].contains(&child.file_name().to_string_lossy().as_ref()){return Err(fail("RECOVERY_PENDING"));}paths::regular(&child.path())?;}
        if !paths::present(&p.join("ready.json"))?{return Err(fail("RECOVERY_PENDING"));}let b=paths::bounded(&p.join("ready.json"),limits::MANIFEST)?;let v=core::strict_json::parse_with_limit(&b,limits::MANIFEST as usize)?;canonical::require_wire(&b,&v)?;
        if paths::marker(&p.join("creating.json"))?!=*m{return Err(fail("RECOVERY_PENDING"));}let copy=schema::open(&p.join("repository.sqlite3"),true)?;replay::rebuild(&copy,&repo.policy,m)?;
        let(repository_id,generation,head,file_sha256)=match v["version"].as_u64(){
            Some(1)=>{let r:BackupManifest=core::decode_closed(&v)?;if r.purpose!="mx.nomina.fiscal-backup.v1"||schema::version(&copy)?!=1{return Err(fail("RECOVERY_PENDING"));}(r.repository_id,r.generation,r.head,r.file_sha256)},
            Some(2)=>{let r:BackupManifestV2=core::decode_closed(&v)?;if r.purpose!="mx.nomina.fiscal-backup.v2"||r.schema_version!=2||schema::version(&copy)?!=2||r.logical_sha256!=schema::digest(&copy)?{return Err(fail("RECOVERY_PENDING"));}(r.repository_id,r.generation,r.head,r.file_sha256)},
            _=>return Err(fail("RECOVERY_PENDING")),
        };
        let(_,actual_generation,actual_head,_)=meta(&copy)?;let expected=if generation==0{"0".repeat(64)}else{c.query_row("SELECT entry_hash FROM operations WHERE seq=?1",[generation],|r|r.get::<_,String>(0))?};
        if repository_id!=m.repository_id||actual_generation!=generation||actual_head!=head||head!=expected||file_hash(&p.join("repository.sqlite3"))?!=file_sha256{return Err(fail("RECOVERY_PENDING"));}
    }Ok(())
}
pub(super) fn backup(repo:&Repository,c:&Connection,m:&Marker)->Result<PathBuf>{copy_at(repo,c,m,&repo.root.join("fiscal/backups"))}
pub(super) fn copy_at(repo:&Repository,c:&Connection,m:&Marker,base:&Path)->Result<PathBuf>{if paths::present(base)?&&fs::read_dir(base)?.next().is_some(){return Err(fail("BACKUP_ALREADY_EXISTS"));}if !paths::present(base)?{fs::create_dir(base)?;paths::private_directory(base)?;}paths::directory(base)?;let dir=base.join(uuid::Uuid::new_v4().to_string());fs::create_dir(&dir)?;
    paths::publish(&dir.join("creating.json"),&canonical::bytes(m)?)?;point("backup-created")?;let target=dir.join("repository.sqlite3");let aux=schema::open(&repo.db(),true)?;aux.set_limit(rusqlite::limits::Limit::SQLITE_LIMIT_ATTACHED,1)?;aux.execute("VACUUM main INTO ?1",[target.to_str().ok_or_else(||fail("UNSAFE_PATH"))?])?;drop(aux);point("backup-copied")?;
    let copy=schema::open(&target,true)?;replay::rebuild(&copy,&repo.policy,m)?;if schema::digest(&copy)?!=schema::digest(c)?{return Err(fail("BACKUP_MISMATCH"));}drop(copy);fs::OpenOptions::new().read(true).write(true).open(&target)?.sync_all()?;
    let(id,generation,head,_)=meta(c)?;let manifest=if schema::version(c)?==1{canonical::bytes(&BackupManifest{version:1,purpose:"mx.nomina.fiscal-backup.v1".into(),repository_id:id,generation,head,file_sha256:file_hash(&target)?})?}else{canonical::bytes(&BackupManifestV2{version:2,purpose:"mx.nomina.fiscal-backup.v2".into(),repository_id:id,generation,head,file_sha256:file_hash(&target)?,schema_version:2,logical_sha256:schema::digest(c)?})?};paths::publish(&dir.join("ready.json"),&manifest)?;point("backup-ready")?;Ok(dir)
}
pub(super) fn file_hash(path:&Path)->Result<String>{use std::io::Read;use sha2::{Sha256,Digest};paths::regular(path)?;let mut f=fs::File::open(path)?;let mut h=Sha256::new();let mut b=[0;65536];loop{let n=f.read(&mut b)?;if n==0{break;}h.update(&b[..n]);}Ok(format!("{:x}",h.finalize()))}
// No restore-over-current API. A verified old copy remains evidence, never a replacement.
