use super::*;
use serde::{Serialize,Deserialize};
#[derive(Debug,Clone,Serialize)]pub struct Error{pub code:String}
pub type Result<T>=std::result::Result<T,Error>;
#[derive(Debug,Clone,Copy,Deserialize)]#[serde(rename_all="lowercase")]pub enum PrepareKind{Admit,Select}
#[derive(Deserialize)]#[serde(deny_unknown_fields)]pub struct Empty{}
#[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]pub struct EligibilityRequest{pub installation_id:String,pub admission_id:Option<String>}
#[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]pub struct PrepareRequest{pub intent:PrepareKind,pub installation_id:String,pub admission_id:Option<String>,pub exception_grant_sha256:Option<String>}
#[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]pub struct SessionRequest{pub session_id:String}
#[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]pub struct ConfirmRequest{pub session_id:String,pub preview_nonce:String}
#[derive(Debug,Clone,Serialize)]#[serde(rename_all="camelCase")]
pub struct Summary{pub version:u64,pub intent:String,pub repository_id:String,pub repository_generation:u64,pub previous:SelectionIdentity,pub eligibility:Option<Eligibility>,pub admission_id:Option<String>,pub selection_id:Option<String>,pub execution:String}
#[derive(Debug,Clone,Serialize)]#[serde(rename_all="camelCase")]
pub struct State{pub session_id:String,pub operation_id:String,pub phase:String,pub error:Option<String>,pub preview_nonce:Option<String>,pub summary:Option<Summary>,pub receipt:Option<Receipt>}
