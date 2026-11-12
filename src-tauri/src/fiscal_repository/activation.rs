use super::*;
use self::core::{canonical,hashes,wire::*,revisions::MemoryRevisions,compatibility::CompiledPolicy,errors::Stage};
use serde::{Serialize,Deserialize};
use std::collections::BTreeMap;
const PROFILE:&str="mx-standard-2026-contextual-v2";
pub(crate) const EXECUTION_CLOSED:&str="selection-only; external execution and snapshot3 writes remain closed";

#[derive(Debug,Clone,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct AdmissionBinding{
    pub version:u64,pub installation_id:String,pub container_sha256:String,pub payload_sha256:String,pub content:ContentIdentity,
    pub exercise:u64,pub rule_profile:String,pub contextual_policy:String,pub parameter_schema:String,pub conventions_sha256:String,
    pub motor_identity:String,pub periodicities:Vec<String>,pub operations:Vec<Capability>,pub verified_at:String,
    pub root_version:u64,pub trust_epoch:u64,pub trust_episode:u64,pub reports:Vec<serde_json::Value>,pub state:String,
}
#[derive(Debug,Clone,Serialize)]#[serde(rename_all="camelCase")]
pub(crate) struct AdmissionRef{pub admission_id:String,pub operation_id:String,pub version:u64}
#[derive(Debug,Clone,Serialize)]#[serde(rename_all="camelCase")]
pub(crate) struct Eligibility{pub installation_id:String,pub eligible:bool,pub reason:Option<&'static str>,pub operations:Vec<Capability>,pub container_sha256:Option<String>,pub payload_sha256:Option<String>,pub content_sha256:Option<String>,pub revision:u64,pub epoch:u64,pub stream:Option<String>,pub verified_at:String,pub root_version:u64,pub trust_epoch:u64,pub continuity:bool,pub admission_refs:Vec<AdmissionRef>,pub more_admissions:bool,pub execution:String}
#[derive(Debug,Clone,Serialize,Deserialize,PartialEq,Eq)]#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct SelectionIdentity{pub id:Option<String>,pub generation:u64,pub kind:String,pub installation_id:Option<String>,pub admission_id:Option<String>}
impl SelectionIdentity{pub fn integrated()->Self{Self{id:None,generation:0,kind:"embedded".into(),installation_id:None,admission_id:None}}}
#[derive(Debug,Clone,Serialize)]#[serde(rename_all="camelCase")]
pub(crate) struct SelectionStatus{pub repository_generation:u64,pub selection:SelectionIdentity,pub eligibility:Option<Eligibility>,pub execution:String}
#[derive(Debug,Clone,Copy,Serialize,Deserialize,PartialEq,Eq)]#[serde(rename_all="lowercase")]
pub(crate) enum ActivationIntent{Admit,Select,Deactivate}
#[derive(Clone)]pub(crate) struct ActivationPreview{pub action:Action,pub repository_id:String,pub repository_generation:u64,pub previous:SelectionIdentity,pub eligibility:Option<Eligibility>,pub admission_id:Option<String>,pub selection_id:Option<String>}

pub(super) fn selection(c:&Connection)->Result<SelectionIdentity>{
    Ok(c.query_row("SELECT s.id,s.generation,s.kind,s.installation,s.admission FROM selection_head h JOIN fiscal_selections s ON s.id=h.selection WHERE h.id=1",[],|r|Ok(SelectionIdentity{id:Some(r.get(0)?),generation:r.get(1)?,kind:r.get(2)?,installation_id:r.get(3)?,admission_id:r.get(4)?})).optional()?.unwrap_or_else(SelectionIdentity::integrated))
}
pub(super) fn installed(c:&Connection,src:&replay::Source<'_>,iid:&str)->Result<(String,Vec<u8>,SignedPackage)>{
    let hash:String=c.query_row("SELECT container_sha256 FROM installations WHERE id=?1",[iid],|r|r.get(0)).optional()?.ok_or_else(||fail("INSTALLATION_UNKNOWN"))?;
    let bytes=src.load("containers",&hash,limits::OBJECT_BYTES)?;let envelope:Envelope=core::decode_closed(&core::strict_json::parse(&bytes)?)?;Ok((hash,bytes,envelope.signed))
}
fn admission(c:&Connection,id:&str)->Result<AdmissionBinding>{let b:Vec<u8>=c.query_row("SELECT binding FROM effective_admissions WHERE id=?1",[id],|r|r.get(0)).optional()?.ok_or_else(||fail("ADMISSION_UNKNOWN"))?;let v=core::strict_json::parse_with_limit(&b,limits::MANIFEST as usize)?;canonical::require_wire(&b,&v)?;Ok(core::decode_closed(&v)?)}
fn caps(operations:&[Capability])->Result<()>{if operations!=[Capability::Direct]&&operations!=[Capability::Direct,Capability::Inverse]{return Err(fail("INVALID_OPERATIONS"));}Ok(())}
fn uuid(id:&str)->Result<()>{if uuid::Uuid::parse_str(id).map(|u|u.get_version_num()==4&&u.to_string()==id).unwrap_or(false){Ok(())}else{Err(fail("INVALID_ID"))}}

// Reuse the unchanged core with ALL durable heads. The ONLY continuation is
// its final local-rollback failure, after every cryptographic/security stage,
// and only for the exact current selection reconstructed by replay. No head
// is reduced, no empty MemoryRevisions and no general allow-downgrade option.
pub(super) fn verify_current(bytes:&[u8],view:&replay::View,operation:Capability,at:&str,continuity:bool)->Result<serde_json::Value>{
    let revisions=MemoryRevisions::new(view.heads.values().cloned().collect())?;
    match core::verify_candidate(bytes,&view.trust,&CompiledPolicy::current_2026(),&revisions,operation,at){
        Ok(candidate)=>Ok(serde_json::to_value(candidate.report()).map_err(|_|fail("SERIALIZATION_ERROR"))?),
        Err(e) if continuity&&e.code=="REVISION_ROLLBACK"&&e.stage==Stage::Revision&&e.passed==[Stage::Processing,Stage::Structure,Stage::Canonical,Stage::Integrity,Stage::Trust,Stage::Authentication,Stage::Editorial,Stage::FiscalData,Stage::Compatibility]=>Ok(serde_json::json!({"continuity":"current-replayed-selection-only","localRevisionDecision":"REVISION_ROLLBACK","verifiedAt":at,"rootVersion":view.trust.root_version(),"trustEpoch":view.trust.epoch()})),
        Err(e)=>Err(e.into()),
    }
}
fn make_admission(c:&Connection,src:&replay::Source<'_>,view:&replay::View,iid:&str,operations:&[Capability],at:&str)->Result<AdmissionBinding>{
    caps(operations)?;let(hash,bytes,p)=installed(c,src,iid)?;let mut reports=vec![];for cap in operations{reports.push(verify_current(&bytes,view,*cap,at,false)?);}
    Ok(AdmissionBinding{version:1,installation_id:iid.into(),container_sha256:hash,payload_sha256:hashes::canonical_hash(&p)?,content:p.manifest.content_identity.clone(),exercise:p.manifest.exercise,rule_profile:p.manifest.required_rule_profile_id,contextual_policy:p.manifest.required_contextual_policy_id,parameter_schema:p.manifest.parameter_schema_id,conventions_sha256:hashes::canonical_hash(&p.conventions)?,motor_identity:CompiledPolicy::current_2026().motor_identity().into(),periodicities:vec!["weekly".into(),"fortnightly".into(),"monthly".into()],operations:operations.to_vec(),verified_at:at.into(),root_version:view.trust.root_version(),trust_epoch:view.trust.epoch(),trust_episode:view.episode,reports,state:"eligible-operations;execution-disconnected".into()})
}
fn checked_binding(c:&Connection,src:&replay::Source<'_>,iid:&str,aid:&str)->Result<(AdmissionBinding,Vec<u8>)>{
    let a=admission(c,aid)?;caps(&a.operations)?;let(h,b,p)=installed(c,src,iid)?;
    if a.version!=1||a.installation_id!=iid||a.container_sha256!=h||a.payload_sha256!=hashes::canonical_hash(&p)?||a.content!=p.manifest.content_identity||a.exercise!=2026||a.rule_profile!=PROFILE||a.contextual_policy!=p.manifest.required_contextual_policy_id||a.parameter_schema!=p.manifest.parameter_schema_id||a.conventions_sha256!=hashes::canonical_hash(&p.conventions)?||a.motor_identity!=CompiledPolicy::current_2026().motor_identity()||a.periodicities!=["weekly","fortnightly","monthly"]||a.state!="eligible-operations;execution-disconnected"{return Err(fail("ADMISSION_BINDING_MISMATCH"));}
    Ok((a,b))
}
fn verify_admission(c:&Connection,src:&replay::Source<'_>,view:&replay::View,iid:&str,aid:&str,at:&str,continuity:bool)->Result<AdmissionBinding>{
    let(a,b)=checked_binding(c,src,iid,aid)?;for cap in &a.operations{verify_current(&b,view,*cap,at,continuity)?;}Ok(a)
}
pub(super) fn verify_execution_operation(c:&Connection,src:&replay::Source<'_>,view:&replay::View,iid:&str,aid:&str,operation:Capability,at:&str)->Result<AdmissionBinding>{
    let(a,b)=checked_binding(c,src,iid,aid)?;if !a.operations.contains(&Capability::Direct)||!a.operations.contains(&operation){return Err(fail("OPERATION_NOT_ADMITTED"));}
    verify_current(&b,view,Capability::Direct,at,true)?;if operation==Capability::Inverse{verify_current(&b,view,operation,at,true)?;}Ok(a)
}
fn assess(c:&Connection,src:&replay::Source<'_>,view:&replay::View,iid:&str,aid:Option<&str>,at:&str,continuity:bool)->Eligibility{
    let mut result=Eligibility{installation_id:iid.into(),eligible:false,reason:None,operations:vec![],container_sha256:None,payload_sha256:None,content_sha256:None,revision:0,epoch:0,stream:None,verified_at:at.into(),root_version:view.trust.root_version(),trust_epoch:view.trust.epoch(),continuity,admission_refs:vec![],more_admissions:false,execution:EXECUTION_CLOSED.into()};
    let refs=(||->Result<Vec<AdmissionRef>>{let mut stmt=c.prepare("SELECT a.id,a.operation,a.version FROM effective_admissions a JOIN operations o ON o.id=a.operation WHERE a.installation=?1 ORDER BY o.seq DESC LIMIT 33")?;let rows=stmt.query_map([iid],|r|Ok(AdmissionRef{admission_id:r.get(0)?,operation_id:r.get(1)?,version:r.get(2)?}))?.collect::<rusqlite::Result<Vec<_>>>()?;Ok(rows)})();match refs{Ok(rows)=>{result.more_admissions=rows.len()>32;result.admission_refs=rows.into_iter().take(32).collect();},Err(e)=>{result.reason=Some(e.code);return result;}}
    let checked=(||->Result<()>{let(h,b,p)=installed(c,src,iid)?;result.container_sha256=Some(h);result.payload_sha256=Some(hashes::canonical_hash(&p)?);result.content_sha256=Some(p.manifest.content_identity.sha256);result.revision=p.publication.revision;result.epoch=p.publication.stream_epoch;result.stream=Some(p.publication.stream_id);
        if let Some(aid)=aid{result.operations=verify_admission(c,src,view,iid,aid,at,continuity)?.operations;}else{verify_current(&b,view,Capability::Direct,at,false)?;result.operations.push(Capability::Direct);match verify_current(&b,view,Capability::Inverse,at,false){Ok(_)=>result.operations.push(Capability::Inverse),Err(e) if matches!(e.code,"EDITORIAL_OPERATION_NOT_AUTHORIZED"|"INVERSE_NOT_AUTHORIZED")=>{},Err(e)=>return Err(e)}}Ok(())})();
    match checked{Ok(())=>result.eligible=true,Err(e)=>{result.reason=Some(e.code.into());result.operations.clear();}}result
}
pub(super) fn receipt(action:&Action,op:&str,seq:u64)->Receipt{
    let(installation,execution)=match action{Action::Install{installation_id,..}=>(Some(installation_id.clone()),"not-authorized-for-execution"),Action::AdmitV1{installation_id,..}=>(Some(installation_id.clone()),"effective-admission-v1-not-authorized-for-execution"),Action::SelectV1{installation_id,..}=>(Some(installation_id.clone()),"selection-v1-not-authorized-for-execution"),Action::DeactivateV1{..}=>(None,"deactivation-v1-not-authorized-for-execution"),_=>(None,"not-authorized-for-execution")};
    Receipt{operation_id:op.into(),sequence:seq,generation:seq,installation_id:installation,execution:execution.into()}
}
pub(super) fn intent(action:&Action)->Result<String>{let v=match action{Action::AdmitV1{installation_id,operations,..}=>serde_json::json!({"kind":"effective-admission-v1","installationId":installation_id,"operations":operations}),Action::SelectV1{installation_id,admission_id,expected_selection_generation,expected_selection_id,..}=>serde_json::json!({"kind":"select-v1","installationId":installation_id,"admissionId":admission_id,"previousGeneration":expected_selection_generation,"previousId":expected_selection_id}),Action::DeactivateV1{expected_selection_generation,expected_selection_id,..}=>serde_json::json!({"kind":"deactivate-v1","previousGeneration":expected_selection_generation,"previousId":expected_selection_id}),_=>return Err(fail("INVALID_ACTION"))};Ok(hashes::canonical_hash(&v)?)}
pub(super) fn apply(dst:&Connection,src:&replay::Source<'_>,view:&mut replay::View,action:&Action,op:&str,seq:u64,at:&str,_policy:&Policy)->Result<Receipt>{
    if schema::version(dst)?!=2{return Err(fail("INCOMPATIBLE_SCHEMA"));}
    match action{
        Action::AdmitV1{installation_id,admission_id,operations}=>{uuid(admission_id)?;let a=make_admission(dst,src,view,installation_id,operations,at)?;let b=canonical::bytes(&a)?;limits::size(&b,limits::MANIFEST)?;limits::budget(count(dst,"effective_admissions")?,1,limits::OPERATIONS)?;dst.execute("INSERT INTO effective_admissions VALUES(?1,1,?2,?3,?4)",params![admission_id,installation_id,op,b])?;},
        Action::SelectV1{installation_id,admission_id,selection_id,expected_selection_generation,expected_selection_id}=>{verify_admission(dst,src,view,installation_id,admission_id,at,false)?;write_selection(dst,op,selection_id,*expected_selection_generation,expected_selection_id,Some((installation_id,admission_id)))?;dst.execute("INSERT INTO selection_events VALUES(?1,?2,?3,NULL)",params![selection_id,op,installation_id])?;},
        Action::DeactivateV1{selection_id,expected_selection_generation,expected_selection_id}=>write_selection(dst,op,selection_id,*expected_selection_generation,expected_selection_id,None)?,
        _=>return Err(fail("INVALID_ACTION")),
    }Ok(receipt(action,op,seq))
}
fn write_selection(c:&Connection,op:&str,id:&str,generation:u64,previous:&Option<String>,target:Option<(&str,&str)>)->Result<()>{
    uuid(id)?;let old=selection(c)?;if old.generation!=generation||old.id!=*previous{return Err(fail("STALE_SELECTION"));}limits::budget(generation,1,9_007_199_254_740_991)?;
    c.execute("INSERT INTO fiscal_selections VALUES(?1,1,?2,?3,?4,?5,?6,?7)",params![id,op,generation+1,previous,if target.is_some(){"external"}else{"embedded"},target.map(|t|t.0),target.map(|t|t.1)])?;c.execute("DELETE FROM selection_head",[])?;c.execute("INSERT INTO selection_head VALUES(1,?1)",[id])?;Ok(())
}
impl Repository{
    pub fn selection_status(&self)->Result<SelectionStatus>{let _gate=self.gate.lock().map_err(|_|fail("LOCK_POISONED"))?;let _lock=paths::lock(&self.root)?;let(c,m)=self.existing()?;let view=replay::rebuild(&c,&self.policy,&m)?;recovery::check_pending(self,&c,&m)?;let selected=selection(&c)?;let now=self.clock.now()?;let max=meta(&c)?.3;
        let eligibility=if let(Some(i),Some(a))=(&selected.installation_id,&selected.admission_id){let src=replay::Source{connection:&c,pending:BTreeMap::new()};let mut e=assess(&c,&src,&view,i,Some(a),&now,true);if let Err(error)=clock::check(&now,&max){e.eligible=false;e.reason=Some(error.code.into());e.operations.clear();}Some(e)}else{None};Ok(SelectionStatus{repository_generation:meta(&c)?.1,selection:selected,eligibility,execution:EXECUTION_CLOSED.into()})}
    pub fn activation_eligibility(&self,iid:&str,aid:Option<&str>)->Result<Eligibility>{let _gate=self.gate.lock().map_err(|_|fail("LOCK_POISONED"))?;let _lock=paths::lock(&self.root)?;let(c,m)=self.existing()?;let view=replay::rebuild(&c,&self.policy,&m)?;recovery::check_pending(self,&c,&m)?;let now=self.clock.now()?;clock::check(&now,&meta(&c)?.3)?;Ok(assess(&c,&replay::Source{connection:&c,pending:BTreeMap::new()},&view,iid,aid,&now,false))}
    pub fn prepare_activation(&self,kind:ActivationIntent,iid:Option<&str>,aid:Option<&str>,exception:Option<&str>)->Result<ActivationPreview>{
        self.policy.require_management()?;let _gate=self.gate.lock().map_err(|_|fail("LOCK_POISONED"))?;let _lock=paths::lock(&self.root)?;let(c,m)=self.existing()?;let view=replay::rebuild(&c,&self.policy,&m)?;recovery::check_pending(self,&c,&m)?;let now=self.clock.now()?;let(id,generation,_,maximum)=meta(&c)?;clock::check(&now,&maximum)?;let previous=selection(&c)?;
        // Existing grants remain evidence-only pending review of their operation
        // and exact-container scope for effective admissions. No nonce consumed.
        if exception.is_some(){return Err(fail("EXCEPTIONAL_SELECTION_BLOCKED"));}
        let mut eligibility=None;let mut admission_id=None;let mut selection_id=None;
        let action=match kind{
            ActivationIntent::Admit=>{if aid.is_some(){return Err(fail("INVALID_ARGUMENT"));}let iid=iid.ok_or_else(||fail("INSTALLATION_REQUIRED"))?;let e=assess(&c,&replay::Source{connection:&c,pending:BTreeMap::new()},&view,iid,None,&now,false);if !e.eligible{return Err(fail_reason(&e));}let new_id=uuid::Uuid::new_v4().to_string();admission_id=Some(new_id.clone());let operations=e.operations.clone();eligibility=Some(e);Action::AdmitV1{installation_id:iid.into(),admission_id:new_id,operations}},
            ActivationIntent::Select=>{let iid=iid.ok_or_else(||fail("INSTALLATION_REQUIRED"))?;let aid=aid.ok_or_else(||fail("ADMISSION_REQUIRED"))?;let e=assess(&c,&replay::Source{connection:&c,pending:BTreeMap::new()},&view,iid,Some(aid),&now,false);if !e.eligible{return Err(fail_reason(&e));}let new_id=uuid::Uuid::new_v4().to_string();selection_id=Some(new_id.clone());admission_id=Some(aid.into());eligibility=Some(e);Action::SelectV1{installation_id:iid.into(),admission_id:aid.into(),selection_id:new_id,expected_selection_generation:previous.generation,expected_selection_id:previous.id.clone()}},
            ActivationIntent::Deactivate=>{if iid.is_some()||aid.is_some(){return Err(fail("INVALID_ARGUMENT"));}let new_id=uuid::Uuid::new_v4().to_string();selection_id=Some(new_id.clone());Action::DeactivateV1{selection_id:new_id,expected_selection_generation:previous.generation,expected_selection_id:previous.id.clone()}},
        };Ok(ActivationPreview{action,repository_id:id,repository_generation:generation,previous,eligibility,admission_id,selection_id})
    }
    pub fn confirm_activation(&self,id:&str,preview:&ActivationPreview)->Result<Receipt>{self.policy.require_management()?;let action=preview.action.clone();let repository_id=preview.repository_id.clone();self.mutate(id,preview.repository_generation,move |c|{if meta(c)?.0!=repository_id{return Err(fail("REPOSITORY_IDENTITY_MISMATCH"));}Ok((action,BTreeMap::new()))})}
}
fn fail_reason(e:&Eligibility)->errors::Error{fail(e.reason.unwrap_or("ACTIVATION_INELIGIBLE"))}
