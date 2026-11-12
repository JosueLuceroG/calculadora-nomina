//! R2.B.3: all signing and synthetic anchor construction are confined to cfg(test).
use super::*;
use crate::fiscal_import::{ImportService,Owner};
use crate::fiscal_activation::ActivationService;
use serde_json::{Value,json};
use std::time::Duration;

pub(crate) struct Fixture {
    pub(crate) root:PathBuf, pub(crate) imports:Arc<ImportService>, pub(crate) activation:ActivationService, pub(crate) owner:Owner,
    pub(crate) clock:Arc<Mutex<String>>, roots:Vec<SigningKey>, publisher:SigningKey, approver:SigningKey,
    pub(crate) metadata:Value, pub(crate) package:Value, pub(crate) retain:bool,
}
impl Fixture {
    fn new()->Self{Self::with_prefix("r2b3")}
    pub(crate) fn with_prefix(prefix:&str)->Self{
        let root=std::env::temp_dir().join("opencode").join(format!("{prefix}-{}",id()));
        let (roots,records)=inventory();let (mut editorial,_)=inventory();let publisher=editorial.pop().unwrap();let approver=editorial.pop().unwrap();
        let public=|k:&SigningKey|{let b=k.verifying_key().to_bytes();json!({"keyId":core::hashes::key_id(&b),"publicKey":URL_SAFE_NO_PAD.encode(b)})};
        let mut package:Value=serde_json::from_str(include_str!("../../../docs/evidence/5d3a/editorial-source-2026.json")).unwrap();
        package["channel"]=json!("production");package["review"]["recordId"]=json!("r2b3-ephemeral-test-only");package["publication"]["publishedAt"]=json!("2026-11-01T00:00:00Z");
        let mut metadata=serde_json::from_slice::<Value>(&trust(&records,1,1,&[&roots[0],&roots[1]])).unwrap()["signed"].clone();
        let delegation=|k:&SigningKey,purpose:&str|{let mut d=public(k);for (field,value) in [
            ("purpose",json!(purpose)),("channel",json!("production")),("exercise",json!(2026)),("parameterSchemaId",package["manifest"]["parameterSchemaId"].clone()),
            ("ruleProfileId",package["manifest"]["requiredRuleProfileId"].clone()),("contextualPolicyId",package["manifest"]["requiredContextualPolicyId"].clone()),
            ("streamId",package["publication"]["streamId"].clone()),("streamEpoch",json!(1)),("minimumRevision",json!(1)),("maximumRevision",json!(100)),
            ("notBefore",json!("2026-11-01T00:00:00Z")),("notAfter",json!("2026-12-01T00:00:00Z")),("operations",json!(["direct","inverse"]))]{d[field]=value;}d};
        metadata["delegations"]=json!([delegation(&publisher,"package"),delegation(&approver,"content-approval")]);
        metadata["floors"]=json!([{"streamId":package["publication"]["streamId"],"exercise":2026,"ruleProfileId":package["manifest"]["requiredRuleProfileId"],"streamEpoch":1,"minimumRevision":1,"reason":null}]);
        let clock=Arc::new(Mutex::new(NOW.into()));let mut repo=Repository::new(root.clone(),policy(&records));repo.clock=Clock{fixed:Some(clock.clone())};
        let imports=Arc::new(ImportService::new(repo,false));let owner=imports.owner("main",91).unwrap();let activation=ActivationService::new(imports.clone());
        Self{root,imports,activation,owner,clock,roots,publisher,approver,metadata,package,retain:false}
    }
    fn trust_bytes(&self,s:&Value)->Vec<u8>{sign_document(s,&[(&self.roots[0],Purpose::TrustRoot),(&self.roots[1],Purpose::TrustRoot)])}
    pub(crate) fn package_bytes(&self,s:&Value)->Vec<u8>{sign_document(s,&[(&self.publisher,Purpose::Package),(&self.approver,Purpose::ContentApproval)])}
    fn preview(&self,is_trust:bool,bytes:Vec<u8>)->(String,String,String){
        let s=self.imports.begin(&self.owner,serde_json::from_value(json!(if is_trust{"trust"}else{"package"})).unwrap()).unwrap();
        self.imports.selector_closed();self.imports.selected(&self.owner,&s.session_id,vec![bytes]).unwrap();
        let s=self.imports.get(&self.owner,&s.session_id).unwrap();assert_eq!(s.phase,"ready");
        (s.session_id,s.preview_nonce.unwrap(),s.operation_id)
    }
    pub(crate) fn install_trust(&self){let(s,n,_)=self.preview(true,self.trust_bytes(&self.metadata));assert_eq!(self.imports.confirm(&self.owner,&s,&n).unwrap().phase,"committed");}
    pub(crate) fn install(&self)->String{let(s,n,_)=self.preview(false,self.package_bytes(&self.package));let r=self.imports.confirm(&self.owner,&s,&n).unwrap();assert_eq!(r.phase,"committed");r.receipt.unwrap().installation_id.unwrap()}
    pub(crate) fn activation_preview(&self,intent:ActivationIntent,iid:Option<&str>,aid:Option<&str>)->(String,String,String,Option<String>){
        let s=self.activation.reserve(&self.owner).unwrap();let p=self.activation.prepare(&self.owner,&s.session_id,intent,iid,aid,None).unwrap();assert_eq!(p.phase,"ready","{:?}",p.error);
        (p.session_id,p.preview_nonce.unwrap(),p.operation_id,p.summary.unwrap().admission_id)
    }
    pub(crate) fn admit(&self,iid:&str)->String{let(s,n,_,a)=self.activation_preview(ActivationIntent::Admit,Some(iid),None);assert_eq!(self.activation.confirm(&self.owner,&s,&n).unwrap().phase,"committed");a.unwrap()}
    fn generation(&self)->u64{self.imports.repository.open_existing().unwrap().generation}
    pub(crate) fn update(&self,mutate:impl FnOnce(&mut Value)){
        let mut s=self.metadata.clone();s["epoch"]=json!(2);mutate(&mut s);let(sid,n,_)=self.preview(true,self.trust_bytes(&s));assert_eq!(self.imports.confirm(&self.owner,&sid,&n).unwrap().phase,"committed");
    }
}
impl Drop for Fixture{fn drop(&mut self){if !self.retain{let _=fs::remove_dir_all(&self.root);}}}

