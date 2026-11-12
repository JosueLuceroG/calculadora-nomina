use serde::{Serialize,Deserialize};
use nomina_fiscal_package::wire::Capability;
#[derive(Debug,Clone,Serialize,Deserialize,PartialEq,Eq)]#[serde(deny_unknown_fields)]
pub struct Marker{pub version:u64,pub purpose:String,pub repository_id:String,pub channel:String,pub bootstrap_sha256:String}
#[derive(Debug,Clone,Serialize,Deserialize,PartialEq,Eq)]#[serde(tag="kind",deny_unknown_fields)]
pub enum Action{
    Trust{documents:Vec<String>},
    Install{envelope_sha256:String,operations:Vec<Capability>,installation_id:String,admission_id:String},
    Grant{document:String,target:String,previous_floor:u64},
    AdmitV1{installation_id:String,admission_id:String,operations:Vec<Capability>},
    SelectV1{installation_id:String,admission_id:String,selection_id:String,expected_selection_generation:u64,expected_selection_id:Option<String>},
    DeactivateV1{selection_id:String,expected_selection_generation:u64,expected_selection_id:Option<String>},
}
#[derive(Debug,Clone,Serialize,Deserialize,PartialEq,Eq)]#[serde(deny_unknown_fields)]
pub struct Receipt{pub operation_id:String,pub sequence:u64,pub generation:u64,pub installation_id:Option<String>,pub execution:String}
#[derive(Debug,Clone,Serialize)]
pub struct Status{pub repository_id:String,pub generation:u64,pub trust_epoch:u64,pub root_version:u64,pub validity:String,pub max_observed_utc:String,pub installations:u64,pub sqlite_version:String}
#[derive(Debug,Clone,Serialize,Deserialize)]#[serde(deny_unknown_fields)]
pub struct BackupManifest{pub version:u64,pub purpose:String,pub repository_id:String,pub generation:u64,pub head:String,pub file_sha256:String}
#[derive(Debug,Clone,Serialize,Deserialize)]#[serde(deny_unknown_fields)]
pub struct BackupManifestV2{pub version:u64,pub purpose:String,pub repository_id:String,pub generation:u64,pub head:String,pub file_sha256:String,pub schema_version:u64,pub logical_sha256:String}
