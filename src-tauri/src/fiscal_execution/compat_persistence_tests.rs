//! CD-4 real native issuance/storage. Artifacts are isolated from approved CD-3.
use super::*;
use crate::fiscal_repository::{Repository,Policy,Clock,ActivationIntent};
use crate::storage::{StorageService,PreferencePatch,StoreRoute};
use nomina_fiscal_package::{hashes,wire::Capability};
use serde_json::{Value,json};
use std::{fs,path::{Path,PathBuf},process::{Command,Stdio},io::{BufRead,Write}};
fn id()->String{uuid::Uuid::new_v4().to_string()}
fn root()->PathBuf{Path::new(env!("CARGO_MANIFEST_DIR")).join("..")}
fn rel(path:&Path)->String{path.strip_prefix(root()).unwrap().to_string_lossy().replace('\\',"/")}
fn evidence()->PathBuf{root().join("docs/evidence/snapshot-v3-compat/cd4")}
fn fixture(n:&str)->Vec<u8>{fs::read(root().join("docs/evidence/5d3b2/fixtures").join(n)).unwrap()}
fn record(name:&str,v:&Value){fs::write(evidence().join(format!("{name}.json")),serde_json::to_vec_pretty(v).unwrap()).unwrap();}
struct Qa{root:PathBuf,service:Arc<ExecutionService>,salary:Arc<StorageService>,owner:Owner,time:Arc<Mutex<String>>}
struct Doc{state:State,payload:String,sha:String,generation:String,run:PathBuf}
impl Qa{
 fn new(consent:bool)->Self{
  let dir=std::env::temp_dir().join("opencode").join(format!("nomina-cd4-{}",id()));
  let time=Arc::new(Mutex::new(Clock::system().now().unwrap()));
  let repo=Repository::new(dir.clone(),Policy::import_qa()).execution_test_clock(Clock{fixed:Some(time.clone())});
  repo.initialize_new().unwrap();repo.accept_trust_episode(&id(),0,&[fixture("trust.json")]).unwrap();
  let iid=repo.record_verified_installation(&id(),1,&fixture("package1.nomina-fiscal"),&[Capability::Direct,Capability::Inverse]).unwrap().installation_id.unwrap();
  let p=repo.prepare_activation(ActivationIntent::Admit,Some(&iid),None,None).unwrap();repo.confirm_activation(&id(),&p).unwrap();
  let p=repo.prepare_activation(ActivationIntent::Select,Some(&iid),p.admission_id.as_deref(),None).unwrap();repo.confirm_activation(&id(),&p).unwrap();
  let salary=Arc::new(StorageService::new(Ok(dir.clone())));salary.set_preferences(PreferencePatch{theme:None,history_auto_save:Some(consent)}).unwrap();
  let imports=Arc::new(ImportService::new(repo,true));let owner=imports.owner("main",940).unwrap();
  Self{root:dir,service:Arc::new(ExecutionService::with_storage(imports,salary.clone())),salary,owner,time}
 }
 fn consent(&self,on:bool){self.salary.set_preferences(PreferencePatch{theme:None,history_auto_save:Some(on)}).unwrap();}
 fn document(&self,label:&str,mode:&str,route:&str)->Doc{
  let selection=self.service.imports.repository.selection_status().unwrap().selection;
  let inverse=matches!(mode,"complete-inverse"|"limited-candidate"|"no-candidate"|"stress");
  let amount=if mode=="partial"{"9451.20"}else if inverse{"13202.64"}else{"15000.00"};
  let request=PrepareRequest{client_request_id:id(),request_id:1,expected_selection_id:selection.id.unwrap(),expected_selection_generation:selection.generation,
   capture:Capture{area:"general-zone".into(),form:Form{mode:if inverse{"net-to-gross"}else{"gross-to-net"}.into(),amount:amount.into(),period:"monthly".into(),effective_date:"2026-02-01".into(),bonus_days:if mode=="stress"{"365000000"}else{"15"}.into(),vacation_days:"12".into(),vacation_premium:"25".into(),include_imss:true}},
   scenario:json!({"kind":"contextual-retention-2026-v2","salaryBasis":"fixed-period","monthlyCondition":"unknown","referenceMonth":"2026-02"})};
  let state=self.service.prepare_bound(&self.owner,&request,route).unwrap();assert_eq!(state.phase,"ready");assert_eq!(state.version,2);
  let material=self.service.material(&self.owner,&ReferenceRequest{handle:Some(state.handle.clone()),client_request_id:None}).unwrap().to_string();
  let run=evidence().join("runs").join(format!("{label}-{}",state.execution_id));fs::create_dir_all(&run).unwrap();
  fs::write(run.join("input.json"),serde_json::to_vec_pretty(&json!({"state":state,"request":request,"materialWire":material,"mode":mode,"referenceMode":route})).unwrap()).unwrap();
  let output=Command::new("node").arg(evidence().join("engine-probe.mjs")).arg(run.join("input.json")).current_dir(root()).output().unwrap();
  fs::write(run.join("engine-stderr.log"),&output.stderr).unwrap();assert!(output.status.success(),"{}",String::from_utf8_lossy(&output.stderr));
  fs::write(run.join("engine-result.json"),&output.stdout).unwrap();let engine:Value=serde_json::from_slice(&output.stdout).unwrap();
  let state=self.service.complete(&self.owner,&CompleteRequest{handle:state.handle,result_wire:engine["resultWire"].as_str().unwrap().into()}).unwrap();assert_eq!(state.phase,"complete");
  let response=self.service.finalize(&self.owner,&FinalizeRequest{handle:state.handle.clone(),expected_result_sha256:state.result_sha256.clone().unwrap()}).unwrap();
  let finalized=serde_json::to_value(&response).unwrap();drop(response);assert_eq!(finalized["stored"],false);assert_eq!(finalized["mathematicalAttestation"],false);
  fs::write(run.join("finalization.json"),serde_json::to_vec_pretty(&finalized).unwrap()).unwrap();
  let payload=finalized["payload"].as_str().unwrap().to_owned();let sha=finalized["documentSha256"].as_str().unwrap().to_owned();
  let wire:Value=serde_json::from_str(&payload).unwrap();let result:Value=serde_json::from_str(engine["resultWire"].as_str().unwrap()).unwrap();assert_eq!(wire["value"]["outcome"],result["outcome"]);
  assert_eq!(hashes::sha256(payload.as_bytes()),sha);fs::write(run.join("finalized.json"),&payload).unwrap();
  Doc{state,payload,sha,generation:finalized["writeGeneration"].as_str().unwrap_or("").into(),run}
 }
 fn store(&self,d:&Doc,g:&str,route:StoreRoute)->Result<crate::storage::StoreOutcome>{self.service.store_document(&self.owner,&AuthorityReference{handle:d.state.handle.clone(),expected_document_sha256:d.sha.clone()},g,&d.payload,route)}
 fn update(&self){let r=&self.service.imports.repository;let g=r.open_existing().unwrap().generation;r.accept_trust_episode(&id(),g,&[fixture("trust-revoked.json")]).unwrap();}
 fn release(&self,d:&Doc){self.service.cancel(&self.owner,&ReferenceRequest{handle:Some(d.state.handle.clone()),client_request_id:None}).unwrap();}
}
impl Drop for Qa{fn drop(&mut self){let _=fs::remove_dir_all(&self.root);}}