#[test]
fn product_management_full_flow_requires_explicit_confirmations_without_auto_execution(){
    let mut f=Fixture::new();let info=f.imports.info(None);assert!(!info.qa&&info.can_import);assert!(info.message.contains("autorización nativa vigente"));assert!(!f.root.exists());
    let(s,n,_)=f.preview(true,f.trust_bytes(&f.metadata));assert!(!f.root.join("fiscal").exists());f.imports.confirm(&f.owner,&s,&n).unwrap();
    let iid=f.install();assert_eq!(f.generation(),2);assert_eq!(f.activation.selection().unwrap().selection.kind,"embedded");
    assert!(f.imports.repository.activation_eligibility(&iid,None).unwrap().admission_refs.is_empty());
    let aid=f.admit(&iid);assert_eq!(f.generation(),3);assert_eq!(f.activation.selection().unwrap().selection.kind,"embedded");
    let(s,n,op,_)=f.activation_preview(ActivationIntent::Select,Some(&iid),Some(&aid));let committed=f.activation.confirm(&f.owner,&s,&n).unwrap();assert_eq!(committed.phase,"committed");
    assert_eq!(f.activation.confirm(&f.owner,&s,&n).unwrap().receipt,committed.receipt);
    let selected=f.activation.selection().unwrap();assert_eq!(selected.selection.kind,"external");assert!(selected.eligibility.unwrap().eligible);assert_eq!(f.generation(),4);
    assert!(f.imports.enabled().is_ok());
    let execution=crate::fiscal_execution::ExecutionService::new(f.imports.clone());assert!(execution.enabled().is_ok());
    let bytes=f.package_bytes(&f.package);let hash=core::hashes::sha256(&bytes);assert_eq!(f.imports.repository.read_original(&hash).unwrap(),bytes);
    let reopened=Repository::new(f.root.clone(),policy(&serde_json::from_value::<Vec<RootKey>>(f.metadata["rootKeys"].clone()).unwrap()));assert_eq!(reopened.open_existing().unwrap().generation,4);
    assert!(!f.root.join("payroll.sqlite3").exists());
    let evidence=json!({"kind":"r2b3-native-test-only","channel":"production","bootstrapSha256":f.imports.repository.policy.hash().unwrap(),"contentSha256":f.package["manifest"]["contentIdentity"]["sha256"],"containerSha256":hash,"generation":4,"selectionGeneration":selected.selection.generation,"installationId":iid,"admissionId":aid,"operationId":op,"execution":"not-requested","privateMaterialWritten":false});
    for(name,data)in [("test-public-bootstrap.json",core::canonical::bytes(&json!({"channel":"production","rootKeys":f.metadata["rootKeys"]})).unwrap()),("test-trust.json",f.trust_bytes(&f.metadata)),("test-package.nomina-fiscal",bytes),("flow.json",core::canonical::bytes(&evidence).unwrap())]{use std::io::Write;let mut file=fs::OpenOptions::new().create_new(true).write(true).open(f.root.join(name)).unwrap();file.write_all(&data).unwrap();}
    println!("R2B3_FLOW:{}",json!({"directory":f.root,"evidence":evidence,"flowSha256":core::hashes::canonical_hash(&evidence).unwrap()}));f.retain=true;
}

