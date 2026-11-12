//! Isolated production-protocol tests; all private signers live only in cfg(test).
use super::*;
use crate::fiscal_repository::{production_tests::management::Fixture,ActivationIntent,Policy,Repository};
use crate::storage::{StorageService,PreferencePatch,StoreRoute};
use nomina_fiscal_package::{hashes,canonical};
use serde_json::{Value,json};
use std::{fs,path::{Path,PathBuf},process::Command};
fn id()->String{uuid::Uuid::new_v4().to_string()}
fn workspace()->PathBuf{Path::new(env!("CARGO_MANIFEST_DIR")).join("..")}
struct Harness{f:Fixture,service:Arc<ExecutionService>,salary:Arc<StorageService>}
struct Doc{state:State,payload:String,sha:String,generation:Option<String>}
impl Harness{
    fn new(consent:bool)->Self{Self::with_operations(consent,false)}
    fn with_operations(consent:bool,direct_only:bool)->Self{
        let mut f=Fixture::with_prefix("r2b4");
        if direct_only{f.package["manifest"]["requiredCapabilities"]=json!(["direct"]);for d in f.metadata["delegations"].as_array_mut().unwrap(){d["operations"]=json!(["direct"]);}}
        f.install_trust();let iid=f.install();let aid=f.admit(&iid);
        let(s,n,_,_)=f.activation_preview(ActivationIntent::Select,Some(&iid),Some(&aid));assert_eq!(f.activation.confirm(&f.owner,&s,&n).unwrap().phase,"committed");
        let salary=Arc::new(StorageService::new(Ok(f.root.clone())));salary.set_preferences(PreferencePatch{theme:None,history_auto_save:Some(consent)}).unwrap();
        let service=Arc::new(ExecutionService::with_storage(f.imports.clone(),salary.clone()));Self{f,service,salary}
    }
    fn consent(&self,on:bool){self.salary.set_preferences(PreferencePatch{theme:None,history_auto_save:Some(on)}).unwrap();}
    fn request(&self,mode:&str)->PrepareRequest{
        let selected=self.f.imports.repository.selection_status().unwrap().selection;
        PrepareRequest{client_request_id:id(),request_id:1,expected_selection_id:selected.id.unwrap(),expected_selection_generation:selected.generation,
            capture:Capture{area:"general-zone".into(),form:Form{mode:if matches!(mode,"inverse"|"no-candidate"|"limited"){"net-to-gross"}else{"gross-to-net"}.into(),amount:match mode{"partial"|"no-candidate"=>"9451.20","inverse"|"limited"=>"13202.64",_=>"15000.00"}.into(),period:"monthly".into(),effective_date:"2026-02-01".into(),bonus_days:"15".into(),vacation_days:"12".into(),vacation_premium:"25".into(),include_imss:true}},
            scenario:json!({"kind":"contextual-retention-2026-v2","salaryBasis":"fixed-period","monthlyCondition":"unknown","referenceMonth":"2026-02"})}
    }
    fn prepare(&self,r:&PrepareRequest,route:&str)->State{self.service.prepare_bound(&self.f.owner,r,route).unwrap()}
    fn document(&self,mode:&str,route:&str)->Doc{
        let request=self.request(mode);let state=self.prepare(&request,route);assert_eq!(state.phase,"ready","{:?}",state.reason);assert!(!state.mathematical_attestation&&!state.persistence_allowed);
        let material=self.service.material(&self.f.owner,&ReferenceRequest{handle:Some(state.handle.clone()),client_request_id:None}).unwrap().to_string();
        let decoded:Value=serde_json::from_str(&material).unwrap();assert_eq!(decoded["packageEnvelope"]["signed"]["channel"],"production");
        let run=self.f.root.join(format!("run-{}",state.execution_id));fs::create_dir(&run).unwrap();let input=run.join("input.json");
        let probe_mode=match mode{"inverse"=>"complete-inverse","no-candidate"=>"no-candidate","limited"=>"limited-candidate",_=>"normal"};
        fs::write(&input,serde_json::to_vec(&json!({"request":request,"state":state,"materialWire":material,"mode":probe_mode,"referenceMode":route})).unwrap()).unwrap();
        // Read-only reuse of the accepted probe; every generated artifact is in this new temp run.
        let engine=Command::new("node").arg(workspace().join("docs/evidence/snapshot-v3-compat/cd4/engine-probe.mjs")).arg(&input).current_dir(workspace()).output().unwrap();
        assert!(engine.status.success(),"{}",String::from_utf8_lossy(&engine.stderr));let result:Value=serde_json::from_slice(&engine.stdout).unwrap();
        assert_eq!(result["provenance"]["freshEngine"],true);assert_eq!(result["provenance"]["mutationsMocked"],false);
        let completed=self.service.complete(&self.f.owner,&CompleteRequest{handle:state.handle,result_wire:result["resultWire"].as_str().unwrap().into()}).unwrap();assert_eq!(completed.phase,"complete");
        let finalized=self.service.finalize(&self.f.owner,&FinalizeRequest{handle:completed.handle.clone(),expected_result_sha256:completed.result_sha256.clone().unwrap()}).unwrap();
        let response=serde_json::to_value(&finalized).unwrap();drop(finalized);assert_eq!(response["stored"],false);assert_eq!(response["mathematicalAttestation"],false);
        let payload=response["payload"].as_str().unwrap().to_owned();let sha=response["documentSha256"].as_str().unwrap().to_owned();assert_eq!(hashes::sha256(payload.as_bytes()),sha);
        let snapshot:Value=serde_json::from_str(&payload).unwrap();let submitted:Value=serde_json::from_str(result["resultWire"].as_str().unwrap()).unwrap();assert_eq!(snapshot["value"]["outcome"],submitted["outcome"]);
        fs::write(run.join("finalized.json"),&payload).unwrap();
        Doc{state:completed,payload,sha,generation:response["writeGeneration"].as_str().map(str::to_owned)}
    }
    fn store(&self,d:&Doc,generation:&str,route:StoreRoute)->Result<crate::storage::StoreOutcome>{self.service.store_document(&self.f.owner,&AuthorityReference{handle:d.state.handle.clone(),expected_document_sha256:d.sha.clone()},generation,&d.payload,route)}
    fn revoke(&self){let key=self.f.metadata["delegations"].as_array().unwrap().iter().find(|d|d["purpose"]=="package").unwrap()["keyId"].clone();self.f.update(|s|{s["revokedKeyIds"]=json!([key]);s["delegations"].as_array_mut().unwrap().retain(|d|d["keyId"]!=key);});}
    fn empty(&self){assert!(self.salary.list(100,None).unwrap().items.is_empty());}
    fn release(&self,d:&Doc){self.service.cancel(&self.f.owner,&ReferenceRequest{handle:Some(d.state.handle.clone()),client_request_id:None}).unwrap();}
}

