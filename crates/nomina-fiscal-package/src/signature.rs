use crate::{canonical,errors::{Failure,Result,Stage},hashes,wire::*};
use base64::{Engine,engine::general_purpose::URL_SAFE_NO_PAD};
use ed25519_dalek::{Signature,VerifyingKey};
fn bad(code:&'static str)->Failure{Failure::new(Stage::Authentication,code)}
pub fn decode<const N:usize>(value:&str)->Result<[u8;N]>{let bytes=URL_SAFE_NO_PAD.decode(value).map_err(|_|bad("INVALID_BASE64URL"))?;if URL_SAFE_NO_PAD.encode(&bytes)!=value{return Err(bad("NON_CANONICAL_BASE64URL"));}bytes.try_into().map_err(|_|bad("INVALID_KEY_OR_SIGNATURE_LENGTH"))}
pub fn public_key(encoded:&str,expected_id:&str)->Result<VerifyingKey>{
    let bytes=decode::<32>(encoded)?;if hashes::key_id(&bytes)!=expected_id{return Err(bad("KEY_ID_MISMATCH"));}
    let key=VerifyingKey::from_bytes(&bytes).map_err(|_|bad("INVALID_PUBLIC_KEY"))?;
    if key.is_weak()||!key.to_edwards().is_torsion_free()||key.to_edwards().compress().to_bytes()!=bytes{return Err(bad("WEAK_OR_NON_CANONICAL_PUBLIC_KEY"));}Ok(key)
}
pub fn message(header:&Protected,signed:&serde_json::Value)->Result<Vec<u8>>{
    if header.protocol_version!=1||header.algorithm!="Ed25519"{return Err(bad("UNSUPPORTED_SIGNATURE_PROTOCOL"));}
    let mut message=format!("mx.calculadoranomina/fiscal/{}/ed25519-jcs/v1\0",header.purpose.name()).into_bytes();
    message.extend_from_slice(&canonical::bytes(&serde_json::json!({"protected":header,"signed":signed}))?);Ok(message)
}
pub fn verify(record:&SignatureRecord,signed:&serde_json::Value,key:&VerifyingKey)->Result<()>{let signature=Signature::from_bytes(&decode::<64>(&record.value)?);key.verify_strict(&message(&record.protected,signed)?,&signature).map_err(|_|bad("INVALID_SIGNATURE"))}
pub fn signature_order(records:&[SignatureRecord])->Result<()>{
    if records.is_empty(){return Err(bad("MISSING_SIGNATURE"));}if records.len()>crate::limits::MAX_SIGNATURES{return Err(bad("SIGNATURE_LIMIT"));}
    let mut previous=None;let mut keys=std::collections::BTreeSet::new();
    for record in records{let current=(record.protected.purpose,record.protected.key_id.as_str());if previous.map(|p|p>=current).unwrap_or(false)||!keys.insert(&record.protected.key_id){return Err(bad("DUPLICATE_OR_UNORDERED_SIGNATURE"));}previous=Some(current);}Ok(())
}
