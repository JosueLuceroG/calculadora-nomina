//! CD-2 tests live here; never expose a DocumentPermit constructor.
use super::*;
fn evidence()->PathBuf{Path::new(env!("CARGO_MANIFEST_DIR")).join("../docs/evidence/snapshot-v3-compat/cd2")}
fn corpus()->Vec<Value>{serde_json::from_slice(&fs::read(evidence().join("cases.json")).unwrap()).unwrap()}
#[test]
fn cd2_read_parity_and_historical_regression(){
 let ts:Value=serde_json::from_slice(&fs::read(evidence().join("ts-results.json")).unwrap()).unwrap();let mut rows=vec![];
 for case in corpus(){let name=case["name"].as_str().unwrap();let expected=case["accepted"].as_bool().unwrap();let actual=validation::validate_snapshot_for_read(case["payload"].as_str().unwrap());let observed=actual.is_ok();let classification=actual.as_ref().ok().map(|x|x.classification.clone());let t=ts["results"].as_array().unwrap().iter().find(|x|x["name"]==name).unwrap();
  rows.push(serde_json::json!({"name":name,"expectedAccepted":expected,"tsAccepted":t["accepted"],"rustAccepted":observed,"classification":classification,"error":actual.as_ref().err().map(|x|x.code.clone())}));
 }
 if evidence().join("ts-rust-parity.json").exists(){let attempts=evidence().join("attempts");fs::create_dir_all(&attempts).unwrap();fs::copy(evidence().join("ts-rust-parity.json"),attempts.join(format!("rust-{}.json",Uuid::new_v4()))).unwrap();}
 fs::write(evidence().join("ts-rust-parity.json"),serde_json::to_vec_pretty(&rows).unwrap()).unwrap();
 for row in &rows{assert_eq!(row["rustAccepted"],row["expectedAccepted"],"{} {:?}",row["name"],row["error"]);assert_eq!(row["rustAccepted"],row["tsAccepted"],"{}",row["name"]);}
 let mut historical=vec![];
 for case in corpus(){if let Some(expected)=case["classification"].as_str(){assert_eq!(validation::validate_snapshot_for_read(case["payload"].as_str().unwrap()).unwrap().classification,expected,"{}",case["name"]);}
  if case["historical"]==true{let payload=case["payload"].as_str().unwrap();let old=validate_snapshot(payload,false);let reader=validation::validate_snapshot_for_read(payload);assert_eq!(old.is_ok(),reader.is_ok(),"historical acceptance {}",case["name"]);if let(Ok(a),Ok(b))=(&old,&reader){assert_eq!(a.classification,b.classification);assert_eq!(a.gross,b.gross);assert_eq!(a.net,b.net);assert_eq!(a.snapshot_version,b.snapshot_version);}historical.push(serde_json::json!({"name":case["name"],"baselineValidatorAccepted":old.is_ok(),"readerAccepted":reader.is_ok(),"classification":reader.as_ref().ok().map(|x|x.classification.clone()),"originalPayloadSha256":validation::digest(payload.as_bytes())}));}}
 fs::write(evidence().join("historical-regression.json"),serde_json::to_vec_pretty(&historical).unwrap()).unwrap();
}
#[test]
fn cd2_resource_scanner_boundaries_are_unchanged(){
 assert_eq!(budget_v3::MAX_DEPTH,96);assert_eq!(budget_v3::MAX_NODES,1_572_864);assert_eq!(validation::MAX_PAYLOAD,3_145_728);
 for(n,accepted)in [(94,true),(95,false)]{let s=format!("{{\"value\":{{\"schemaVersion\":3,\"v\":{}0{}}}}}","[".repeat(n),"]".repeat(n));assert_eq!(budget_v3::scan(&s).is_ok(),accepted);}
 let cases=corpus();for(name,size)in [("size-exact-N",3_145_728),("size-N-plus1",3_145_729)]{let c=cases.iter().find(|x|x["name"]==name).unwrap();assert_eq!(c["payload"].as_str().unwrap().len(),size);assert_eq!(validation::validate_snapshot_for_read(c["payload"].as_str().unwrap()).is_ok(),size==3_145_728);}
}
#[test]
fn cd2_valid_read_has_no_finalization_or_write_capability(){
 let selected=corpus().into_iter().filter(|c|c["accepted"]==true&&serde_json::from_str::<Value>(c["payload"].as_str().unwrap()).map(|w|w["value"]["executionProvenance"]["producerId"]=="nomina-signed-fiscal-document-v3-v2").unwrap_or(false)).collect::<Vec<_>>();let root=std::env::temp_dir().join("opencode").join(format!("nomina-cd2-{}",Uuid::new_v4()));let svc=StorageService::new(Ok(root.clone()));svc.info().unwrap();svc.set_preferences(PreferencePatch{theme:None,history_auto_save:Some(true)}).unwrap();let generation=svc.begin_write().unwrap().generation;
 let mut checks=vec![];
 for c in &selected{let payload=c["payload"].as_str().unwrap();assert!(validation::validate_snapshot_for_read(payload).is_ok());assert!(validate_snapshot(payload,false).is_err());assert!(StorageService::validate_finalized_document(payload).is_err());
  for automatic in [false,true]{let r=if automatic{svc.insert_automatic(&generation,payload)}else{svc.insert(&generation,payload)};assert_eq!(r.unwrap_err().code,"V3_WRITE_CLOSED");}
  // Deliberately forged serialized observation. No native session or permit is
  // created. Native writer must reject even this syntactically complete claim.
  let mut wire:Value=serde_json::from_str(payload).unwrap();let s=&mut wire["value"];s["documentKind"]="execution-record".into();let id=s["executionId"].clone();let a=&mut s["executionProvenance"]["authorizationObservation"];a["kind"]="native-observation-v1".into();a["nativeExecutionId"]=id;for k in ["installationId","admissionId","selectionId"]{a[k]=Uuid::new_v4().to_string().into();}a["selectionGeneration"]=0.into();a["authorizedOperations"]=if a["operation"]=="net-to-gross"{serde_json::json!(["direct","inverse"])}else{serde_json::json!(["direct"])};
  let forged=wire.to_string();assert!(StorageService::validate_finalized_document(&forged).is_err());assert!(svc.insert(&generation,&forged).is_err());assert!(svc.insert_automatic(&generation,&forged).is_err());
  checks.push(serde_json::json!({"name":c["name"],"readAccepted":true,"legacyAuthorityValidatorRejected":true,"finalizeGateRejected":true,"manualRejected":true,"automaticRejected":true,"forgedObservationRejectedForWrite":true}));
 }
 assert!(svc.list(100,None).unwrap().items.is_empty());fs::write(evidence().join("read-write-separation.json"),serde_json::to_vec_pretty(&serde_json::json!({"checks":checks,"persistedHistoryAutoSave":true,"currentGenerationValid":true,"nativeInitialEligibilityIssued":false,"salaryRows":0,"privatePermitConstructed":false,"nativeSessionFabricated":false,"backupAndReconcile":"retain legacy gate; new producer unsupported until later authorization"})).unwrap()).unwrap();fs::remove_dir_all(root).unwrap();
}
#[test]
fn cd2_sql_seed_is_only_a_reader_fixture_not_a_productive_write(){
 let c=corpus().into_iter().find(|x|x["name"]=="D-W2-compat-unchanged").unwrap();let payload=c["payload"].as_str().unwrap();let index=validation::validate_snapshot_for_read(payload).unwrap();let wire:Value=serde_json::from_str(payload).unwrap();let p=&wire["value"]["fiscalPackage"];let root=std::env::temp_dir().join("opencode").join(format!("nomina-cd2-read-{}",Uuid::new_v4()));let svc=StorageService::new(Ok(root.clone()));svc.info().unwrap();
 // Test-only fixture seeding, never evidence of native authorized persistence.
 let conn=Connection::open(root.join("payroll.sqlite3")).unwrap();conn.execute("INSERT INTO fiscal_packages VALUES(?1,?2,?3,?4)",params![index.package_sha,p["id"].as_str(),p["version"].as_str(),p.to_string()]).unwrap();conn.execute("INSERT INTO simulations VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",params![index.execution_id,index.completed_at,index.direction,index.requested_amount,index.periodicity,index.reference_date,index.classification,index.gross,index.net,index.package_sha,index.snapshot_version,payload,validation::digest(payload.as_bytes())]).unwrap();drop(conn);
 assert_eq!(svc.get(&index.execution_id).unwrap().as_deref(),Some(payload));let items=svc.list(100,None).unwrap().items;assert_eq!(items[0].classification,"not-determinable");assert_eq!(items[0].gross.as_deref(),Some("14644.64"));assert_eq!(items[0].net.as_deref(),Some("10906.22"));assert!(svc.reconcile_v3(&index.execution_id,&validation::digest(payload.as_bytes())).is_err());
 let conn=Connection::open(root.join("payroll.sqlite3")).unwrap();assert!(backup::check_records(&conn).is_err());drop(conn);fs::remove_dir_all(root).unwrap();
}