#[test]
fn production_execution_finalization_storage_and_reopening_preserve_originals(){
    let mut h=Harness::new(true);let mut records=vec![];
    for(mode,route)in [("direct",StoreRoute::Manual),("direct",StoreRoute::Automatic),("inverse",StoreRoute::Automatic)]{
        let d=h.document(mode,if matches!(route,StoreRoute::Manual){"manual"}else{"automatic"});let generation=d.generation.as_ref().unwrap();
        let saved=h.store(&d,generation,route).unwrap();assert_eq!(saved.stored,Some(true));assert!(saved.inserted);assert!(!h.store(&d,generation,route).unwrap().inserted);
        let reopened=StorageService::new(Ok(h.f.root.clone()));assert_eq!(reopened.get(&d.state.execution_id).unwrap().as_deref(),Some(d.payload.as_str()));assert_eq!(reopened.reconcile_v3(&d.state.execution_id,&d.sha).unwrap().stored,Some(true));
        let s:Value=serde_json::from_str(&d.payload).unwrap();assert_eq!(s["value"]["executionProvenance"]["producerId"],"nomina-signed-fiscal-document-v3-v2");assert_eq!(s["value"]["fiscalEvidence"]["packageEnvelope"]["signed"]["channel"],"production");
        let forward=if mode=="inverse"{&s["value"]["outcome"]["report"]["recommendedForwardResult"]}else{&s["value"]["outcome"]["report"]};assert_eq!(forward["net"]["amount"],"13202.64");
        records.push(json!({"operation":mode,"route":if matches!(route,StoreRoute::Manual){"manual"}else{"automatic"},"executionId":d.state.execution_id,"documentSha256":d.sha,"stored":true,"reopenedExactBytes":true,"mathematicalAttestation":false}));
    }
    assert_eq!(h.salary.list(100,None).unwrap().items.len(),3);
    let report=json!({"kind":"r2b4-production-protocol-test-only","cases":records,"salaryRows":3,"originalsPreserved":true,"privateMaterialWritten":false,"inverseTestDomain":{"from":"15000.00","to":"15000.00"}});
    let bytes=canonical::bytes(&report).unwrap();fs::write(h.f.root.join("execution-flow.json"),&bytes).unwrap();println!("R2B4_EXECUTION:{}",json!({"directory":h.f.root,"reportSha256":hashes::sha256(&bytes),"report":report}));h.f.retain=true;
}

