//! Editorial inputs only. Never provisions the Tauri application's anchor.
use super::*;
use serde::Serialize;
fn bad(code: &'static str) -> Failure { Failure::new(Stage::Processing, code) }
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PublicBootstrap { channel: Channel, root_keys: Vec<RootKey> }
pub fn bootstrap(bytes: &[u8]) -> Result<TrustedState> {
    let raw = n::strict_json::parse_with_limit(bytes, 16384)?;
    n::canonical::require_wire(bytes, &raw)?;
    let b: PublicBootstrap = n::decode_closed(&raw)?;
    TrustedState::production_bootstrap(b.channel, &b.root_keys)
}
fn validate_signed(s: &Value) -> Result<()> {
    if s["channel"] != "production" { return Err(bad("EDITORIAL_PRODUCTION_CHANNEL_REQUIRED")); }
    match s["format"].as_str() {
        Some("mx.nomina.fiscal-package") => {
            let p: SignedPackage = n::decode_closed(s)?;
            n::verify::validate_structure(&p, None)?;
            n::compatibility::CompiledPolicy::current_2026().guard(&p)?;
            n::validation_2026::validate(&p)?;
            if p.manifest.content_identity.scheme != "legacy-registry-v1" || n::hashes::canonical_hash(&s["registry"])? != p.manifest.content_identity.sha256 {
                return Err(bad("CONTENT_HASH_MISMATCH"));
            }
        },
        Some("mx.nomina.fiscal-trust") => {
            let t: SignedTrust = n::decode_closed(s)?;
            if t.format_version != 1 || t.canonicalization != "RFC8785" || t.threshold != 2 || t.root_version == 0 || t.epoch == 0 {
                return Err(bad("INVALID_EDITORIAL_TRUST_HEADER"));
            }
            TrustedState::production_bootstrap(t.channel, &t.root_keys)?;
            // Full validity, delegations, chain and quorum are checked only after assembly.
        },
        _ => return Err(bad("UNSUPPORTED_EDITORIAL_DOCUMENT")),
    }
    Ok(())
}
pub fn prepare(bytes: &[u8]) -> Result<Vec<u8>> {
    let signed = n::strict_json::parse(bytes)?;
    validate_signed(&signed)?;
    let output = n::canonical::bytes(&json!({"signed":signed,"signatures":[]}))?;
    let max = if signed["format"] == "mx.nomina.fiscal-trust" { n::limits::MAX_TRUST_BYTES } else { n::limits::MAX_BYTES };
    if output.len() > max { return Err(bad("FILE_LIMIT")); }
    Ok(output)
}
pub fn signing_message(bytes: &[u8], purpose: &str, id: &str) -> Result<Vec<u8>> {
    let raw = n::strict_json::parse(bytes)?;
    if raw["signed"]["format"] == "mx.nomina.fiscal-trust" && bytes.len() > n::limits::MAX_TRUST_BYTES { return Err(bad("FILE_LIMIT")); }
    n::canonical::require_wire(bytes, &raw)?;
    validate_signed(&raw["signed"])?;
    match raw["signed"]["format"].as_str() {
        Some("mx.nomina.fiscal-package") => { let _: Envelope = n::decode_closed(&raw)?; },
        _ => { let _: TrustEnvelope = n::decode_closed(&raw)?; },
    }
    if !id.strip_prefix("ed25519-sha256:").map(n::validation_2026::digest).unwrap_or(false) { return Err(bad("INVALID_EDITORIAL_KEY_ID")); }
    let purpose: Purpose = serde_json::from_value(json!(purpose)).map_err(|_|bad("INVALID_EDITORIAL_PURPOSE"))?;
    let trust = raw["signed"]["format"] == "mx.nomina.fiscal-trust";
    if (trust && purpose != Purpose::TrustRoot) || (!trust && !matches!(purpose, Purpose::Package | Purpose::ContentApproval)) {
        return Err(bad("INVALID_EDITORIAL_PURPOSE"));
    }
    n::signature::message(&Protected { protocol_version:1, algorithm:"Ed25519".into(), key_id:id.into(), purpose }, &raw["signed"])
}

#[cfg(test)]
mod tests {
    use super::*;
    fn source() -> Value { serde_json::from_str(include_str!("../../../../docs/evidence/5d3a/editorial-source-2026.json")).unwrap() }
    #[test] fn preparation_rejects_qa_and_preserves_exact_production_payload() {
        let mut s = source(); assert_eq!(prepare(&n::canonical::bytes(&s).unwrap()).err().unwrap().code, "EDITORIAL_PRODUCTION_CHANNEL_REQUIRED");
        s["channel"] = json!("production");
        let output = prepare(&n::canonical::bytes(&s).unwrap()).unwrap();
        assert_eq!(output, n::canonical::bytes(&json!({"signed":s,"signatures":[]})).unwrap());
    }
    #[test] fn message_has_exact_domain_and_bound_header_and_rejects_wrong_purpose() {
        let mut s = source(); s["channel"] = json!("production");
        let b = prepare(&n::canonical::bytes(&s).unwrap()).unwrap(); let id = format!("ed25519-sha256:{}", "1".repeat(64));
        let msg = signing_message(&b, "package", &id).unwrap();
        let mut expected = b"mx.calculadoranomina/fiscal/package/ed25519-jcs/v1\0".to_vec();
        expected.extend(n::canonical::bytes(&json!({"protected":{"protocolVersion":1,"algorithm":"Ed25519","keyId":id,"purpose":"package"},"signed":s})).unwrap());
        assert_eq!(msg, expected);
        assert_eq!(signing_message(&b,"trust-root",&id).err().unwrap().code,"INVALID_EDITORIAL_PURPOSE");
        assert!(signing_message(&b,"package","unknown").is_err());
    }
    #[test] fn editorial_bootstrap_cannot_relabel_known_qa_keys() {
        let mut b: Value = serde_json::from_str(include_str!("../../../../docs/evidence/5d3b2/fixtures/bootstrap.json")).unwrap();
        assert_eq!(bootstrap(&n::canonical::bytes(&b).unwrap()).err().unwrap().code,"PRODUCTION_BOOTSTRAP_CHANNEL_MISMATCH");
        b["channel"] = json!("production");
        assert_eq!(bootstrap(&n::canonical::bytes(&b).unwrap()).err().unwrap().code,"QA_KEY_FORBIDDEN_IN_PRODUCTION");
    }
}