#[test]
fn management_requires_compiled_anchor_and_matching_native_host(){
    let f=Fixture::new();let prod=ImportService::new(Repository::new(f.root.clone(),Policy::production()),false);assert!(!prod.info(None).can_import);assert_eq!(prod.management_enabled().err().unwrap().code,"PRODUCTION_BOOTSTRAP_MISSING");
    let false_qa=ImportService::new(Repository::new(f.root.clone(),policy(&serde_json::from_value::<Vec<RootKey>>(f.metadata["rootKeys"].clone()).unwrap())),true);
    assert_eq!(false_qa.management_enabled().err().unwrap().code,"HOST_POLICY_MISMATCH");assert_eq!(false_qa.enabled().err().unwrap().code,"HOST_POLICY_MISMATCH");
    let false_prod=ImportService::new(Repository::new(f.root.clone(),Policy::import_qa()),false);assert_eq!(false_prod.management_enabled().err().unwrap().code,"HOST_POLICY_MISMATCH");assert!(!f.root.exists());
}

#[test]
fn selected_documents_cannot_provision_the_anchor_or_supply_their_own_roots(){
    let f=Fixture::new();let anchor=f.imports.repository.policy.hash().unwrap();
    let standalone=core::canonical::bytes(&json!({"channel":"production","rootKeys":f.metadata["rootKeys"]})).unwrap();
    assert!(f.imports.repository.prepare_import(&[standalone],true).is_err());assert!(!f.root.join("fiscal").exists());
    let mut changed=f.metadata.clone();let(_,roots)=inventory();changed["rootKeys"]=serde_json::to_value(roots).unwrap();
    assert_eq!(f.imports.repository.prepare_import(&[f.trust_bytes(&changed)],true).err().unwrap().code,"ROOT_TRANSITION_REQUIRED");
    assert_eq!(f.imports.repository.policy.hash().unwrap(),anchor);
    let source=include_bytes!("../../../docs/evidence/5d3b2/fixtures/trust.json").to_vec();assert_eq!(f.imports.repository.prepare_import(&[source],true).err().unwrap().code,"TRUST_FORMAT_OR_CHANNEL_MISMATCH");
}

