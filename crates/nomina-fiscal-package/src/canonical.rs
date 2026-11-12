use crate::errors::{Failure,Result,Stage};
use serde::Serialize;
pub fn bytes<T:Serialize+?Sized>(value:&T)->Result<Vec<u8>>{serde_jcs::to_vec(value).map_err(|_|Failure::new(Stage::Canonical,"CANONICALIZATION_FAILED"))}
pub fn require_wire(input:&[u8],value:&serde_json::Value)->Result<()>{if bytes(value)?!=input{return Err(Failure::new(Stage::Canonical,"NON_CANONICAL_WIRE"));}Ok(())}