#[test]
fn absent_bootstrap_or_crossed_native_host_never_issue_authority(){
    let root=std::env::temp_dir().join("opencode").join(format!("r2b4-absent-{}",id()));let imports=Arc::new(ImportService::new(Repository::new(root.clone(),Policy::production()),false));
    assert_eq!(ExecutionService::new(imports).enabled().err().unwrap().code,"PRODUCTION_BOOTSTRAP_MISSING");assert!(!root.exists());
    let h=Harness::new(true);let imports=Arc::new(ImportService::new(Repository::new(h.f.root.clone(),Policy::import_qa()),false));assert_eq!(ExecutionService::new(imports).enabled().err().unwrap().code,"HOST_POLICY_MISMATCH");h.empty();
}

#[test]
fn stale_selection_and_unapproved_daily_period_cannot_prepare(){
    let h=Harness::new(true);let mut r=h.request("direct");r.expected_selection_generation+=1;let s=h.prepare(&r,"manual");assert_eq!(s.reason.as_deref(),Some("STALE_SELECTION"));assert!(s.context_sha256.is_none());
    let mut r=h.request("direct");r.capture.form.period="daily".into();assert!(h.service.prepare_bound(&h.f.owner,&r,"manual").is_err());h.empty();
}

#[test]
fn signed_channel_and_signature_failures_cannot_become_executable_sources(){
    let h=Harness::new(true);let mut qa=h.f.package.clone();qa["channel"]=json!("qa");assert_eq!(h.f.imports.repository.prepare_import(&[h.f.package_bytes(&qa)],false).err().unwrap().code,"CHANNEL_MISMATCH");
    let mut bad:Value=serde_json::from_slice(&h.f.package_bytes(&h.f.package)).unwrap();bad["signatures"][0]["value"]=json!("A".repeat(86));assert_eq!(h.f.imports.repository.prepare_import(&[canonical::bytes(&bad).unwrap()],false).err().unwrap().code,"INVALID_SIGNATURE");h.empty();
}

#[test]
fn revocation_after_preparation_and_before_commit_rejects_without_salary_write(){
    let h=Harness::new(true);let d=h.document("direct","automatic");h.revoke();
    assert_eq!(h.store(&d,d.generation.as_ref().unwrap(),StoreRoute::Automatic).err().unwrap().code,"KEY_REVOKED");h.empty();
    let s=h.prepare(&h.request("direct"),"manual");assert_eq!(s.reason.as_deref(),Some("KEY_REVOKED"));assert!(s.context_sha256.is_none());
}

#[test]
fn source_expiry_and_session_ttl_reject_before_write(){
    for fiscal_expiry in [true,false]{let h=Harness::new(true);let d=h.document("direct","manual");
        if fiscal_expiry{*h.f.clock.lock().unwrap()="2026-12-01T00:00:00Z".into();}else{h.service.age(&d.state.handle,Duration::from_secs(600),Duration::ZERO);}
        assert_eq!(h.store(&d,d.generation.as_ref().unwrap(),StoreRoute::Manual).err().unwrap().code,if fiscal_expiry{"TRUST_EXPIRED_OR_NOT_YET_VALID"}else{"EXECUTION_EXPIRED"});h.empty();
    }
}

#[test]
fn initial_final_consent_and_storage_generation_cannot_be_refreshed_into_authority(){
    let h=Harness::new(false);let d=h.document("direct","manual");h.consent(true);assert_eq!(h.store(&d,d.generation.as_ref().unwrap(),StoreRoute::Manual).err().unwrap().code,"INITIAL_CONSENT_REQUIRED");h.empty();
    for clear in [false,true]{let h=Harness::new(true);let d=h.document("direct","automatic");if clear{h.salary.clear().unwrap();}else{h.consent(false);h.consent(true);}
        assert_eq!(h.store(&d,d.generation.as_ref().unwrap(),StoreRoute::Automatic).err().unwrap().code,"STALE_GENERATION");let fresh=h.salary.begin_write().unwrap().generation;
        assert_eq!(h.store(&d,&fresh,StoreRoute::Manual).err().unwrap().code,"STALE_GENERATION");h.empty();
    }
}

