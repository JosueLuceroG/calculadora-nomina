use serde::Serialize;
use crate::{canonical,compatibility::{CompiledPolicy,Compatibility},errors::{Failure,Result,Stage},hashes,revisions::MemoryRevisions,signature,strict_json,time,trust::TrustedState,validation_2026,wire::*};
#[derive(Debug,Clone,Serialize)]#[serde(rename_all="camelCase")]pub struct Identities{pub content:ContentIdentity,pub signed_payload_sha256:String,pub container_sha256:String,pub motor_identity:&'static str}
#[derive(Debug,Clone,Serialize)]#[serde(rename_all="camelCase")]pub struct VerificationReport{
    pub channel:Channel,pub requested_operation:Capability,pub stages:Vec<Stage>,pub authentication:&'static str,pub editorial_approval:&'static str,pub fiscal_data:&'static str,pub compatibility:Compatibility,pub identities:Identities,
    pub publishing_keys:Vec<String>,pub approval_keys:Vec<String>,pub root_version:u64,pub trust_epoch:u64,pub verified_at:String,pub revision_status:&'static str,pub execution:&'static str,
}
pub struct VerifiedCandidate{report:VerificationReport,package:SignedPackage,canonical_envelope:Vec<u8>}
impl VerifiedCandidate{pub fn report(&self)->&VerificationReport{&self.report}pub fn package(&self)->&SignedPackage{&self.package}pub fn canonical_bytes(&self)->&[u8]{&self.canonical_envelope}}
pub fn validate_structure(p:&SignedPackage,now:Option<&str>)->Result<()>{
    if p.format!="mx.nomina.fiscal-package"||p.format_version!=1||p.canonicalization!="RFC8785"||p.manifest.manifest_version!=1||p.manifest.required_capabilities.is_empty()||p.manifest.required_capabilities.len()>2||p.manifest.required_capabilities.iter().collect::<std::collections::BTreeSet<_>>().len()!=p.manifest.required_capabilities.len()||p.publication.revision==0||p.publication.stream_epoch==0||p.publication.minimum_trust_epoch==0
        ||!validation_2026::identifier(&p.publication.stream_id)||!time::instant(&p.publication.published_at)||now.map(|n|!time::instant(n)||p.publication.published_at.as_str()>n).unwrap_or(false){return Err(Failure::new(Stage::Structure,"INVALID_PACKAGE_HEADER"));}
    if p.publication.changes.summary.trim().is_empty()||p.publication.changes.supersedes.as_ref().map(|s|s.scheme!="legacy-registry-v1"||!validation_2026::digest(&s.sha256)).unwrap_or(false){return Err(Failure::new(Stage::Structure,"INVALID_CHANGE_RECORD"));}Ok(())
}
pub fn verify_candidate(input:&[u8],trust:&TrustedState,policy:&CompiledPolicy,revisions:&MemoryRevisions,operation:Capability,now:&str)->Result<VerifiedCandidate>{
    let mut passed=vec![];
    let result=(||{
        let raw=strict_json::parse(input)?;passed.push(Stage::Processing);let envelope:Envelope=crate::decode_closed(&raw)?;let p=&envelope.signed;
        validate_structure(p,Some(now))?;
        passed.push(Stage::Structure);canonical::require_wire(input,&raw)?;passed.push(Stage::Canonical);
        if p.manifest.content_identity.scheme!="legacy-registry-v1"||!validation_2026::digest(&p.manifest.content_identity.sha256)||hashes::canonical_hash(&raw["signed"]["registry"])?!=p.manifest.content_identity.sha256{return Err(Failure::new(Stage::Integrity,"CONTENT_HASH_MISMATCH"));}
        let identities=Identities{content:p.manifest.content_identity.clone(),signed_payload_sha256:hashes::canonical_hash(&raw["signed"])?,container_sha256:hashes::sha256(input),motor_identity:policy.motor_identity()};passed.push(Stage::Integrity);
        trust.current(now)?;if trust.channel()!=p.channel{return Err(Failure::new(Stage::Trust,"CHANNEL_MISMATCH"));}passed.push(Stage::Trust);
        signature::signature_order(&envelope.signatures)?;if envelope.signatures.iter().any(|s|!matches!(s.protected.purpose,Purpose::Package|Purpose::ContentApproval)){return Err(Failure::new(Stage::Authentication,"WRONG_PACKAGE_SIGNATURE_PURPOSE"));}
        let publishing_keys=trust.editorial_signers(p,&raw["signed"],&envelope.signatures,Purpose::Package,operation,now)?;passed.push(Stage::Authentication);
        let approval_keys=trust.editorial_signers(p,&raw["signed"],&envelope.signatures,Purpose::ContentApproval,operation,now).map_err(|mut e|{e.stage=Stage::Editorial;e})?;passed.push(Stage::Editorial);
        policy.guard(p)?;validation_2026::validate(p)?;passed.push(Stage::FiscalData);let compatibility=policy.assess(p,operation)?;passed.push(Stage::Compatibility);
        let revision_status=revisions.check(p,&identities.signed_payload_sha256,trust,now)?;passed.push(Stage::Revision);
        Ok(VerifiedCandidate{report:VerificationReport{channel:p.channel,requested_operation:operation,stages:passed.clone(),authentication:"authenticated",editorial_approval:"approved-by-distinct-delegated-key",fiscal_data:"coherent-not-normatively-certified",compatibility,identities,publishing_keys,approval_keys,root_version:trust.root_version(),trust_epoch:trust.epoch(),verified_at:now.into(),revision_status,execution:"not-installed-not-authorized"},package:p.clone(),canonical_envelope:input.to_vec()})
    })();result.map_err(|mut failure:Failure|{failure.passed=passed;failure})
}
