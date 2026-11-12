use super::*;
use serde::{Serialize,Deserialize};
#[derive(Debug,Clone,Serialize)]pub struct Error{pub code:String}
pub type Result<T>=std::result::Result<T,Error>;
pub const MATERIAL_MAX:usize=3_145_728;
pub const RESULT_MAX:usize=3_145_728;
pub const RETAINED_MAX:usize=32*1024*1024;
// Preparation reserves worst-case material plus both an incoming result wire
// and its immutable RAM copy. Once material is known, unused material budget
// is released. Four is a session ceiling, not four unlimited maximum objects.
pub const RESERVATION:usize=MATERIAL_MAX+2*RESULT_MAX+65_536;
#[derive(Debug,Clone,Serialize,Deserialize,PartialEq,Eq)]#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Form{pub mode:String,pub amount:String,pub period:String,pub effective_date:String,pub bonus_days:String,pub vacation_days:String,pub vacation_premium:String,pub include_imss:bool}
#[derive(Debug,Clone,Serialize,Deserialize,PartialEq,Eq)]#[serde(deny_unknown_fields)]pub struct Capture{pub form:Form,pub area:String}
#[derive(Debug,Clone,Serialize,Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct PrepareRequest{pub client_request_id:String,pub request_id:u64,pub expected_selection_id:String,pub expected_selection_generation:u64,pub capture:Capture,pub scenario:serde_json::Value}
#[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]pub struct ReferenceRequest{pub handle:Option<String>,pub client_request_id:Option<String>}
#[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]pub struct CompleteRequest{pub handle:String,pub result_wire:String}
#[derive(Debug,Clone,Serialize)]#[serde(rename_all="camelCase")]
pub struct State{pub version:u64,pub handle:String,pub execution_id:String,pub client_request_id:String,pub request_id:u64,pub phase:String,pub reason:Option<String>,pub context_sha256:Option<String>,pub material_sha256:Option<String>,pub result_sha256:Option<String>,pub result_bytes:usize,pub material_bytes:usize,pub persistence_allowed:bool,pub mathematical_attestation:bool}
#[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]pub struct FinalizeRequest{pub handle:String,pub expected_result_sha256:String}
#[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]pub struct ReconcileRequest{pub execution_id:String,pub expected_document_sha256:String}
pub fn uuid(s:&str)->Result<()>{if uuid::Uuid::parse_str(s).map(|u|u.get_version_num()==4&&u.to_string()==s).unwrap_or(false){Ok(())}else{Err(fail("INVALID_ID"))}}
pub fn reference(r:&ReferenceRequest)->Result<()>{match(&r.handle,&r.client_request_id){(Some(h),None)|(None,Some(h))=>uuid(h),_=>Err(fail("INVALID_REFERENCE"))}}
fn decimal(s:&str,fraction:usize,positive:bool)->bool{if s.is_empty()||s.len()>128{return false;}let p=s.split('.').collect::<Vec<_>>();p.len()<=2&&!p[0].is_empty()&&p[0].len()<=20&&p[0].bytes().all(|b|b.is_ascii_digit())&&(p.len()==1||!p[1].is_empty()&&p[1].len()<=fraction&&p[1].bytes().all(|b|b.is_ascii_digit()))&&(!positive||s.bytes().any(|b|(b'1'..=b'9').contains(&b)))}
pub fn validate(r:&PrepareRequest)->Result<()>{uuid(&r.client_request_id)?;uuid(&r.expected_selection_id)?;if r.request_id==0||r.request_id>9_007_199_254_740_991||r.expected_selection_generation>9_007_199_254_740_991{return Err(fail("INVALID_REQUEST"));}let f=&r.capture.form;if r.capture.area!="general-zone"||!["gross-to-net","net-to-gross"].contains(&f.mode.as_str())||!["weekly","fortnightly","monthly"].contains(&f.period.as_str())||!nomina_fiscal_package::time::civil(&f.effective_date)||!f.effective_date.starts_with("2026-")||!decimal(&f.amount,2,true)||[&f.bonus_days,&f.vacation_days,&f.vacation_premium].iter().any(|s|!decimal(s,64,false)){return Err(fail("INVALID_CAPTURE"));}
    let s=r.scenario.as_object().ok_or_else(||fail("INVALID_SCENARIO"))?;let required=["kind","salaryBasis","monthlyCondition","referenceMonth"];let allowed=["kind","salaryBasis","monthlyCondition","referenceMonth","noOtherSalaryPayments","acknowledgement","actualDays"];
    if required.iter().any(|k|!s.contains_key(*k))||s.keys().any(|k|!allowed.contains(&k.as_str()))||s["kind"]!="contextual-retention-2026-v2"||!s["salaryBasis"].as_str().map(|v|["fixed-period","agreed-daily-reference","actual-calendar"].contains(&v)).unwrap_or(false)||!s["monthlyCondition"].as_str().map(|v|["unknown","minimum-only-assumed","outside-profile"].contains(&v)).unwrap_or(false)||s["referenceMonth"]!=f.effective_date[..7]||s.get("noOtherSalaryPayments").map(|v|!v.is_boolean()).unwrap_or(false)||s.get("acknowledgement").map(|v|v!="explicit-standard-simulation-assumption-not-payroll-verification").unwrap_or(false)||s.get("actualDays").map(|v|s["salaryBasis"]!="actual-calendar"||!v.as_u64().map(|n|[28,30,31].contains(&n)).unwrap_or(false)).unwrap_or(false){return Err(fail("INVALID_SCENARIO"));}Ok(())
}