#[test]
fn cd4_complete_results_restore_normal_native_manual_and_automatic_storage(){
 let q=Qa::new(true);let mut rows=vec![];
 for(label,mode,route)in [("direct-manual","normal",StoreRoute::Manual),("direct-automatic","normal",StoreRoute::Automatic),("inverse-complete","complete-inverse",StoreRoute::Automatic)]{
  let reference=if matches!(route,StoreRoute::Manual){"manual"}else{"automatic"};let d=q.document(label,mode,reference);assert!(!d.generation.is_empty());
  let saved=q.store(&d,&d.generation,route).unwrap();assert_eq!(saved.status,"COMMITTED");assert_eq!(saved.stored,Some(true));assert!(saved.inserted);
  assert_eq!(q.salary.get(&d.state.execution_id).unwrap().as_deref(),Some(d.payload.as_str()));let again=q.store(&d,&d.generation,route).unwrap();assert_eq!(again.stored,Some(true));assert!(!again.inserted);
  let wire:Value=serde_json::from_str(&d.payload).unwrap();if mode=="normal"{assert_eq!(wire["value"]["outcome"]["report"]["net"]["amount"],"13202.64");}
  fs::write(d.run.join("stored.json"),serde_json::to_vec_pretty(&saved).unwrap()).unwrap();
  let backup=if label=="direct-manual"{Some(q.salary.cd4_backup_recovery_probe(&d.state.execution_id,&d.payload))}else{None};
  rows.push(json!({"label":label,"run":rel(&d.run),"executionId":d.state.execution_id,"documentSha256":d.sha,"documentBytes":d.payload.len(),"route":reference,"status":saved.status,"stored":true,"duplicateInserted":again.inserted,"outcomeUnchanged":true,"backup":backup}));
 }
 assert_eq!(q.salary.list(100,None).unwrap().items.len(),3);record("positive-persistence",&json!({"cases":rows,"salaryRows":3,"freshNativeSessions":true,"newPublicJsonWriter":false}));
}

