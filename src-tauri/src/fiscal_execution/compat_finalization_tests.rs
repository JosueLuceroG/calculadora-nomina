use super::*;
use crate::fiscal_repository::{Repository,Policy,Clock,ActivationIntent};
use crate::storage::{StorageService,PreferencePatch,StoreRoute};
use nomina_fiscal_package::{hashes,wire::Capability};
use serde_json::{Value,json};
use std::{fs,path::{Path,PathBuf},process::Command};
fn id()->String{uuid::Uuid::new_v4().to_string()}
fn root()->PathBuf{Path::new(env!("CARGO_MANIFEST_DIR")).join("..")}
fn rel(path:&Path)->String{path.strip_prefix(root()).unwrap().to_string_lossy().replace('\\',"/")}
fn evidence()->PathBuf{root().join("docs/evidence/snapshot-v3-compat/cd4/cd3-regression")}
fn fixture(n:&str)->Vec<u8>{fs::read(root().join("docs/evidence/5d3b2/fixtures").join(n)).unwrap()}
struct Qa{root:PathBuf,service:Arc<ExecutionService>,salary:Arc<StorageService>,owner:Owner}
impl Qa{
 fn new()->Self{
  fs::create_dir_all(evidence()).unwrap();
  let dir=std::env::temp_dir().join("opencode").join(format!("nomina-cd3-{}",id()));
  let repo=Repository::new(dir.clone(),Policy::import_qa()).execution_test_clock(Clock::system());
  repo.initialize_new().unwrap();repo.accept_trust_episode(&id(),0,&[fixture("trust.json")]).unwrap();
  let iid=repo.record_verified_installation(&id(),1,&fixture("package1.nomina-fiscal"),&[Capability::Direct,Capability::Inverse]).unwrap().installation_id.unwrap();
  let p=repo.prepare_activation(ActivationIntent::Admit,Some(&iid),None,None).unwrap();repo.confirm_activation(&id(),&p).unwrap();let p=repo.prepare_activation(ActivationIntent::Select,Some(&iid),p.admission_id.as_deref(),None).unwrap();repo.confirm_activation(&id(),&p).unwrap();
  let salary=Arc::new(StorageService::new(Ok(dir.clone())));salary.set_preferences(PreferencePatch{theme:None,history_auto_save:Some(true)}).unwrap();
  let imports=Arc::new(ImportService::new(repo,true));let owner=imports.owner("main",930).unwrap();
  Self{root:dir,service:Arc::new(ExecutionService::with_storage(imports,salary.clone())),salary,owner}
 }
 fn request(&self,inverse:bool,amount:&str,stress:bool)->PrepareRequest{
  let selection=self.service.imports.repository.selection_status().unwrap().selection;
  PrepareRequest{client_request_id:id(),request_id:1,expected_selection_id:selection.id.unwrap(),expected_selection_generation:selection.generation,
   capture:Capture{area:"general-zone".into(),form:Form{mode:if inverse{"net-to-gross"}else{"gross-to-net"}.into(),amount:amount.into(),period:"monthly".into(),effective_date:"2026-02-01".into(),bonus_days:if stress{"365000000"}else{"15"}.into(),vacation_days:"12".into(),vacation_premium:"25".into(),include_imss:true}},
   scenario:json!({"kind":"contextual-retention-2026-v2","salaryBasis":"fixed-period","monthlyCondition":"unknown","referenceMonth":"2026-02"})}
 }
 fn prepare(&self,r:&PrepareRequest)->State{let s=self.service.prepare_bound(&self.owner,r,"manual").unwrap();assert_eq!(s.phase,"ready");assert_eq!(s.version,2);s}
 fn calculate(&self,r:&PrepareRequest,s:&State,mode:&str,label:&str)->(Value,PathBuf){
  let material=self.service.material(&self.owner,&ReferenceRequest{handle:Some(s.handle.clone()),client_request_id:None}).unwrap().to_string();
  let run=evidence().join("runs").join(format!("{label}-{}",s.execution_id));fs::create_dir_all(&run).unwrap();let input=run.join("input.json");
  fs::write(&input,serde_json::to_vec_pretty(&json!({"state":s,"request":r,"materialWire":material,"mode":mode})).unwrap()).unwrap();
  let result=Command::new("node").arg(root().join("docs/evidence/snapshot-v3-compat/cd3/engine-probe.mjs")).arg(&input).current_dir(root()).output().unwrap();
  fs::write(run.join("engine-stderr.log"),&result.stderr).unwrap();assert!(result.status.success(),"engine failed: {}",String::from_utf8_lossy(&result.stderr).chars().take(1000).collect::<String>());
  let value:Value=serde_json::from_slice(&result.stdout).unwrap();fs::write(run.join("engine-result.json"),&result.stdout).unwrap();(value,run)
 }
 fn complete(&self,s:&State,v:&Value)->State{let done=self.service.complete(&self.owner,&CompleteRequest{handle:s.handle.clone(),result_wire:v["resultWire"].as_str().unwrap().into()}).unwrap();assert_eq!(done.phase,"complete");done}
 fn final_document(&self,s:&State)->(String,String){let d=self.service.finalize(&self.owner,&FinalizeRequest{handle:s.handle.clone(),expected_result_sha256:s.result_sha256.clone().unwrap()}).unwrap();let value=serde_json::to_value(&d).unwrap();assert_eq!(value["stored"],false);assert_eq!(value["mathematicalAttestation"],false);let payload=value["payload"].as_str().unwrap().to_owned();let wire:Value=serde_json::from_str(&payload).unwrap();let complete=crate::storage::compat_complete(&wire["value"]);assert_eq!(value["writeGeneration"].is_string(),complete);let checksum=value["documentSha256"].as_str().unwrap().to_owned();assert_eq!(hashes::sha256(payload.as_bytes()),checksum);(payload,checksum)}
 fn no_writes(&self,s:&State,payload:&str,sha:&str){
  let generation=self.salary.begin_write().unwrap().generation;
  let wire:Value=serde_json::from_str(payload).unwrap();if !crate::storage::compat_complete(&wire["value"]){for route in [StoreRoute::Manual,StoreRoute::Automatic]{assert_eq!(self.service.store_document(&self.owner,&AuthorityReference{handle:s.handle.clone(),expected_document_sha256:sha.into()},&generation,payload,route).unwrap_err().code,"DOCUMENT_MANUAL_FLOW_REQUIRED");}}
  assert_eq!(self.salary.insert(&generation,payload).unwrap_err().code,"V3_WRITE_CLOSED");assert_eq!(self.salary.insert_automatic(&generation,payload).unwrap_err().code,"V3_WRITE_CLOSED");
  assert!(StorageService::validate_finalized_document(payload).is_err());assert_eq!(self.salary.reconcile_v3(&s.execution_id,sha).unwrap().stored,Some(false));assert!(self.salary.list(100,None).unwrap().items.is_empty());
 }
 fn cancel(&self,s:&State){self.service.cancel(&self.owner,&ReferenceRequest{handle:Some(s.handle.clone()),client_request_id:None}).unwrap();}
 fn update(&self,name:&str){let repo=&self.service.imports.repository;let g=repo.open_existing().unwrap().generation;repo.accept_trust_episode(&id(),g,&[fixture(name)]).unwrap();}
 fn select_b(&self){let repo=&self.service.imports.repository;let g=repo.open_existing().unwrap().generation;let iid=repo.record_verified_installation(&id(),g,&fixture("package2.nomina-fiscal"),&[Capability::Direct,Capability::Inverse]).unwrap().installation_id.unwrap();let p=repo.prepare_activation(ActivationIntent::Admit,Some(&iid),None,None).unwrap();repo.confirm_activation(&id(),&p).unwrap();let p=repo.prepare_activation(ActivationIntent::Select,Some(&iid),p.admission_id.as_deref(),None).unwrap();repo.confirm_activation(&id(),&p).unwrap();}
}
impl Drop for Qa{fn drop(&mut self){let _=fs::remove_dir_all(&self.root);}}