#[test]
fn public_json_fabricated_permits_and_foreign_owners_do_not_write(){
    let h=Harness::new(true);let d=h.document("direct","manual");let g=d.generation.as_ref().unwrap();
    assert_eq!(h.salary.insert(g,&d.payload).unwrap_err().code,"V3_WRITE_CLOSED");assert_eq!(h.salary.insert_automatic(g,&d.payload).unwrap_err().code,"V3_WRITE_CLOSED");
    let unknown=AuthorityReference{handle:id(),expected_document_sha256:d.sha.clone()};assert_eq!(h.service.store_document(&h.f.owner,&unknown,g,&d.payload,StoreRoute::Manual).err().unwrap().code,"SESSION_UNKNOWN");
    let mut other=h.f.owner.clone();other.incarnation=id();let authority=AuthorityReference{handle:d.state.handle.clone(),expected_document_sha256:d.sha.clone()};assert_eq!(h.service.store_document(&other,&authority,g,&d.payload,StoreRoute::Manual).err().unwrap().code,"SESSION_OWNER_MISMATCH");
    let mut forged:Value=serde_json::from_str(&d.payload).unwrap();forged["value"]["executionProvenance"]["authorizationObservation"]["nativeExecutionId"]=json!(id());let payload=forged.to_string();
    let fake=AuthorityReference{handle:d.state.handle.clone(),expected_document_sha256:hashes::sha256(payload.as_bytes())};assert_eq!(h.service.store_document(&h.f.owner,&fake,g,&payload,StoreRoute::Manual).err().unwrap().code,"DOCUMENT_CONFLICT");h.empty();
    assert_eq!(h.store(&d,g,StoreRoute::Manual).unwrap().stored,Some(true));
}

#[test]
fn incomplete_direct_and_inverse_diagnostics_never_receive_write_generation(){
    let h=Harness::new(true);for mode in ["partial","no-candidate","limited"]{let d=h.document(mode,"manual");assert!(d.generation.is_none());let g=h.salary.begin_write().unwrap().generation;
        if mode=="limited"{let s:Value=serde_json::from_str(&d.payload).unwrap();assert_eq!(s["value"]["outcome"]["report"]["coverage"]["state"],"limited");}
        for route in [StoreRoute::Manual,StoreRoute::Automatic]{assert_eq!(h.store(&d,&g,route).err().unwrap().code,"DOCUMENT_MANUAL_FLOW_REQUIRED");}h.release(&d);
    }h.empty();
}

#[test]
fn inverse_requires_its_own_admission_and_preserves_complete_direct_capability(){
    let h=Harness::with_operations(true,true);let s=h.prepare(&h.request("inverse"),"manual");assert_eq!(s.reason.as_deref(),Some("OPERATION_NOT_ADMITTED"));
    let d=h.document("direct","manual");assert_eq!(h.store(&d,d.generation.as_ref().unwrap(),StoreRoute::Manual).unwrap().stored,Some(true));
}

#[test]
fn postcommit_revocation_preserves_original_history_and_tombstones(){
    let h=Harness::new(true);let d=h.document("direct","automatic");assert_eq!(h.store(&d,d.generation.as_ref().unwrap(),StoreRoute::Automatic).unwrap().stored,Some(true));h.revoke();
    let reopened=StorageService::new(Ok(h.f.root.clone()));assert_eq!(reopened.get(&d.state.execution_id).unwrap().as_deref(),Some(d.payload.as_str()));assert_eq!(reopened.reconcile_v3(&d.state.execution_id,&d.sha).unwrap().stored,Some(true));
    reopened.delete(&d.state.execution_id).unwrap();assert_eq!(reopened.reconcile_v3(&d.state.execution_id,&d.sha).unwrap().reason.as_deref(),Some("DELETED_EXECUTION"));
    assert_eq!(h.store(&d,d.generation.as_ref().unwrap(),StoreRoute::Automatic).err().unwrap().code,"DELETED_EXECUTION");
}
