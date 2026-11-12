use sha2::{Digest,Sha256};
use serde::Serialize;
use crate::{canonical,errors::Result};
pub fn sha256(bytes:&[u8])->String{format!("{:x}",Sha256::digest(bytes))}
pub fn canonical_hash<T:Serialize+?Sized>(value:&T)->Result<String>{Ok(sha256(&canonical::bytes(value)?))}
pub fn key_id(public:&[u8;32])->String{let mut message=b"mx.calculadoranomina:fiscal-key:v1\0".to_vec();message.extend_from_slice(public);format!("ed25519-sha256:{}",sha256(&message))}