#[test]
fn cd3_fresh_native_sessions_finalize_complete_partial_stress_and_no_candidate_without_writes(){
 let q=Qa::new();let mut records=vec![];
 for(label,inverse,amount,stress,mode)in [("direct",false,"15000.00",false,"normal"),("partial",false,"9451.20",false,"normal"),("no-candidate",true,"9451.20",false,"no-candidate"),("stress",true,"13202.64",true,"normal")]{
  let r=q.request(inverse,amount,stress);let ready=q.prepare(&r);let(v,run)=q.calculate(&r,&ready,mode,label);let before:Value=serde_json::from_str(v["resultWire"].as_str().unwrap()).unwrap();let done=q.complete(&ready,&v);let(payload,sha)=q.final_document(&done);let wire:Value=serde_json::from_str(&payload).unwrap();let s=&wire["value"];
  assert_eq!(s["outcome"],before["outcome"]);assert_eq!(s["capture"],serde_json::to_value(&r.capture).unwrap());assert_eq!(s["executionProvenance"]["producerId"],"nomina-signed-fiscal-document-v3-v2");assert_eq!(s["executionId"],done.execution_id);assert_eq!(s["executionProvenance"]["authorizationObservation"]["kind"],"native-observation-v1");
  let again=q.final_document(&done);assert_eq!(again.0,payload);assert_eq!(again.1,sha);q.no_writes(&done,&payload,&sha);
  let report=&s["outcome"]["report"];
  if label=="partial"{assert_eq!(report["status"],"not-determinable");assert!(report["net"]["amount"].is_null());}
  if label=="no-candidate"{assert!(report["recommended"].is_null());assert!(report["recommendedForwardResult"].is_null());assert!(s["effectiveContext"]["evaluationObservation"]["reportedForwardPolicyVersions"].as_array().unwrap().is_empty());assert!(s["effectiveContext"]["evaluationObservation"]["reportedParameterSetVersions"].is_null());}
  if stress{assert_eq!(report["provenance"]["certificationAvailable"],false);assert_eq!(report["metrics"]["certifiedClosures"],0);assert_eq!(report["coverage"]["minimumProven"],false);assert_eq!(report["coverage"]["uniquenessProven"],false);assert!(!report["coverage"]["pendingIntervals"].as_array().unwrap().is_empty());}
  fs::write(run.join("finalized.json"),&payload).unwrap();let run_rel=rel(&run);let summary=json!({"label":label,"executionId":done.execution_id,"run":run_rel,"nativePrepared":true,"freshJsCalculated":true,"nativeCompleted":true,"nativeFinalized":true,"producer":s["executionProvenance"]["producerId"],"documentSha256":sha,"documentBytes":payload.len(),"outcomeUnchanged":true,"status":report["status"],"match":report["match"],"metrics":report["metrics"],"publicJsonWritesRejected":true,"nativeFinalizationAloneInsertsNothing":true,"salaryRows":0});records.push(summary);q.cancel(&done);
 }
 fs::write(evidence().join("native-finalization.json"),serde_json::to_vec_pretty(&records).unwrap()).unwrap();
}

