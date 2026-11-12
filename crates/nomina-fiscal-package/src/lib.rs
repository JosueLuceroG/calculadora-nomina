//! Bounded, native-only candidate verification. No filesystem, network, Tauri,
//! SQL, activation, private signing or implicit clock is provided by this crate.
pub mod canonical;
pub mod errors;
pub mod hashes;
pub mod limits;
pub mod signature;
pub mod strict_json;
pub mod time;
pub mod wire;
pub mod compatibility;
pub mod revisions;
pub mod trust;
pub mod validation_2026;
pub mod verify;
pub use verify::{verify_candidate,VerifiedCandidate,VerificationReport};

pub fn decode_closed<T:serde::de::DeserializeOwned+serde::Serialize>(value:&serde_json::Value)->errors::Result<T>{
    let typed:T=serde_json::from_value(value.clone()).map_err(|_|errors::Failure::new(errors::Stage::Structure,"UNKNOWN_FIELD_OR_INVALID_SCHEMA"))?;
    if canonical::bytes(&typed)?!=canonical::bytes(value)?{return Err(errors::Failure::new(errors::Stage::Structure,"OMITTED_OR_NULL_FIELD_NOT_ALLOWED"));}Ok(typed)
}

/// Primitive public-vector helper, not an authentication or admission result.
pub fn verify_raw_vector(key:&ed25519_dalek::VerifyingKey,message:&[u8],encoded_signature:&str)->errors::Result<bool>{
    let signature=ed25519_dalek::Signature::from_bytes(&signature::decode::<64>(encoded_signature)?);Ok(key.verify_strict(message,&signature).is_ok())
}