#[test]
fn cd4_incomplete_diagnostics_cannot_use_either_route_or_obtain_a_generation(){
 let q=Qa::new(true);let mut rows=vec![];
 for mode in ["partial","no-candidate","limited-candidate","stress"]{
  let d=q.document(mode,mode,"manual");assert!(d.generation.is_empty());let g=q.salary.begin_write().unwrap().generation;
  for route in [StoreRoute::Manual,StoreRoute::Automatic]{assert_eq!(q.store(&d,&g,route).unwrap_err().code,"DOCUMENT_MANUAL_FLOW_REQUIRED");}
  assert!(StorageService::validate_authorized_document(&d.payload).is_err());let wire:Value=serde_json::from_str(&d.payload).unwrap();
  if mode=="limited-candidate"{assert_eq!(wire["value"]["outcome"]["report"]["status"],"estimated");assert_eq!(wire["value"]["outcome"]["report"]["coverage"]["state"],"limited");}
  rows.push(json!({"label":mode,"run":rel(&d.run),"writeGeneration":null,"manual":"DOCUMENT_MANUAL_FLOW_REQUIRED","automatic":"DOCUMENT_MANUAL_FLOW_REQUIRED","status":wire["value"]["outcome"]["report"]["status"],"coverage":wire["value"]["outcome"]["report"]["coverage"]["state"]}));q.release(&d);
 }
 assert!(q.salary.list(100,None).unwrap().items.is_empty());record("diagnostics-closed",&json!({"cases":rows,"salaryRows":0,"explicitDiagnosticManualConsentImplemented":false}));
}

#[test]
fn cd4_initial_and_final_consent_generations_and_deletions_fence_native_authority(){
 let q=Qa::new(false);let mut rows=vec![];
 let late=q.document("late-consent","normal","manual");q.consent(true);
 for route in [StoreRoute::Manual,StoreRoute::Automatic]{assert_eq!(q.store(&late,&late.generation,route).unwrap_err().code,"INITIAL_CONSENT_REQUIRED");}
 rows.push(json!({"action":"late-opt-in","error":"INITIAL_CONSENT_REQUIRED"}));q.release(&late);
 for action in ["opt-out","opt-out-and-in","clear","delete"]{
  q.consent(true);let d=q.document(action,"normal","automatic");
  match action{"opt-out"=>q.consent(false),"opt-out-and-in"=>{q.consent(false);q.consent(true);},"clear"=>{q.salary.clear().unwrap();},_=>{q.salary.delete(&d.state.execution_id).unwrap();}}
  let expected=if action=="delete"{"DELETED_EXECUTION"}else{"STALE_GENERATION"};
  for route in [StoreRoute::Manual,StoreRoute::Automatic]{assert_eq!(q.store(&d,&d.generation,route).unwrap_err().code,expected);}
  let refreshed=q.salary.begin_write().unwrap().generation;
  if refreshed!=d.generation{assert_eq!(q.store(&d,&refreshed,StoreRoute::Manual).unwrap_err().code,"STALE_GENERATION");}
  rows.push(json!({"action":action,"error":expected,"freshGenerationCannotRescue":true}));q.release(&d);
 }
 assert!(q.salary.list(100,None).unwrap().items.is_empty());record("consent-negatives",&json!({"cases":rows,"salaryRows":0}));
}

