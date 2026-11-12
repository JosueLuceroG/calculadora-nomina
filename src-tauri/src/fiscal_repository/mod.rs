//! Durable fiscal evidence, effective admissions and selection. No execution issuer.
#![allow(dead_code)] // Deliberately not exposed to the application until a later approved milestone.
mod errors;
mod limits;
mod contracts;
mod clock;
mod paths;
mod schema;
mod replay;
mod repository;
mod recovery;
mod preview;
mod migration;
mod activation;
mod execution;
mod production_bootstrap;
use errors::*;
use contracts::*;
use nomina_fiscal_package as core;
use rusqlite::{Connection,params,OptionalExtension};
use std::{fs,path::{Path,PathBuf},sync::Mutex};
pub(crate) use repository::Repository;
pub(crate) use clock::Clock;
pub(crate) use contracts::{Receipt,Status};
pub(crate) use errors::Error as RepositoryError;
pub(crate) use preview::{PreparedPreview,PreviewSummary,Detail,InstallationMetadata};
pub(crate) use activation::{ActivationIntent,ActivationPreview,Eligibility,SelectionIdentity,SelectionStatus,EXECUTION_CLOSED};
pub(crate) use execution::{ExecutionContext,DocumentContract};
#[derive(Clone)]pub(crate) struct Policy{channel:String,roots:Vec<core::wire::RootKey>}
impl Policy{
    pub fn production()->Self{Self{channel:"production".into(),roots:production_bootstrap::compiled_roots()}}
    fn require_management(&self)->Result<()>{
        if self.channel=="production"&&!cfg!(any(test,feature="fiscal-production")){return Err(fail("PRODUCTION_BOOTSTRAP_MISSING"));}
        if self.initial()?.root_version()==0{return Err(fail("PRODUCTION_BOOTSTRAP_MISSING"));}Ok(())
    }
    #[cfg(any(test,feature="fiscal-import-qa"))]
    pub(crate) fn import_qa()->Self{let b:serde_json::Value=serde_json::from_str(include_str!("../../../docs/evidence/5d3b2/fixtures/bootstrap.json")).expect("compiled public QA inventory");Self{channel:"qa".into(),roots:serde_json::from_value(b["rootKeys"].clone()).expect("public roots")}}
    fn initial(&self)->Result<core::trust::TrustedState>{match self.channel.as_str(){
        "production" if self.roots.is_empty()=>Ok(core::trust::TrustedState::unconfigured_production()),
        "production"=>Ok(core::trust::TrustedState::production_bootstrap(core::wire::Channel::Production,&self.roots)?),
        "qa"=>Ok(core::trust::TrustedState::qa_bootstrap(&self.roots)?),
        _=>Err(fail("INVALID_POLICY_CHANNEL")),
    }}
    fn hash(&self)->Result<String>{if self.channel!="qa"{self.initial()?;}Ok(core::hashes::sha256(&core::canonical::bytes(&serde_json::json!({"version":1,"channel":self.channel,"roots":self.roots}))?))}
    #[cfg(test)]fn qa()->Self{let b:serde_json::Value=serde_json::from_str(include_str!("../../../docs/evidence/5d3b1/fixtures/bootstrap.json")).unwrap();Self{channel:"qa".into(),roots:serde_json::from_value(b["rootKeys"].clone()).unwrap()}}
}
impl Repository{
    pub(crate) fn management_enabled(&self,qa_host:bool)->Result<()>{
        if self.policy.channel!=if qa_host{"qa"}else{"production"}{return Err(fail("HOST_POLICY_MISMATCH"));}
        self.policy.require_management()
    }
}
fn bytes(c:&Connection,table:&str,key:&str,max:u64)->Result<Vec<u8>>{if !["containers","signed_payloads","content_objects","trust_documents","rollback_documents"].contains(&table){return Err(fail("INVALID_ARGUMENT"));}let n:i64=c.query_row(&format!("SELECT length(bytes) FROM {table} WHERE sha256=?1"),[key],|r|r.get(0))?;if n<1||n as u64>max{return Err(fail("CORRUPT_RECORD"));}Ok(c.query_row(&format!("SELECT bytes FROM {table} WHERE sha256=?1"),[key],|r|r.get(0))?)}
fn blob(c:&Connection,table:&str,hash:&str,b:&[u8])->Result<bool>{if let Some(old)=c.query_row(&format!("SELECT bytes FROM {table} WHERE sha256=?1"),[hash],|r|r.get::<_,Vec<u8>>(0)).optional()?{if old!=b{return Err(fail("IDENTITY_CONFLICT"));}return Ok(false);}Ok(true)}
fn object_total(c:&Connection)->Result<u64>{let mut n=0;for t in ["content_objects","signed_payloads","containers","trust_documents","rollback_documents"]{let size:i64=c.query_row(&format!("SELECT coalesce(sum(length(bytes)),0) FROM {t}"),[],|r|r.get(0))?;n+=u64::try_from(size).map_err(|_|fail("CORRUPT_RECORD"))?;}Ok(n)}
fn count(c:&Connection,t:&str)->Result<u64>{Ok(c.query_row(&format!("SELECT count(*) FROM {t}"),[],|r|r.get(0))?)}
fn meta(c:&Connection)->Result<(String,u64,String,String)>{Ok(c.query_row("SELECT repository_id,generation,head,max_utc FROM repository_meta WHERE id=1",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)))?)}
fn seed(c:&Connection,m:&Marker)->Result<()>{seed_at(c,m,2)}
fn seed_at(c:&Connection,m:&Marker,version:i64)->Result<()>{schema::create_at(c,version)?;c.execute("INSERT INTO repository_meta VALUES(1,?1,?2,?3,0,?4,'')",params![m.repository_id,m.channel,m.bootstrap_sha256,"0".repeat(64)])?;Ok(())}
fn point(_name:&str)->Result<()>{
    #[cfg(test)]{
        if std::env::var("NOMINA_FISCAL_STOP").ok().as_deref()==Some(_name){use std::io::Write;println!("FISCAL_READY:{_name}");std::io::stdout().flush().unwrap();loop{std::thread::park();}}
        if tests::FAULT.with(|f|f.borrow().as_deref()==Some(_name)){return Err(fail("QA_FAULT"));}
    }Ok(())
}
#[cfg(test)]mod tests;
#[cfg(test)]mod activation_tests;
#[cfg(test)]mod execution_tests;
#[cfg(test)]mod cas_assessment_tests;
#[cfg(test)]pub(crate) mod production_tests;