#[test]
fn package_requires_prior_trust_and_rejects_invalid_signatures_channels_and_profiles(){
    let f=Fixture::new();assert_eq!(f.imports.repository.prepare_import(&[f.package_bytes(&f.package)],false).err().unwrap().code,"TRUST_METADATA_REQUIRED");f.install_trust();
    let mut bad:Value=serde_json::from_slice(&f.package_bytes(&f.package)).unwrap();bad["signatures"][0]["value"]=json!(URL_SAFE_NO_PAD.encode([0;64]));
    assert_eq!(f.imports.repository.prepare_import(&[core::canonical::bytes(&bad).unwrap()],false).err().unwrap().code,"INVALID_SIGNATURE");
    let mut qa=f.package.clone();qa["channel"]=json!("qa");assert_eq!(f.imports.repository.prepare_import(&[f.package_bytes(&qa)],false).err().unwrap().code,"CHANNEL_MISMATCH");
    let mut incompatible=f.package.clone();incompatible["conventions"]["monthlyIncomeReferenceDays"]=json!("31");assert_eq!(f.imports.repository.prepare_import(&[f.package_bytes(&incompatible)],false).err().unwrap().code,"CONVENTION_CHANGE_REQUIRES_PROGRAM");
    let mut future=f.package.clone();future["manifest"]["exercise"]=json!(2027);assert_eq!(f.imports.repository.prepare_import(&[f.package_bytes(&future)],false).err().unwrap().code,"DELEGATION_SCOPE_MISMATCH");
    assert_eq!(f.generation(),1);assert_eq!(f.imports.repository.open_existing().unwrap().installations,0);
}

#[test]
fn authentic_delegations_cannot_enable_an_unimplemented_exercise_or_profile(){
    for exercise in [true,false]{
        let mut f=Fixture::new();
        if exercise{
            f.package["manifest"]["exercise"]=json!(2027);f.package["registry"]["exercise"]=json!(2027);
            f.package["manifest"]["contentIdentity"]["sha256"]=json!(core::hashes::canonical_hash(&f.package["registry"]).unwrap());
            for d in f.metadata["delegations"].as_array_mut().unwrap(){d["exercise"]=json!(2027);}f.metadata["floors"][0]["exercise"]=json!(2027);
        }else{
            f.package["manifest"]["requiredRuleProfileId"]=json!("r2b3-unimplemented-profile");
            for d in f.metadata["delegations"].as_array_mut().unwrap(){d["ruleProfileId"]=json!("r2b3-unimplemented-profile");}f.metadata["floors"][0]["ruleProfileId"]=json!("r2b3-unimplemented-profile");
        }
        f.install_trust();assert_eq!(f.imports.repository.prepare_import(&[f.package_bytes(&f.package)],false).err().unwrap().code,if exercise{"EXERCISE_NOT_AUTHORIZED"}else{"REQUIRES_APPLICATION_UPDATE"});assert_eq!(f.generation(),1);
    }
}

#[test]
fn package_and_admission_revalidate_expiry_at_confirmation(){
    let f=Fixture::new();f.install_trust();let(s,n,_)=f.preview(false,f.package_bytes(&f.package));*f.clock.lock().unwrap()="2026-12-01T00:00:00Z".into();
    let r=f.imports.confirm(&f.owner,&s,&n).unwrap();assert_eq!(r.phase,"rejected");assert_eq!(r.error.as_deref(),Some("TRUST_EXPIRED_OR_NOT_YET_VALID"));assert_eq!(f.generation(),1);
    let f=Fixture::new();f.install_trust();let iid=f.install();let(s,n,_,_)=f.activation_preview(ActivationIntent::Admit,Some(&iid),None);*f.clock.lock().unwrap()="2026-12-01T00:00:00Z".into();
    let r=f.activation.confirm(&f.owner,&s,&n).unwrap();assert_eq!(r.phase,"rejected");assert_eq!(r.error.as_deref(),Some("TRUST_EXPIRED_OR_NOT_YET_VALID"));assert_eq!(f.generation(),2);
}