#[test]
fn cd4_public_json_changed_bytes_unknown_and_foreign_sessions_are_not_permits(){
 let q=Qa::new(true);let d=q.document("authority","normal","manual");
 assert_eq!(q.salary.insert(&d.generation,&d.payload).unwrap_err().code,"V3_WRITE_CLOSED");assert_eq!(q.salary.insert_automatic(&d.generation,&d.payload).unwrap_err().code,"V3_WRITE_CLOSED");
 let mut owner=q.owner.clone();owner.incarnation=id();assert_eq!(q.service.store_document(&owner,&AuthorityReference{handle:d.state.handle.clone(),expected_document_sha256:d.sha.clone()},&d.generation,&d.payload,StoreRoute::Manual).unwrap_err().code,"SESSION_OWNER_MISMATCH");
 assert_eq!(q.service.store_document(&q.owner,&AuthorityReference{handle:id(),expected_document_sha256:d.sha.clone()},&d.generation,&d.payload,StoreRoute::Manual).unwrap_err().code,"SESSION_UNKNOWN");
 let mut forged:Value=serde_json::from_str(&d.payload).unwrap();forged["value"]["executionProvenance"]["authorizationObservation"]["nativeExecutionId"]=id().into();let changed=forged.to_string();
 for sha in [d.sha.clone(),hashes::sha256(changed.as_bytes())]{assert_eq!(q.service.store_document(&q.owner,&AuthorityReference{handle:d.state.handle.clone(),expected_document_sha256:sha},&d.generation,&changed,StoreRoute::Manual).unwrap_err().code,"DOCUMENT_CONFLICT");}
 assert!(q.salary.list(100,None).unwrap().items.is_empty());q.store(&d,&d.generation,StoreRoute::Manual).unwrap();
 assert_eq!(q.salary.reconcile_v3(&d.state.execution_id,&"0".repeat(64)).unwrap_err().code,"DUPLICATE_CONFLICT");assert_eq!(q.salary.get(&d.state.execution_id).unwrap().as_deref(),Some(d.payload.as_str()));
 record("authority-negatives",&json!({"publicJsonManual":"V3_WRITE_CLOSED","publicJsonAutomatic":"V3_WRITE_CLOSED","unknownHandle":"SESSION_UNKNOWN","foreignOwner":"SESSION_OWNER_MISMATCH","forgedObservation":"DOCUMENT_CONFLICT","differentBytesAndRehashedBytes":"DOCUMENT_CONFLICT","differentReconcileChecksum":"DUPLICATE_CONFLICT","originalPreserved":true}));
}

#[test]
fn cd4_revocation_cancellation_expiration_and_postcommit_history_have_original_semantics(){
 let mut rows=vec![];
 for action in ["cancel","ttl","revoke","trust-expiry","revoke-after-commit"]{
  let q=Qa::new(true);let d=q.document(action,"normal","automatic");let committed=action=="revoke-after-commit";
  if committed{q.store(&d,&d.generation,StoreRoute::Automatic).unwrap();}
  match action{"cancel"=>q.release(&d),"ttl"=>q.service.age(&d.state.handle,Duration::from_secs(600),Duration::ZERO),"trust-expiry"=>*q.time.lock().unwrap()="2027-01-01T00:00:00Z".into(),_=>q.update()}
  let observed=if committed{let r=q.salary.reconcile_v3(&d.state.execution_id,&d.sha).unwrap();assert_eq!(r.stored,Some(true));assert_eq!(q.salary.get(&d.state.execution_id).unwrap().as_deref(),Some(d.payload.as_str()));r.status}else{let error=q.store(&d,&d.generation,StoreRoute::Automatic).unwrap_err().code;assert!(q.salary.list(100,None).unwrap().items.is_empty());error};
  rows.push(json!({"action":action,"observed":observed,"salaryRows":if committed{1}else{0},"originalRewritten":false}));
 }
 record("liveness-revocation",&json!(rows));
}