#[test]
fn cd3_selection_change_keeps_native_contract_and_issued_a(){
 let q=Qa::new();let r=q.request(false,"15000.00",false);let ready=q.prepare(&r);let(v,run)=q.calculate(&r,&ready,"normal","selection-a");q.select_b();let done=q.complete(&ready,&v);let(payload,sha)=q.final_document(&done);let s:Value=serde_json::from_str(&payload).unwrap();assert_eq!(s["value"]["fiscalPackage"]["id"],"mx-fiscal-2026-source-v3");assert_eq!(s["value"]["outcome"]["report"]["net"]["amount"],"13202.64");q.no_writes(&done,&payload,&sha);fs::write(run.join("finalized.json"),payload).unwrap();
}

#[test]
fn cd3_expired_cancelled_late_and_revoked_results_do_not_finalize_or_write(){
 let mut results=vec![];
 for action in ["expired-before-complete","cancelled-before-complete","revoked-before-complete","expired-before-finalize","revoked-before-finalize","revoked-after-finalize"]{
  let q=Qa::new();let r=q.request(false,"15000.00",false);let ready=q.prepare(&r);let(v,_)=q.calculate(&r,&ready,"normal",action);let before=action.ends_with("before-complete");
  let done=if before{None}else{Some(q.complete(&ready,&v))};let document=if action=="revoked-after-finalize"{Some(q.final_document(done.as_ref().unwrap()))}else{None};
  if action.starts_with("expired"){q.service.age(&ready.handle,Duration::from_secs(600),Duration::ZERO);}else if action.starts_with("cancelled"){q.cancel(&ready);}else{q.update("trust-revoked.json");}
  let error=if before{q.service.complete(&q.owner,&CompleteRequest{handle:ready.handle.clone(),result_wire:v["resultWire"].as_str().unwrap().into()}).unwrap_err().code}else{q.service.finalize(&q.owner,&FinalizeRequest{handle:ready.handle.clone(),expected_result_sha256:done.as_ref().unwrap().result_sha256.clone().unwrap()}).unwrap_err().code};
  if let Some((p,h))=document{q.no_writes(&done.unwrap(),&p,&h);}
  assert!(q.salary.list(100,None).unwrap().items.is_empty());results.push(json!({"action":action,"rejected":error,"salaryRows":0}));
 }
 fs::write(evidence().join("session-negatives.json"),serde_json::to_vec_pretty(&results).unwrap()).unwrap();
}

