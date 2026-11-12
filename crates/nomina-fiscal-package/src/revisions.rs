use serde::{Deserialize,Serialize};
use crate::{errors::{Failure,Result,Stage},hashes,signature,strict_json,time,validation_2026::{digest,identifier},wire::*,trust::TrustedState};
#[derive(Debug,Clone,Serialize,Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]pub struct RevisionFloor{pub channel:Channel,pub stream_id:String,pub exercise:u64,pub rule_profile_id:String,pub stream_epoch:u64,pub revision:u64,pub payload_sha256:String}
#[derive(Debug,Clone,Default)]pub struct MemoryRevisions{floors:Vec<RevisionFloor>}
impl MemoryRevisions{
    pub fn new(floors:Vec<RevisionFloor>)->Result<Self>{if floors.len()>128{return Err(Failure::new(Stage::Revision,"REVISION_STATE_LIMIT"));}let mut keys=std::collections::BTreeSet::new();for f in &floors{if !identifier(&f.stream_id)||!identifier(&f.rule_profile_id)||!(1..=9999).contains(&f.exercise)||f.stream_epoch==0||f.stream_epoch>crate::limits::MAX_SAFE_INTEGER||!digest(&f.payload_sha256)||f.revision>crate::limits::MAX_SAFE_INTEGER||!keys.insert((format!("{:?}",f.channel),&f.stream_id,f.exercise,&f.rule_profile_id)){return Err(Failure::new(Stage::Revision,"INVALID_REVISION_STATE"));}}Ok(Self{floors})}
    pub fn check(&self,p:&SignedPackage,payload_hash:&str,trust:&TrustedState,now:&str)->Result<&'static str>{
        let bad=|code|Failure::new(Stage::Revision,code);let t=trust.current(now)?;
        if t.withdrawn_payloads.iter().any(|h|h==payload_hash){return Err(bad("PAYLOAD_WITHDRAWN"));}
        let root=t.floors.iter().find(|f|f.stream_id==p.publication.stream_id&&f.exercise==p.manifest.exercise&&f.rule_profile_id==p.manifest.required_rule_profile_id).ok_or_else(||bad("UNREGISTERED_STREAM"))?;
        if root.stream_epoch!=p.publication.stream_epoch||p.publication.revision<root.minimum_revision{return Err(bad("REVISION_BELOW_TRUST_FLOOR"));}
        if let Some(local)=self.floors.iter().find(|f|f.channel==p.channel&&f.stream_id==p.publication.stream_id&&f.exercise==p.manifest.exercise&&f.rule_profile_id==p.manifest.required_rule_profile_id){
            if local.stream_epoch>p.publication.stream_epoch{return Err(bad("TRUST_METADATA_OUTDATED"));}
            if local.stream_epoch==p.publication.stream_epoch{if p.publication.revision<local.revision{return Err(bad("REVISION_ROLLBACK"));}if p.publication.revision==local.revision{if payload_hash!=local.payload_sha256{return Err(bad("REVISION_CONFLICT"));}return Ok("repeat-same-payload");}}
        }Ok("new-candidate-no-state-advanced")
    }
}
/// Exceptional authorization is a pure check. It cannot activate a rollback.
pub fn verify_rollback(input:&[u8],trust:&TrustedState,now:&str,current_floor:u64,target:&str)->Result<RollbackGrant>{
    let raw=strict_json::parse_with_limit(input,crate::limits::MAX_TRUST_BYTES)?;let envelope:RollbackEnvelope=crate::decode_closed(&raw)?;crate::canonical::require_wire(input,&raw)?;let grant=&envelope.signed;let t=trust.current(now)?;
    if grant.format!="mx.nomina.fiscal-rollback"||grant.format_version!=1||grant.channel!=t.channel||grant.previous_minimum_revision!=current_floor||grant.target_payload_sha256!=target||!digest(target)||!time::instant(&grant.expires_at)||grant.expires_at.as_str()<=now||grant.expires_at>t.expires_at||grant.reason.trim().is_empty()||!identifier(&grant.nonce)||t.withdrawn_payloads.iter().any(|p|p==target)
        ||!t.floors.iter().any(|f|f.stream_id==grant.stream_id&&f.stream_epoch==grant.stream_epoch&&current_floor>=f.minimum_revision){return Err(Failure::new(Stage::Revision,"INVALID_ROLLBACK_AUTHORIZATION"));}
    signature::signature_order(&envelope.signatures)?;let mut count=0;for record in &envelope.signatures{if record.protected.purpose!=Purpose::RollbackAuthorization{return Err(Failure::new(Stage::Revision,"WRONG_ROLLBACK_PURPOSE"));}let key=t.root_keys.iter().find(|key|key.key_id==record.protected.key_id).ok_or_else(||Failure::new(Stage::Revision,"UNKNOWN_ROLLBACK_KEY"))?;signature::verify(record,&raw["signed"],&signature::public_key(&key.public_key,&key.key_id)?)?;count+=1;}
    if count<2{return Err(Failure::new(Stage::Revision,"ROLLBACK_QUORUM_NOT_MET"));}let _=hashes::canonical_hash(&raw["signed"])?;Ok(grant.clone())
}