#[test]
fn cd4_delivery_failure_rollback_pending_verification_restart_and_tombstone_reconcile(){
 let q=Qa::new(true);let before=q.document("rollback","normal","manual");
 StorageService::v3_test_fault(Some("salary-before-commit"));assert!(q.store(&before,&before.generation,StoreRoute::Manual).is_err());StorageService::v3_test_fault(None);
 assert!(q.salary.get(&before.state.execution_id).unwrap().is_none());assert_eq!(q.store(&before,&before.generation,StoreRoute::Manual).unwrap().stored,Some(true));
 let pending=q.document("verification-pending","normal","automatic");StorageService::v3_test_fault(Some("salary-before-verification"));let uncertain=q.store(&pending,&pending.generation,StoreRoute::Automatic).unwrap();StorageService::v3_test_fault(None);assert_eq!(uncertain.status,"COMMITTED_VERIFICATION_PENDING");assert_eq!(uncertain.stored,None);
 assert_eq!(q.store(&pending,&pending.generation,StoreRoute::Automatic).unwrap().stored,Some(true));
 let lost=q.document("lost-delivery","normal","automatic");let delivered=q.store(&lost,&lost.generation,StoreRoute::Automatic).unwrap();assert_eq!(delivered.stored,Some(true));drop(delivered);
 let reopened=Arc::new(StorageService::new(Ok(q.root.clone())));assert_eq!(reopened.reconcile_v3(&lost.state.execution_id,&lost.sha).unwrap().stored,Some(true));assert_eq!(reopened.list(100,None).unwrap().items.len(),3);
 let restarted=ExecutionService::with_storage(q.service.imports.clone(),reopened.clone());assert_eq!(restarted.store_document(&q.owner,&AuthorityReference{handle:lost.state.handle.clone(),expected_document_sha256:lost.sha.clone()},&lost.generation,&lost.payload,StoreRoute::Automatic).unwrap_err().code,"SESSION_UNKNOWN");
 assert_eq!(reopened.reconcile_v3(&id(),&lost.sha).unwrap().stored,Some(false));reopened.delete(&lost.state.execution_id).unwrap();assert_eq!(reopened.reconcile_v3(&lost.state.execution_id,&lost.sha).unwrap().reason.as_deref(),Some("DELETED_EXECUTION"));assert_eq!(q.store(&lost,&lost.generation,StoreRoute::Automatic).unwrap_err().code,"DELETED_EXECUTION");
 record("delivery-restart",&json!({"beforeCommitRollback":true,"retryAfterRollbackCommitted":true,"verificationPending":uncertain.status,"reconciledWithoutSecondInsert":true,"discardedRealSuccessReply":true,"restartReconcilesOriginal":true,"restartDoesNotResurrectSession":"SESSION_UNKNOWN","unknownExecutionStored":false,"deletedExecution":"DELETED_EXECUTION","salaryRowsAfterDelete":2}));
}