#[test]
fn cd3_client_contract_crossing_archives_and_result_swaps_cannot_rebind_a_session(){
 let q=Qa::new();let r=q.request(false,"15000.00",false);let mut client=serde_json::to_value(&r).unwrap();client["documentContract"]=DocumentContract::LegacyV3.binding();assert!(serde_json::from_value::<PrepareRequest>(client).is_err());
 let ready=q.prepare(&r);assert_eq!(q.service.prepare_bound(&q.owner,&r,"manual").unwrap().execution_id,ready.execution_id);assert_eq!(q.service.prepare(&q.owner,&r).unwrap_err().code,"REQUEST_CONFLICT");
 let(v,_)=q.calculate(&r,&ready,"normal","binding");let mut crossed:Value=serde_json::from_str(v["resultWire"].as_str().unwrap()).unwrap();crossed["documentContract"]=DocumentContract::LegacyV3.binding();assert_eq!(q.service.complete(&q.owner,&CompleteRequest{handle:ready.handle.clone(),result_wire:crossed.to_string()}).unwrap_err().code,"RESULT_CONTEXT_MISMATCH");
 for key in ["executionId","materialSha256"]{let mut swapped:Value=serde_json::from_str(v["resultWire"].as_str().unwrap()).unwrap();swapped[key]=if key=="executionId"{id().into()}else{"0".repeat(64).into()};assert_eq!(q.service.complete(&q.owner,&CompleteRequest{handle:ready.handle.clone(),result_wire:swapped.to_string()}).unwrap_err().code,"RESULT_CONTEXT_MISMATCH");}
 let archived:Value=serde_json::from_slice(&fs::read(root().join("docs/evidence/5d3b5/runs/ccb510ae-3be6-4e57-9951-77403524ba6e/dw2-outcome.json")).unwrap()).unwrap();assert!(q.service.complete(&q.owner,&CompleteRequest{handle:ready.handle.clone(),result_wire:archived.to_string()}).is_err());
 assert_eq!(q.service.finalize(&q.owner,&FinalizeRequest{handle:id(),expected_result_sha256:"0".repeat(64)}).unwrap_err().code,"SESSION_UNKNOWN");
 let done=q.complete(&ready,&v);let mut swapped:Value=serde_json::from_str(v["resultWire"].as_str().unwrap()).unwrap();swapped["outcome"]["report"]["gross"]["amount"]="16000.00".into();assert_eq!(q.service.complete(&q.owner,&CompleteRequest{handle:ready.handle.clone(),result_wire:swapped.to_string()}).unwrap_err().code,"RESULT_CONFLICT");let(p,h)=q.final_document(&done);q.no_writes(&done,&p,&h);
 fs::write(evidence().join("binding-negatives.json"),serde_json::to_vec_pretty(&json!({"clientCannotSelect":true,"nativeContractInIntent":true,"duplicatePrepareSameExecution":true,"crossedTupleRejected":true,"differentExecutionIdRejected":true,"differentMaterialDigestRejected":true,"archivedOutcomeRejectedAsSessionResult":true,"unknownHandleRejected":true,"sealedResultSwapRejected":true,"salaryRows":0})).unwrap()).unwrap();
}

#[test]
fn cd3_consent_generation_and_tombstones_are_not_renewed_by_finalization(){
 let q=Qa::new();let mut rows=vec![];
 for action in ["opt-in-late","opt-out","clear","tombstone"]{
  q.salary.set_preferences(PreferencePatch{theme:None,history_auto_save:Some(action!="opt-in-late")}).unwrap();
  let r=q.request(false,"15000.00",false);let ready=q.prepare(&r);
  let captured={let registry=q.service.registry.lock().unwrap();let session=&registry.sessions[&ready.handle];(session.initial.generation().map(str::to_owned),session.initial.eligible(StoreRoute::Manual))};
  assert_eq!(captured.1,action!="opt-in-late");let(v,_)=q.calculate(&r,&ready,"normal",action);let done=q.complete(&ready,&v);
  match action{"opt-in-late"=>{q.salary.set_preferences(PreferencePatch{theme:None,history_auto_save:Some(true)}).unwrap();},"opt-out"=>{q.salary.set_preferences(PreferencePatch{theme:None,history_auto_save:Some(false)}).unwrap();},"clear"=>{q.salary.clear().unwrap();},_=>{q.salary.delete(&done.execution_id).unwrap();}}
  let(p,h)=q.final_document(&done);q.no_writes(&done,&p,&h);
  let after={let registry=q.service.registry.lock().unwrap();let session=&registry.sessions[&ready.handle];(session.initial.generation().map(str::to_owned),session.initial.eligible(StoreRoute::Manual))};assert_eq!(captured,after);
  rows.push(json!({"action":action,"initialEligibilityPreserved":true,"generationNotReissued":true,"initialGenerationReturnedWithoutRenewal":true,"nativeFinalizationAloneInsertsNothing":true,"salaryRows":0}));q.cancel(&done);
 }
 fs::write(evidence().join("consent-generation.json"),serde_json::to_vec_pretty(&rows).unwrap()).unwrap();
}
