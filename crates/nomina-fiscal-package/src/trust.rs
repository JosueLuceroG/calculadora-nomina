use crate::{canonical,errors::{Failure,Result,Stage},hashes,limits::*,signature,strict_json,time,validation_2026::{digest,identifier},wire::*};
use ed25519_dalek::VerifyingKey;
use std::collections::{BTreeMap,BTreeSet};
mod known_qa_keys;
fn bad(code:&'static str)->Failure{Failure::new(Stage::Trust,code)}
fn production_key(id:&str)->Result<()>{if known_qa_keys::IDS.contains(&id){return Err(bad("QA_KEY_FORBIDDEN_IN_PRODUCTION"));}Ok(())}
fn roots(records:&[RootKey])->Result<BTreeMap<String,VerifyingKey>>{
    if records.len()!=3{return Err(bad("THREE_ROOT_KEYS_REQUIRED"));}let mut result=BTreeMap::new();for r in records{let key=signature::public_key(&r.public_key,&r.key_id)?;if result.insert(r.key_id.clone(),key).is_some(){return Err(bad("DUPLICATE_ROOT_KEY"));}}Ok(result)
}
#[derive(Clone)]pub struct TrustedState{
    channel:Channel,root_version:u64,epoch:u64,root_keys:BTreeMap<String,VerifyingKey>,signed:Option<SignedTrust>,payload_hash:Option<String>,observed_utc:String,
}
impl TrustedState{
    /// Host-only constructors: never deserialize a bootstrap from a package or IPC.
    /// Roots alone confer no package authority; current signed metadata is required.
    pub fn qa_bootstrap(public_roots:&[RootKey])->Result<Self>{Ok(Self{channel:Channel::Qa,root_version:1,epoch:0,root_keys:roots(public_roots)?,signed:None,payload_hash:None,observed_utc:String::new()})}
    pub fn production_bootstrap(channel:Channel,public_roots:&[RootKey])->Result<Self>{
        if channel!=Channel::Production{return Err(bad("PRODUCTION_BOOTSTRAP_CHANNEL_MISMATCH"));}
        let root_keys=roots(public_roots)?;for id in root_keys.keys(){production_key(id)?;}
        Ok(Self{channel:Channel::Production,root_version:1,epoch:0,root_keys,signed:None,payload_hash:None,observed_utc:String::new()})
    }
    pub fn unconfigured_production()->Self{Self{channel:Channel::Production,root_version:0,epoch:0,root_keys:BTreeMap::new(),signed:None,payload_hash:None,observed_utc:String::new()}}
    pub fn channel(&self)->Channel{self.channel}
    pub fn epoch(&self)->u64{self.epoch}
    pub fn root_version(&self)->u64{self.root_version}
    fn now(&self,now:&str)->Result<()>{if !time::instant(now){return Err(bad("INVALID_VERIFICATION_TIME"));}if !self.observed_utc.is_empty()&&now<self.observed_utc.as_str(){return Err(bad("CLOCK_ROLLBACK"));}Ok(())}
    pub fn current(&self,now:&str)->Result<&SignedTrust>{
        if self.root_keys.is_empty(){return Err(bad("PRODUCTION_BOOTSTRAP_MISSING"));}self.now(now)?;let state=self.signed.as_ref().ok_or_else(||bad("TRUST_METADATA_REQUIRED"))?;
        if now<state.issued_at.as_str()||now>=state.expires_at.as_str()||now<state.root_validity.from.as_str()||now>=state.root_validity.through.as_str(){return Err(bad("TRUST_EXPIRED_OR_NOT_YET_VALID"));}Ok(state)
    }
    pub fn propose_update(&self,input:&[u8],now:&str)->Result<Self>{
        self.propose_update_inner(input,now,false)
    }
    fn propose_update_inner(&self,input:&[u8],now:&str,intermediate_root:bool)->Result<Self>{
        if self.root_keys.is_empty(){return Err(bad("PRODUCTION_BOOTSTRAP_MISSING"));}self.now(now)?;
        let raw=strict_json::parse_with_limit(input,MAX_TRUST_BYTES)?;let envelope:TrustEnvelope=crate::decode_closed(&raw)?;canonical::require_wire(input,&raw)?;let s=&envelope.signed;
        if s.format!="mx.nomina.fiscal-trust"||s.format_version!=1||s.canonicalization!="RFC8785"||s.channel!=self.channel{return Err(bad("TRUST_FORMAT_OR_CHANNEL_MISMATCH"));}
        if s.threshold!=2||s.epoch==0||s.root_keys.len()+s.delegations.len()>MAX_KEYS||s.revoked_key_ids.len()>1024||s.withdrawn_payloads.len()>1024||s.floors.len()>128{return Err(bad("TRUST_LIMIT_OR_THRESHOLD"));}
        if !time::instant(&s.issued_at)||!time::instant(&s.expires_at)||!time::instant(&s.root_validity.from)||!time::instant(&s.root_validity.through)
            ||s.root_validity.from>s.issued_at||s.expires_at>s.root_validity.through
            ||time::seconds(&s.expires_at).unwrap()-time::seconds(&s.issued_at).unwrap()>90*86400||s.expires_at<=s.issued_at{return Err(bad("INVALID_TRUST_VALIDITY"));}
        if s.issued_at.as_str()>now{return Err(bad("TRUST_EXPIRED_OR_NOT_YET_VALID"));}
        // Historical root-key links can be expired, but only as private
        // intermediate proposals followed by a fresh final state. They never
        // authorize packages or become an independently returned trust state.
        let renewal=self.root_version.checked_add(1)==Some(s.root_version);
        if (s.expires_at.as_str()<=now||s.root_validity.through.as_str()<=now)&&!(intermediate_root&&renewal){return Err(bad("TRUST_EXPIRED_OR_NOT_YET_VALID"));}
        if time::seconds(&s.root_validity.through).unwrap()-time::seconds(&s.root_validity.from).unwrap()>1830*86400{return Err(bad("ROOT_LIFETIME_LIMIT"));}
        let new_roots=roots(&s.root_keys)?;
        if self.channel==Channel::Production{for id in new_roots.keys(){production_key(id)?;}}
        let same_roots=new_roots==self.root_keys;
        if s.root_version!=self.root_version&&s.root_version!=self.root_version.checked_add(1).ok_or_else(||bad("ROOT_VERSION_OVERFLOW"))?{return Err(bad("ROOT_CHAIN_GAP"));}
        if s.root_version==self.root_version&&!same_roots{return Err(bad("ROOT_TRANSITION_REQUIRED"));}
        if self.signed.as_ref().map(|old|old.root_validity!=s.root_validity&&s.root_version==self.root_version).unwrap_or(false){return Err(bad("ROOT_TRANSITION_REQUIRED"));}
        signature::signature_order(&envelope.signatures)?;let mut old_count=0;let mut new_count=0;
        for record in &envelope.signatures{
            if record.protected.purpose!=Purpose::TrustRoot{return Err(bad("WRONG_TRUST_PURPOSE"));}
            let id=&record.protected.key_id;let key=self.root_keys.get(id).or_else(||new_roots.get(id)).ok_or_else(||bad("UNKNOWN_ROOT_KEY"))?;
            signature::verify(record,&raw["signed"],key)?;if self.root_keys.contains_key(id){old_count+=1;}if new_roots.contains_key(id){new_count+=1;}
        }
        if old_count<2||new_count<2{return Err(bad("ROOT_QUORUM_NOT_MET"));}
        let payload_hash=hashes::canonical_hash(&raw["signed"])?;
        if s.epoch<self.epoch{return Err(bad("TRUST_EPOCH_ROLLBACK"));}if s.epoch==self.epoch&&self.payload_hash.as_ref()!=Some(&payload_hash){return Err(bad("TRUST_EPOCH_CONFLICT"));}
        if s.root_version>self.root_version&&s.epoch<=self.epoch{return Err(bad("TRUST_EPOCH_ROLLBACK"));}
        let revoked=s.revoked_key_ids.iter().collect::<BTreeSet<_>>();let withdrawn=s.withdrawn_payloads.iter().collect::<BTreeSet<_>>();
        if revoked.len()!=s.revoked_key_ids.len()||withdrawn.len()!=s.withdrawn_payloads.len()||s.withdrawn_payloads.iter().any(|h|!digest(h))||s.revoked_key_ids.iter().any(|id|!id.strip_prefix("ed25519-sha256:").map(digest).unwrap_or(false)){return Err(bad("INVALID_WITHDRAWAL_OR_REVOCATION"));}
        let mut keys=new_roots.keys().cloned().collect::<BTreeSet<_>>();
        for d in &s.delegations{
            if self.channel==Channel::Production{production_key(&d.key_id)?;}
            if !matches!(d.purpose,Purpose::Package|Purpose::ContentApproval)||d.channel!=s.channel||!keys.insert(d.key_id.clone())||revoked.contains(&d.key_id)
                ||!identifier(&d.stream_id)||!identifier(&d.parameter_schema_id)||!identifier(&d.rule_profile_id)||!identifier(&d.contextual_policy_id)||!(1..=9999).contains(&d.exercise)
                ||d.stream_epoch==0||d.minimum_revision==0||d.maximum_revision<d.minimum_revision||d.maximum_revision>MAX_SAFE_INTEGER
                ||!time::instant(&d.not_before)||!time::instant(&d.not_after)||d.not_before>=d.not_after||d.not_before<s.root_validity.from||d.not_after>s.root_validity.through
                ||d.operations.is_empty()||d.operations.len()>2||d.operations.iter().collect::<BTreeSet<_>>().len()!=d.operations.len(){return Err(bad("INVALID_DELEGATION"));}
            signature::public_key(&d.public_key,&d.key_id)?;
            if !s.floors.iter().any(|f|f.stream_id==d.stream_id&&f.exercise==d.exercise&&f.rule_profile_id==d.rule_profile_id&&f.stream_epoch==d.stream_epoch&&d.minimum_revision>=f.minimum_revision){return Err(bad("UNREGISTERED_DELEGATION_STREAM"));}
        }
        if new_roots.keys().any(|id|revoked.contains(id)){return Err(bad("REVOKED_ACTIVE_ROOT"));}
        let mut streams=BTreeSet::new();for f in &s.floors{if !identifier(&f.stream_id)||!identifier(&f.rule_profile_id)||!(1..=9999).contains(&f.exercise)||f.stream_epoch==0||f.minimum_revision>MAX_SAFE_INTEGER||!streams.insert((&f.stream_id,f.exercise,&f.rule_profile_id)){return Err(bad("INVALID_STREAM_FLOOR"));}}
        if let Some(previous)=&self.signed{
            if previous.revoked_key_ids.iter().any(|id|!revoked.contains(id))||previous.withdrawn_payloads.iter().any(|hash|!withdrawn.contains(hash)){return Err(bad("REVOCATION_ROLLBACK"));}
            for old in &previous.floors{let new=s.floors.iter().find(|f|f.stream_id==old.stream_id&&f.exercise==old.exercise&&f.rule_profile_id==old.rule_profile_id).ok_or_else(||bad("REVISION_FLOOR_REMOVED"))?;
                if new.stream_epoch<old.stream_epoch||new.stream_epoch>old.stream_epoch+1||(new.stream_epoch==old.stream_epoch&&new.minimum_revision<old.minimum_revision)
                    ||(new.stream_epoch>old.stream_epoch&&new.reason.as_ref().map(|s|s.trim().is_empty()).unwrap_or(true)){return Err(bad("REVISION_FLOOR_ROLLBACK"));}}
        }
        Ok(Self{channel:self.channel,root_version:s.root_version,epoch:s.epoch,root_keys:new_roots,signed:Some(s.clone()),payload_hash:Some(payload_hash),observed_utc:now.into()})
    }
    pub fn propose_chain(&self,updates:&[Vec<u8>],now:&str)->Result<Self>{if updates.len()>MAX_TRANSITIONS{return Err(bad("TRUST_TRANSITION_LIMIT"));}let mut proposed=self.clone();for (i,update) in updates.iter().enumerate(){proposed=proposed.propose_update_inner(update,now,i+1<updates.len())?;}proposed.current(now)?;Ok(proposed)}
    pub(crate) fn editorial_signers(&self,package:&SignedPackage,raw_signed:&serde_json::Value,records:&[SignatureRecord],purpose:Purpose,operation:Capability,now:&str)->Result<Vec<String>>{
        let state=self.current(now)?;if state.channel!=package.channel{return Err(bad("CHANNEL_MISMATCH"));}if package.publication.minimum_trust_epoch>state.epoch{return Err(bad("TRUST_METADATA_OUTDATED"));}
        let mut result=vec![];for record in records.iter().filter(|r|r.protected.purpose==purpose){let id=&record.protected.key_id;
            if state.revoked_key_ids.contains(id){return Err(bad("KEY_REVOKED"));}
            let d=state.delegations.iter().find(|d|&d.key_id==id).ok_or_else(||bad("UNKNOWN_EDITORIAL_KEY"))?;
            if d.purpose!=purpose||d.channel!=package.channel||d.exercise!=package.manifest.exercise||d.parameter_schema_id!=package.manifest.parameter_schema_id||d.rule_profile_id!=package.manifest.required_rule_profile_id
                ||d.contextual_policy_id!=package.manifest.required_contextual_policy_id||d.stream_id!=package.publication.stream_id||d.stream_epoch!=package.publication.stream_epoch
                ||package.publication.revision<d.minimum_revision||package.publication.revision>d.maximum_revision{return Err(bad("DELEGATION_SCOPE_MISMATCH"));}
            if now<d.not_before.as_str()||now>=d.not_after.as_str(){return Err(bad("EDITORIAL_KEY_EXPIRED_OR_NOT_YET_VALID"));}
            if !d.operations.contains(&Capability::Direct)||(operation==Capability::Inverse&&!d.operations.contains(&Capability::Inverse))||package.manifest.required_capabilities.iter().any(|c|!d.operations.contains(c)){return Err(bad("EDITORIAL_OPERATION_NOT_AUTHORIZED"));}
            signature::verify(record,raw_signed,&signature::public_key(&d.public_key,id)?)?;result.push(id.clone());
        }if result.is_empty(){return Err(Failure::new(if purpose==Purpose::ContentApproval{Stage::Editorial}else{Stage::Authentication},"EDITORIAL_SIGNATURE_REQUIRED"));}Ok(result)
    }
}
#[cfg(test)]mod production_tests;
