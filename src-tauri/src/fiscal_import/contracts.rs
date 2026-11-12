use super::*;
use serde::{Serialize,Deserialize};
#[derive(Debug,Clone,Serialize)]pub struct Error{pub code:String}
pub type Result<T> = std::result::Result<T,Error>;
#[derive(Debug,Clone,Copy,PartialEq,Eq,Serialize,Deserialize)]#[serde(rename_all="lowercase")]pub enum Kind{Package,Trust}
#[derive(Deserialize)]#[serde(deny_unknown_fields)]pub struct InfoRequest{#[serde(default)]pub repository:bool}
#[derive(Deserialize)]#[serde(deny_unknown_fields)]pub struct BeginRequest{pub kind:Kind}
#[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]pub struct SessionRequest{pub session_id:String}
#[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]pub struct ConfirmRequest{pub session_id:String,pub preview_nonce:String}
#[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]pub struct DetailsRequest{pub session_id:String,pub section:Section,pub offset:usize}
#[derive(Deserialize)]#[serde(rename_all="lowercase")]pub enum Section{Sources,Changes,Trust}
impl Section{pub fn name(&self)->&str{match self{Self::Sources=>"sources",Self::Changes=>"changes",Self::Trust=>"trust"}}}
#[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]pub struct ListRequest{pub limit:u64,#[serde(default)]pub after:String,#[serde(default)]pub generation:Option<u64>}
#[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]pub struct OperationRequest{pub operation_id:String}
#[derive(Debug,Clone,Serialize)]#[serde(rename_all="camelCase")]pub struct State{pub session_id:String,pub operation_id:String,pub phase:String,pub error:Option<String>,pub preview_nonce:Option<String>,pub summary:Option<PreviewSummary>,pub receipt:Option<Receipt>}
#[derive(Serialize)]#[serde(rename_all="camelCase")]pub struct Info{pub qa:bool,pub can_import:bool,pub message:String,pub repository:Option<crate::fiscal_repository::Status>}
#[derive(Serialize)]pub struct Details{pub items:Vec<Detail>,pub next:Option<usize>}
#[derive(Serialize)]pub struct Listing{pub generation:u64,pub items:Vec<InstallationMetadata>,pub next:Option<String>}
#[derive(Debug,Clone,PartialEq,Eq)]pub struct Owner{pub label:String,pub native_handle:usize,pub incarnation:String}