struct Process(std::process::Child);
impl Drop for Process{fn drop(&mut self){let _=self.0.kill();let _=self.0.wait();}}
#[test]#[ignore="CD-4 subprocess helper, invoked explicitly by parent"]
fn cd4_process_child(){
 let q=Qa::new(true);let d=q.document("process-child","normal","automatic");
 println!("CD4_CONTEXT:{}",json!({"root":q.root,"executionId":d.state.execution_id,"sha256":d.sha}));std::io::stdout().flush().unwrap();
 if std::env::var_os("NOMINA_CD4_ORDERING").is_some(){unsafe{std::env::set_var("NOMINA_4D_RELEASE_FILE",q.root.join("release-writer"));}}
 q.store(&d,&d.generation,StoreRoute::Automatic).unwrap();println!("CD4_COMMITTED");std::io::stdout().flush().unwrap();loop{std::thread::park();}
}
#[test]#[ignore="CD-4 signed revocation subprocess helper"]
fn cd4_revocation_child(){
 let path=PathBuf::from(std::env::var_os("NOMINA_CD4_REVOCATION_ROOT").unwrap());assert!(path.starts_with(std::env::temp_dir().join("opencode")));
 println!("CD4_REVOCATION_STARTED");std::io::stdout().flush().unwrap();let repo=Repository::new(path,Policy::import_qa());let g=repo.open_existing().unwrap().generation;repo.accept_trust_episode(&id(),g,&[fixture("trust-revoked.json")]).unwrap();
}
fn writer(point:&str,ordering:bool)->(Process,std::io::Lines<std::io::BufReader<std::process::ChildStdout>>,Value){
 let mut cmd=Command::new(std::env::current_exe().unwrap());cmd.args(["--exact","fiscal_execution::service::compat_persistence_tests::cd4_process_child","--ignored","--nocapture"]).env("NOMINA_4D_STOP",point).stdout(Stdio::piped());if ordering{cmd.env("NOMINA_CD4_ORDERING","1");}
 let mut process=Process(cmd.spawn().unwrap());let mut lines=std::io::BufReader::new(process.0.stdout.take().unwrap()).lines();let mut info=None;let mut ready=false;
 for line in lines.by_ref(){let line=line.unwrap();if let Some(s)=line.strip_prefix("CD4_CONTEXT:"){info=Some(serde_json::from_str::<Value>(s).unwrap());}if line.contains(&format!("SALARY_4D_READY:{point}")){ready=true;break;}}
 assert!(ready);(process,lines,info.unwrap())
}
#[test]
fn cd4_process_death_before_commit_after_commit_and_before_response_is_atomic(){
 let mut rows=vec![];
 for point in ["salary-before-commit","salary-after-commit","salary-before-response"]{
  let(process,_,info)=writer(point,false);drop(process);let path=PathBuf::from(info["root"].as_str().unwrap());let salary=StorageService::new(Ok(path.clone()));let expected=point!="salary-before-commit";
  let r=salary.reconcile_v3(info["executionId"].as_str().unwrap(),info["sha256"].as_str().unwrap()).unwrap();assert_eq!(r.stored,Some(expected));assert_eq!(salary.list(100,None).unwrap().items.len(),if expected{1}else{0});
  if expected{assert_eq!(hashes::sha256(salary.get(info["executionId"].as_str().unwrap()).unwrap().unwrap().as_bytes()),info["sha256"]);}
  rows.push(json!({"point":point,"externallyKilled":true,"stored":r.stored,"status":r.status,"sha256":info["sha256"]}));fs::remove_dir_all(path).unwrap();
 }record("process-crashes",&json!(rows));
}
#[test]
fn cd4_separate_process_revocation_excludes_the_guarded_salary_commit(){
 let(writer,lines,info)=writer("salary-before-commit",true);let path=PathBuf::from(info["root"].as_str().unwrap());
 let mut revoke=Process(Command::new(std::env::current_exe().unwrap()).args(["--exact","fiscal_execution::service::compat_persistence_tests::cd4_revocation_child","--ignored","--nocapture"]).env("NOMINA_CD4_REVOCATION_ROOT",&path).stdout(Stdio::piped()).spawn().unwrap());
 let mut revoke_lines=std::io::BufReader::new(revoke.0.stdout.take().unwrap()).lines();let mut started=false;for line in revoke_lines.by_ref(){if line.unwrap().contains("CD4_REVOCATION_STARTED"){started=true;break;}}assert!(started);
 std::thread::sleep(Duration::from_millis(200));assert!(revoke.0.try_wait().unwrap().is_none());
 let c=rusqlite::Connection::open_with_flags(path.join("payroll.sqlite3"),rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();assert_eq!(c.query_row("SELECT count(*) FROM simulations",[],|r|r.get::<_,i64>(0)).unwrap(),0);drop(c);
 fs::write(path.join("release-writer"),b"release").unwrap();let mut committed=false;for line in lines{if line.unwrap().contains("CD4_COMMITTED"){committed=true;break;}}assert!(committed);assert!(revoke.0.wait().unwrap().success());drop(writer);
 let salary=StorageService::new(Ok(path.clone()));assert_eq!(salary.reconcile_v3(info["executionId"].as_str().unwrap(),info["sha256"].as_str().unwrap()).unwrap().stored,Some(true));
 let repo=Repository::new(path.clone(),Policy::import_qa());let selected=repo.selection_status().unwrap().selection;assert_eq!(repo.prepare_execution(&selected,"2026-02-01","monthly","gross-to-net").err().unwrap().code,"KEY_REVOKED");
 record("concurrent-revocation",&json!({"actualSeparateProcesses":true,"revocationWaitedForFiscalGuard":true,"uncommittedSalaryInvisible":true,"writerCommittedFirst":true,"newExecutionAfterRevocation":"KEY_REVOKED","originalPreserved":true,"timeoutsChanged":false}));fs::remove_dir_all(path).unwrap();
}
