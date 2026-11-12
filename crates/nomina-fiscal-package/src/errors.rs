use serde::Serialize;

#[derive(Debug,Clone,Copy,PartialEq,Eq,Serialize)]
#[serde(rename_all="snake_case")]
pub enum Stage { Processing, Structure, Canonical, Integrity, Trust, Authentication, Editorial, FiscalData, Compatibility, Revision }
#[derive(Debug,Clone,PartialEq,Eq,Serialize)]
pub struct Failure { pub stage:Stage, pub code:&'static str, pub passed:Vec<Stage> }
impl Failure {pub fn new(stage:Stage,code:&'static str)->Self{Self{stage,code,passed:vec![]}}}
impl std::fmt::Display for Failure {fn fmt(&self,f:&mut std::fmt::Formatter<'_>)->std::fmt::Result{write!(f,"{:?}: {}",self.stage,self.code)}}
impl std::error::Error for Failure{}
pub type Result<T>=std::result::Result<T,Failure>;
