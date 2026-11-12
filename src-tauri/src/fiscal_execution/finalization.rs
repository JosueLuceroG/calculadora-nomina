use super::*;
use crate::storage::{InitialEligibility,StoreRoute,StoreOutcome};
use serde::{Serialize,Deserialize,ser::SerializeStruct};
#[derive(Debug,Clone,Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]pub(crate) struct AuthorityReference{pub handle:String,pub expected_document_sha256:String}
// No public constructor and no Deserialize. Only the live session path below
// creates this permit, while execution/owner/fiscal guards are held.
pub(crate) struct DocumentPermit<'a>{payload:&'a str,checksum:&'a str,initial:&'a InitialEligibility}
impl DocumentPermit<'_>{pub(crate) fn payload(&self)->&str{self.payload}pub(crate) fn checksum(&self)->&str{self.checksum}pub(crate) fn initial(&self)->&InitialEligibility{self.initial}}
pub(crate) struct FinalizationResponse{payload:String,execution_id:String,request_id:u64,checksum:String,write_generation:Option<String>,service:Arc<ExecutionService>}
impl std::fmt::Debug for FinalizationResponse{fn fmt(&self,f:&mut std::fmt::Formatter)->std::fmt::Result{write!(f,"FinalizedDocument({} bytes)",self.payload.len())}}
impl Serialize for FinalizationResponse{fn serialize<S:serde::Serializer>(&self,s:S)->std::result::Result<S::Ok,S::Error>{let mut state=s.serialize_struct("FinalizedDocument",9)?;state.serialize_field("phase","document-finalized")?;state.serialize_field("executionId",&self.execution_id)?;state.serialize_field("requestId",&self.request_id)?;state.serialize_field("documentSha256",&self.checksum)?;state.serialize_field("documentBytes",&self.payload.len())?;state.serialize_field("payload",&self.payload)?;state.serialize_field("writeGeneration",&self.write_generation)?;state.serialize_field("stored",&false)?;state.serialize_field("mathematicalAttestation",&false)?;state.end()}}
impl Drop for FinalizationResponse{fn drop(&mut self){if let Ok(mut r)=self.service.registry.lock(){r.transfer_bytes=0;}}}
fn liveness(created:Instant,touched:Instant)->Result<()>{if created.elapsed()>=ABSOLUTE||touched.elapsed()>=IDLE{Err(fail("EXECUTION_EXPIRED"))}else{Ok(())}}
impl ExecutionService{
 pub fn finalize(self:&Arc<Self>,owner:&Owner,request:&FinalizeRequest)->Result<FinalizationResponse>{
  self.enabled()?;let reference=ReferenceRequest{handle:Some(request.handle.clone()),client_request_id:None};let mut registry=self.registry.lock().map_err(|_|fail("UNAVAILABLE"))?;
  if registry.transfer_bytes!=0{return Err(fail("MATERIAL_TRANSFER_BUSY"));}if registry.sessions.values().map(|s|s.reserved).sum::<usize>()+2*RESULT_MAX>RETAINED_MAX{return Err(fail("EXECUTION_CAPACITY"));}
   let minimum=registry.maximum_utc.clone();let mut observed=String::new();let s=self.find(&mut registry,owner,&reference)?;if !matches!(s.state.phase.as_str(),"complete"|"document-finalized"|"not-stored"){return Err(fail(s.state.reason.as_deref().unwrap_or("RESULT_NOT_COMPLETE")));}if s.state.result_sha256.as_deref()!=Some(&request.expected_result_sha256){return Err(fail("RESULT_CONFLICT"));}
   let context=s.context.as_ref().ok_or_else(||fail("EXECUTION_NOT_READY"))?;if context.document_contract!=s.document_contract{return Err(fail("DOCUMENT_CONTRACT_MISMATCH"));}let document=self.imports.with_owner_guard(owner,||self.imports.repository.with_execution_guard(context,|guard|->Result<Arc<str>>{
    liveness(s.created,s.touched)?;observed=guard.authorize_now()?;if observed<minimum{return Err(fail("CLOCK_ROLLBACK"));}if let Some(d)=&s.final_document{return Ok(d.clone());}let result=s.result.as_ref().ok_or_else(||fail("RESULT_NOT_COMPLETE"))?;if hashes::sha256(result.as_bytes())!=request.expected_result_sha256{return Err(fail("RESULT_CONFLICT"));}
    let text=document::build_bound(s.document_contract,s.material.as_ref().ok_or_else(||fail("EXECUTION_NOT_READY"))?,result,s.completed_utc.as_deref().ok_or_else(||fail("INVALID_NATIVE_TIME"))?,s.prepared_local.as_ref().ok_or_else(||fail("INVALID_NATIVE_TIME"))?,s.completed_local.as_ref().ok_or_else(||fail("INVALID_NATIVE_TIME"))?,&s.reference_mode)?;Ok(Arc::from(text))
  }))?;
   let sha=hashes::sha256(document.as_bytes());s.document_sha256=Some(sha.clone());s.final_document=Some(document.clone());s.state.phase="document-finalized".into();s.touched=Instant::now();let execution_id=s.state.execution_id.clone();let request_id=s.state.request_id;let eligible=s.document_contract.writable()||crate::storage::compat_complete(&json::parse(&document)?["value"]);let generation=if eligible{s.initial.generation().map(str::to_owned)}else{None};
   registry.maximum_utc=observed;let charge=document.len().checked_mul(3).and_then(|n|n.checked_add(1024)).ok_or_else(||fail("EXECUTION_CAPACITY"))?;let total=registry.sessions.values().map(|s|s.reserved).sum::<usize>()+charge;if total>RETAINED_MAX{return Err(fail("EXECUTION_CAPACITY"));}registry.transfer_bytes=charge;registry.peak_total=registry.peak_total.max(total);
  Ok(FinalizationResponse{payload:document.to_string(),execution_id,request_id,checksum:sha,write_generation:generation,service:self.clone()})
 }
 pub fn store_document(&self,owner:&Owner,authority:&AuthorityReference,generation:&str,payload:&str,route:StoreRoute)->Result<StoreOutcome>{
  uuid(&authority.handle)?;if !nomina_fiscal_package::validation_2026::digest(&authority.expected_document_sha256)||uuid::Uuid::parse_str(generation).is_err(){return Err(fail("INVALID_ARGUMENT"));}
  self.enabled()?;if payload.len()>RESULT_MAX{return Err(fail("DOCUMENT_TOO_LARGE"));}let storage=self.storage.as_ref().ok_or_else(||fail("STORAGE_UNAVAILABLE"))?;let reference=ReferenceRequest{handle:Some(authority.handle.clone()),client_request_id:None};let mut registry=self.registry.lock().map_err(|_|fail("UNAVAILABLE"))?;let minimum=registry.maximum_utc.clone();let s=self.find(&mut registry,owner,&reference)?;
   if s.document_sha256.as_deref()!=Some(authority.expected_document_sha256.as_str())||hashes::sha256(payload.as_bytes())!=authority.expected_document_sha256{return Err(fail("DOCUMENT_CONFLICT"));}
  if s.commit.is_some(){let r=storage.reconcile_v3(&s.state.execution_id,&authority.expected_document_sha256)?;if r.stored==Some(true){s.commit=Some(r.clone());s.state.phase="stored".into();return Ok(r);}if r.reason.as_deref()==Some("DELETED_EXECUTION"){return Err(fail("DELETED_EXECUTION"));}}
  if !matches!(s.state.phase.as_str(),"document-finalized"|"not-stored"|"outcome-unknown"){return Err(fail(s.state.reason.as_deref().unwrap_or("DOCUMENT_NOT_FINALIZED")));}let document=s.final_document.as_ref().ok_or_else(||fail("DOCUMENT_NOT_FINALIZED"))?;if document.as_ref()!=payload{return Err(fail("DOCUMENT_CONFLICT"));}let context=s.context.as_ref().ok_or_else(||fail("EXECUTION_NOT_READY"))?;
  if context.document_contract!=s.document_contract{return Err(fail("DOCUMENT_CONTRACT_MISMATCH"));}
  if s.document_contract==DocumentContract::CompatReadOnlyV1{
   if !crate::storage::compat_complete(&json::parse(document)?["value"]){return Err(fail("DOCUMENT_MANUAL_FLOW_REQUIRED"));}
   let material=s.material.as_ref().ok_or_else(||fail("EXECUTION_NOT_READY"))?;let result=s.result.as_ref().ok_or_else(||fail("RESULT_NOT_COMPLETE"))?;
   if Some(hashes::sha256(material.as_bytes())).as_deref()!=s.state.material_sha256.as_deref()||Some(hashes::sha256(result.as_bytes())).as_deref()!=s.state.result_sha256.as_deref(){return Err(fail("RESULT_CONFLICT"));}
  }
   let observed=std::cell::RefCell::new(minimum);let result=self.imports.with_owner_guard(owner,||self.imports.repository.with_execution_guard(context,|guard|->Result<StoreOutcome>{
    let permit=DocumentPermit{payload:document,checksum:&authority.expected_document_sha256,initial:&s.initial};let authorize=||{liveness(s.created,s.touched).map_err(|e|crate::storage::failure(&e.code))?;let now=guard.authorize_now().map_err(|e|crate::storage::failure(e.code))?;if now.as_str()<observed.borrow().as_str(){return Err(crate::storage::failure("CLOCK_ROLLBACK"));}*observed.borrow_mut()=now;Ok(())};Ok(storage.insert_authorized_v3(generation,&permit,route,authorize)?)
  }));
   let response=match result{Ok(r)=>{s.state.phase=if r.stored==Some(true){"stored"}else if r.stored==Some(false){"not-stored"}else{"outcome-unknown"}.into();s.state.reason=r.reason.clone();s.commit=Some(r.clone());if r.stored==Some(true){s.material=None;s.result=None;s.context=None;s.capture=None;s.scenario=None;s.final_document=None;s.reserved=0;}Ok(r)},Err(e)=>{s.state.phase="not-stored".into();s.state.reason=Some(e.code.clone());Err(e)}};registry.maximum_utc=observed.into_inner();response
 }
}
#[cfg(test)]#[path="finalization_tests.rs"]mod tests;