#[test]
fn expired_nonce_foreign_owner_and_fabricated_admission_never_grant_authority(){
    let f=Fixture::new();let(s,n,_)=f.preview(true,f.trust_bytes(&f.metadata));let mut forged=f.owner.clone();forged.incarnation=id();
    assert_eq!(f.imports.confirm(&forged,&s,&n).err().unwrap().code,"SESSION_OWNER_MISMATCH");assert_eq!(f.imports.confirm(&f.owner,&s,&id()).err().unwrap().code,"PREVIEW_NONCE_MISMATCH");
    f.imports.age(&s,Duration::from_secs(600),Duration::ZERO);assert_eq!(f.imports.confirm(&f.owner,&s,&n).err().unwrap().code,"SESSION_EXPIRED");assert!(!f.root.join("fiscal").exists());
    let f=Fixture::new();f.install_trust();let iid=f.install();let(s,n,_,_)=f.activation_preview(ActivationIntent::Admit,Some(&iid),None);
    f.activation.age(&s,Duration::from_secs(300),Duration::ZERO);assert!(f.activation.confirm(&f.owner,&s,&n).is_err());assert_eq!(f.generation(),2);
    let p=f.activation.reserve(&f.owner).unwrap();let r=f.activation.prepare(&f.owner,&p.session_id,ActivationIntent::Select,Some(&iid),Some(&id()),None).unwrap();assert_eq!(r.phase,"rejected");assert_eq!(r.error.as_deref(),Some("ADMISSION_UNKNOWN"));
}

#[test]
fn generation_changes_require_new_import_review_and_new_nonce(){
    let f=Fixture::new();f.install_trust();let(s,n,_)=f.preview(false,f.package_bytes(&f.package));f.update(|_|{});
    let r=f.imports.confirm(&f.owner,&s,&n).unwrap();assert_eq!(r.phase,"stale");assert_eq!(r.error.as_deref(),Some("STALE_GENERATION"));
    let buffers=f.imports.refresh_data(&f.owner,&s).unwrap();f.imports.selected(&f.owner,&s,buffers).unwrap();let next=f.imports.get(&f.owner,&s).unwrap();assert_ne!(next.preview_nonce.as_deref(),Some(n.as_str()));
    assert_eq!(f.imports.confirm(&f.owner,&s,&n).err().unwrap().code,"PREVIEW_NONCE_MISMATCH");assert_eq!(f.imports.confirm(&f.owner,&s,next.preview_nonce.as_deref().unwrap()).unwrap().phase,"committed");assert_eq!(f.generation(),3);
}

#[test]
fn admission_generation_change_is_stale_and_revocation_blocks_selected_package(){
    let f=Fixture::new();f.install_trust();let iid=f.install();let(s,n,_,_)=f.activation_preview(ActivationIntent::Admit,Some(&iid),None);f.update(|_|{});
    let r=f.activation.confirm(&f.owner,&s,&n).unwrap();assert_eq!(r.phase,"stale");assert_eq!(r.error.as_deref(),Some("STALE_GENERATION"));assert_eq!(f.generation(),3);
    let f=Fixture::new();f.install_trust();let iid=f.install();let aid=f.admit(&iid);let(s,n,_,_)=f.activation_preview(ActivationIntent::Select,Some(&iid),Some(&aid));f.activation.confirm(&f.owner,&s,&n).unwrap();
    let prior=f.activation.selection().unwrap().selection;let key=core::hashes::key_id(&f.publisher.verifying_key().to_bytes());f.update(|s|{s["revokedKeyIds"]=json!([key]);s["delegations"].as_array_mut().unwrap().retain(|d|d["keyId"]!=key);});
    let current=f.activation.selection().unwrap();assert_eq!(current.selection,prior);let e=current.eligibility.unwrap();assert!(!e.eligible);assert_eq!(e.reason,Some("KEY_REVOKED"));
    assert_eq!(f.imports.repository.prepare_import(&[f.package_bytes(&f.package)],false).err().unwrap().code,"KEY_REVOKED");
}

#[test]
fn durable_revisions_reject_rollback_and_same_revision_conflicts(){
    let f=Fixture::new();f.install_trust();let mut newer=f.package.clone();newer["publication"]["revision"]=json!(2);let(s,n,_)=f.preview(false,f.package_bytes(&newer));f.imports.confirm(&f.owner,&s,&n).unwrap();
    assert_eq!(f.imports.repository.prepare_import(&[f.package_bytes(&f.package)],false).err().unwrap().code,"REVISION_ROLLBACK");
    newer["review"]["recordId"]=json!("r2b3-conflicting-review");assert_eq!(f.imports.repository.prepare_import(&[f.package_bytes(&newer)],false).err().unwrap().code,"REVISION_CONFLICT");assert_eq!(f.generation(),2);
}
