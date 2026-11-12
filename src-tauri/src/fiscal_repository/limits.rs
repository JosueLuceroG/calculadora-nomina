use super::errors::*;
pub const OBJECT_BYTES:u64=2_097_152;
pub const TRUST_BYTES:u64=262_144;
pub const BLOB_BYTES:u64=536_870_912;
pub const INSTALLATIONS:u64=1024;
pub const PUBLICATIONS:u64=4096;
pub const OPERATIONS:u64=50_000;
pub const EPISODES:u64=4096;
pub const GRANTS:u64=256;
pub const MANIFEST:u64=8192;
pub const PAGE:u64=100;
pub const SAFE:u64=9_007_199_254_740_991;
pub fn budget(current:u64,additional:u64,max:u64)->Result<()>{if current.checked_add(additional).filter(|v|*v<=max).is_none(){Err(fail("CAPACITY_EXCEEDED"))}else{Ok(())}}
pub fn size(bytes:&[u8],max:u64)->Result<()>{if bytes.is_empty()||bytes.len() as u64>max{Err(fail("INPUT_LIMIT"))}else{Ok(())}}
pub fn page(n:u64)->Result<()>{if n==0||n>PAGE{Err(fail("PAGE_LIMIT"))}else{Ok(())}}
