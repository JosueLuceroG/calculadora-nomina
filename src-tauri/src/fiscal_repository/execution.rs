//! Read-only native acquisition. No salary input, result or execution ID enters
//! the fiscal ledger. A frozen proof cannot be supplied through IPC.
use super::*;
use self::core::{wire::*,hashes,canonical};
use serde::Serialize;
use std::collections::BTreeMap;
/// Compiled native decision, never deserialized from a client request.
#[derive(Debug,Clone,Copy,PartialEq,Eq)]
pub(crate) enum DocumentContract{LegacyV3,CompatReadOnlyV1}
impl DocumentContract{
    pub(crate) fn current()->Self{Self::CompatReadOnlyV1}
    pub(crate) fn version(self)->u64{match self{Self::LegacyV3=>1,Self::CompatReadOnlyV1=>2}}
    pub(crate) fn writable(self)->bool{self==Self::LegacyV3}
    pub(crate) fn binding(self)->serde_json::Value{
        let(producer,report,presentation)=match self{
            Self::LegacyV3=>("nomina-signed-fiscal-document-v3-v1","standard-payroll-2026-contextual-v2","nomina-presentation-5c2-v1"),
            Self::CompatReadOnlyV1=>("nomina-signed-fiscal-document-v3-v2","standard-payroll-2026-contextual-document-compat-v1","nomina-presentation-document-compat-v1"),
        };
        serde_json::json!({"schemaVersion":3,"executionProvenanceSchemaVersion":1,"producerId":producer,"reportContractId":report,"presentationContractId":presentation})
    }
    fn material(self,package:&serde_json::Value,head:&serde_json::Value)->Result<()>{
        if self==Self::CompatReadOnlyV1{return crate::storage::StorageService::validate_compat_material(package,head).map_err(|_|fail("MATERIAL_NOT_DOCUMENTABLE"));}
        let frozen:serde_json::Value=serde_json::from_str(include_str!("../../../src/features/documents/frozen-shape-v3.json")).map_err(|_|fail("UNAVAILABLE"))?;shape(package,&frozen["package"])?;shape(head,&frozen["head"])
    }
    fn head(self,head:&serde_json::Value)->Result<()>{
        if self==Self::CompatReadOnlyV1{return crate::storage::StorageService::validate_compat_head(head).map_err(|_|fail("MATERIAL_NOT_DOCUMENTABLE"));}
        let frozen:serde_json::Value=serde_json::from_str(include_str!("../../../src/features/documents/frozen-shape-v3.json")).map_err(|_|fail("UNAVAILABLE"))?;shape(head,&frozen["head"])
    }
}
impl Serialize for DocumentContract{fn serialize<S:serde::Serializer>(&self,s:S)->std::result::Result<S::Ok,S::Error>{self.binding().serialize(s)}}
#[derive(Debug,Clone,Serialize)]#[serde(rename_all="camelCase")]
pub(crate) struct EffectiveSet{pub role:String,pub family:String,pub id:String,pub version:String}
#[derive(Debug,Clone,Serialize)]#[serde(rename_all="camelCase")]
pub(crate) struct ExecutionContext{
    pub document_contract:DocumentContract,
    pub version:u64,pub repository_id:String,pub repository_generation:u64,pub selection:SelectionIdentity,
    pub envelope_sha256:String,pub payload_sha256:String,pub content_sha256:String,pub conventions_sha256:String,
    pub package_id:String,pub parameter_version:String,pub exercise:u64,pub stream:String,pub epoch:u64,pub revision:u64,
    pub fiscal_date:String,pub periodicity:String,pub operation:String,pub authorized_operations:Vec<Capability>,
    pub simulation_profile:String,pub rule_profile:String,pub contextual_policy:String,pub motor_identity:String,
    pub verified_at:String,pub root_version:u64,pub trust_epoch:u64,pub trust_head_sha256:String,pub effective_sets:Vec<EffectiveSet>,
}
pub(crate) struct ExecutionMaterial{pub context:ExecutionContext,pub package_envelope:serde_json::Value,pub trust_head_envelope:serde_json::Value,pub history:serde_json::Value}
pub(crate) struct ExecutionGuard<'a>{repo:&'a Repository,connection:&'a Connection,view:&'a replay::View,context:&'a ExecutionContext}
impl ExecutionGuard<'_>{pub fn authorize_now(&self)->Result<String>{self.repo.verify_execution_locked(self.connection,self.view,self.context)}}
fn operation(s:&str)->Result<Capability>{match s{"gross-to-net"=>Ok(Capability::Direct),"net-to-gross"=>Ok(Capability::Inverse),_=>Err(fail("INVALID_OPERATION"))}}
pub(super) fn shape(value:&serde_json::Value,s:&serde_json::Value)->Result<()>{
    use serde_json::Value;let kind=match value{Value::Null=>"null",Value::Bool(_)=>"boolean",Value::Number(_)=>"number",Value::String(_)=>"string",Value::Array(_)=>"array",Value::Object(_)=>"object"};
    if !s["types"].as_array().map(|a|a.contains(&Value::String(kind.into()))).unwrap_or(false){return Err(fail("MATERIAL_NOT_DOCUMENTABLE"));}
    if let Some(o)=value.as_object(){let p=s["properties"].as_object().ok_or_else(||fail("MATERIAL_NOT_DOCUMENTABLE"))?;if o.keys().any(|k|!p.contains_key(k))||s["required"].as_array().ok_or_else(||fail("MATERIAL_NOT_DOCUMENTABLE"))?.iter().any(|k|!o.contains_key(k.as_str().unwrap_or(""))){return Err(fail("MATERIAL_NOT_DOCUMENTABLE"));}for(k,v)in o{shape(v,&p[k])?;}}
    if let Some(a)=value.as_array(){if s["items"].is_null()&&!a.is_empty(){return Err(fail("MATERIAL_NOT_DOCUMENTABLE"));}for v in a{shape(v,&s["items"])?;}}Ok(())
}
fn head(c:&Connection,view:&replay::View)->Result<(String,serde_json::Value)>{let h:String=c.query_row("SELECT document FROM trust_episode_documents WHERE episode=?1 ORDER BY position DESC LIMIT 1",[view.episode],|r|r.get(0))?;let bytes=bytes(c,"trust_documents",&h,limits::TRUST_BYTES)?;let raw=core::strict_json::parse_with_limit(&bytes,limits::TRUST_BYTES as usize)?;canonical::require_wire(&bytes,&raw)?;if hashes::canonical_hash(&raw["signed"])?!=hashes::canonical_hash(view.signed.as_ref().ok_or_else(||fail("TRUST_METADATA_REQUIRED"))?)?{return Err(fail("TRUST_HEAD_MISMATCH"));}Ok((h,raw))}
fn sets(p:&serde_json::Value,date:&str,period:&str)->Result<Vec<EffectiveSet>>{let mut refs=vec![];for(role,family)in [("isrTariff","isrTariffs"),("uma","uma"),("minimumWages","minimumWages"),("subsidy","subsidy"),("imssConstants","imssConstants"),("contractualDivisors","contractualDivisors"),("laborBenefitMinima","laborBenefitMinima")]{let matches=p["registry"][family].as_array().ok_or_else(||fail("INCOMPLETE_PARAMETERS"))?.iter().filter(|v|v["effectiveFrom"].as_str().map(|s|s<=date).unwrap_or(false)&&(v["effectiveThrough"].is_null()||v["effectiveThrough"].as_str().map(|s|s>=date).unwrap_or(false))&&(role!="isrTariff"||v["data"]["periodicity"]==period)).collect::<Vec<_>>();if matches.len()!=1{return Err(fail("INCOMPLETE_PARAMETERS"));}let s=matches[0];refs.push(EffectiveSet{role:role.into(),family:family.into(),id:s["id"].as_str().ok_or_else(||fail("INCOMPLETE_PARAMETERS"))?.into(),version:s["version"].as_str().ok_or_else(||fail("INCOMPLETE_PARAMETERS"))?.into()});}Ok(refs)}
impl Repository{
    #[cfg(test)]pub(crate) fn execution_test_clock(mut self,clock:Clock)->Self{self.clock=clock;self}
    pub fn prepare_execution(&self,expected:&SelectionIdentity,date:&str,period:&str,op:&str)->Result<ExecutionMaterial>{
        self.prepare_execution_for_contract(expected,date,period,op,DocumentContract::LegacyV3)
    }
    pub(crate) fn prepare_execution_for_contract(&self,expected:&SelectionIdentity,date:&str,period:&str,op:&str,document_contract:DocumentContract)->Result<ExecutionMaterial>{
        self.policy.require_management()?;if !core::time::civil(date)||!date.starts_with("2026-"){return Err(fail("EXERCISE_NOT_AUTHORIZED"));}if !["weekly","fortnightly","monthly"].contains(&period){return Err(fail("PERIODICITY_UNSUPPORTED"));}let cap=operation(op)?;
        let _gate=self.gate.lock().map_err(|_|fail("LOCK_POISONED"))?;let _lock=paths::lock(&self.root)?;let(c,m)=self.existing()?;let view=replay::rebuild(&c,&self.policy,&m)?;recovery::check_pending(self,&c,&m)?;let now=self.clock.now()?;let(id,generation,_,maximum)=meta(&c)?;clock::check(&now,&maximum)?;
        let selected=activation::selection(&c)?;if selected!=*expected{return Err(fail("STALE_SELECTION"));}let(i,a)=match(&selected.installation_id,&selected.admission_id){(Some(i),Some(a))if selected.kind=="external"=>(i,a),_=>return Err(fail("EXTERNAL_SELECTION_REQUIRED"))};
        let source=replay::Source{connection:&c,pending:BTreeMap::new()};let admitted=activation::verify_execution_operation(&c,&source,&view,i,a,cap,&now)?;let(h,b,p)=activation::installed(&c,&source,i)?;if date<p.manifest.supported_dates.from.as_str()||date>p.manifest.supported_dates.through.as_str(){return Err(fail("DATE_OUTSIDE_PACKAGE_COVERAGE"));}
        let raw=core::strict_json::parse(&b)?;let(th,trust)=head(&c,&view)?;document_contract.material(&raw,&trust)?;
        let n=count(&c,"trust_episode_documents")?;if n>65536||(b.len() as u64+canonical::bytes(&trust)?.len() as u64+n*67)>3_145_728{return Err(fail("INITIAL_DOCUMENT_TOO_LARGE"));}let mut stmt=c.prepare("SELECT document FROM trust_episode_documents ORDER BY episode,position")?;let hashes=stmt.query_map([],|r|r.get::<_,String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;let episodes=count(&c,"trust_episodes")?;let manifest=serde_json::json!({"documentHashes":hashes,"episodeCount":episodes,"archiveLocator":""});let history=serde_json::json!({"scope":"referenced-not-replayable","documentHashes":manifest["documentHashes"],"episodeCount":episodes,"archiveLocator":"","manifestSha256":hashes::canonical_hash(&manifest)?});
        let context=ExecutionContext{document_contract,version:document_contract.version(),repository_id:id,repository_generation:generation,selection:selected,envelope_sha256:h,payload_sha256:admitted.payload_sha256,content_sha256:admitted.content.sha256,conventions_sha256:admitted.conventions_sha256,package_id:p.manifest.package_id,parameter_version:p.manifest.parameter_version,exercise:2026,stream:p.publication.stream_id,epoch:p.publication.stream_epoch,revision:p.publication.revision,fiscal_date:date.into(),periodicity:period.into(),operation:op.into(),authorized_operations:if cap==Capability::Inverse{vec![Capability::Direct,Capability::Inverse]}else{vec![Capability::Direct]},simulation_profile:p.conventions.id,rule_profile:p.manifest.required_rule_profile_id,contextual_policy:p.manifest.required_contextual_policy_id,motor_identity:admitted.motor_identity,verified_at:now,root_version:view.trust.root_version(),trust_epoch:view.trust.epoch(),trust_head_sha256:th,effective_sets:sets(&raw["signed"],date,period)?};
        Ok(ExecutionMaterial{context,package_envelope:raw,trust_head_envelope:trust,history})
    }
    pub fn revalidate_execution(&self,frozen:&ExecutionContext)->Result<String>{
        self.with_execution_guard(frozen,|guard|guard.authorize_now())
    }
    pub(crate) fn with_execution_guard<T,E,F>(&self,context:&ExecutionContext,action:F)->std::result::Result<T,E> where E:From<errors::Error>,F:FnOnce(&ExecutionGuard<'_>)->std::result::Result<T,E>{
        self.policy.require_management().map_err(E::from)?;let _gate=self.gate.lock().map_err(|_|E::from(fail("LOCK_POISONED")))?;let _lock=paths::lock(&self.root)?;let(c,m)=self.existing()?;let view=replay::rebuild(&c,&self.policy,&m)?;recovery::check_pending(self,&c,&m)?;let guard=ExecutionGuard{repo:self,connection:&c,view:&view,context};guard.authorize_now()?;action(&guard)
    }
    fn verify_execution_locked(&self,c:&Connection,view:&replay::View,frozen:&ExecutionContext)->Result<String>{
        let(id,generation,_,maximum)=meta(c)?;let now=self.clock.now()?;clock::check(&now,&maximum)?;
        if id!=frozen.repository_id||generation<frozen.repository_generation{return Err(fail("EXECUTION_CONTEXT_MISMATCH"));}let sid=frozen.selection.id.as_ref().ok_or_else(||fail("EXECUTION_CONTEXT_MISMATCH"))?;
        let row:Option<(u64,String,String,String,u64)>=c.query_row("SELECT s.generation,s.kind,s.installation,s.admission,o.seq FROM fiscal_selections s JOIN operations o ON o.id=s.operation WHERE s.id=?1",[sid],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional()?;
        let Some((g,k,i,a,seq))=row else{return Err(fail("EXECUTION_CONTEXT_MISMATCH"));};if g!=frozen.selection.generation||k!="external"||Some(&i)!=frozen.selection.installation_id.as_ref()||Some(&a)!=frozen.selection.admission_id.as_ref()||seq>frozen.repository_generation{return Err(fail("EXECUTION_CONTEXT_MISMATCH"));}
        let source=replay::Source{connection:&c,pending:BTreeMap::new()};let admitted=activation::verify_execution_operation(&c,&source,&view,&i,&a,operation(&frozen.operation)?,&now)?;if admitted.container_sha256!=frozen.envelope_sha256||admitted.payload_sha256!=frozen.payload_sha256||admitted.content.sha256!=frozen.content_sha256{return Err(fail("EXECUTION_CONTEXT_MISMATCH"));}
        let(_,current_head)=head(&c,&view)?;frozen.document_contract.head(&current_head)?;Ok(now)
    }
}
