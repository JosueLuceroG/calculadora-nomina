//! Ephemeral signing material exists only in this cfg(test) module, in memory.
use super::*;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use ed25519_dalek::{Signer, SigningKey};
use serde_json::{Value, json};

const NOW: &str = "2026-11-04T12:00:00Z";
fn key() -> SigningKey {
    let mut seed = [0; 32];
    getrandom::getrandom(&mut seed).unwrap();
    let key = SigningKey::from_bytes(&seed);
    seed.fill(0);
    key
}
fn public(key: &SigningKey) -> RootKey {
    let bytes = key.verifying_key().to_bytes();
    RootKey { key_id: hashes::key_id(&bytes), public_key: URL_SAFE_NO_PAD.encode(bytes) }
}
fn inventory() -> (Vec<SigningKey>, Vec<RootKey>) {
    let keys = (0..3).map(|_| key()).collect::<Vec<_>>();
    let roots = keys.iter().map(public).collect();
    (keys, roots)
}
fn document(roots: &[RootKey], version: u64, epoch: u64) -> SignedTrust {
    SignedTrust {
        format: "mx.nomina.fiscal-trust".into(), format_version: 1, canonicalization: "RFC8785".into(),
        channel: Channel::Production, root_version: version, epoch,
        issued_at: "2026-11-01T00:00:00Z".into(), expires_at: "2026-12-01T00:00:00Z".into(),
        root_validity: Dates { from: "2026-01-01T00:00:00Z".into(), through: "2031-01-01T00:00:00Z".into() },
        root_keys: roots.to_vec(), threshold: 2, delegations: vec![], revoked_key_ids: vec![], withdrawn_payloads: vec![], floors: vec![],
    }
}
fn signed(document: &SignedTrust, keys: &[&SigningKey]) -> Vec<u8> {
    let raw = serde_json::to_value(document).unwrap();
    let mut signatures = keys.iter().map(|key| {
        let protected = Protected { protocol_version: 1, algorithm: "Ed25519".into(), key_id: public(key).key_id, purpose: Purpose::TrustRoot };
        let value = URL_SAFE_NO_PAD.encode(key.sign(&signature::message(&protected, &raw).unwrap()).to_bytes());
        SignatureRecord { protected, value }
    }).collect::<Vec<_>>();
    signatures.sort_by(|a, b| a.protected.key_id.cmp(&b.protected.key_id));
    canonical::bytes(&TrustEnvelope { signed: document.clone(), signatures }).unwrap()
}
fn rejects<T>(result: Result<T>, code: &str) {
    match result { Err(error) => assert_eq!(error.code, code), Ok(_) => panic!("Expected {code}") }
}

#[test]
fn constructor_requires_exactly_three_roots_and_explicit_production_channel() {
    let (_, roots) = inventory();
    for count in [0, 1, 2, 4] {
        let records = (0..count).map(|i| roots[i % 3].clone()).collect::<Vec<_>>();
        rejects(TrustedState::production_bootstrap(Channel::Production, &records), "THREE_ROOT_KEYS_REQUIRED");
    }
    rejects(TrustedState::production_bootstrap(Channel::Qa, &roots), "PRODUCTION_BOOTSTRAP_CHANNEL_MISMATCH");
    let state = TrustedState::production_bootstrap(Channel::Production, &roots).unwrap();
    assert_eq!(state.channel(), Channel::Production);
    assert_eq!((state.root_version(), state.epoch()), (1, 0));
    rejects(state.current(NOW), "TRUST_METADATA_REQUIRED");
}

#[test]
fn duplicate_mismatched_weak_and_noncanonical_public_keys_are_rejected() {
    let (_, roots) = inventory();
    let mut duplicate = roots.clone(); duplicate[1] = duplicate[0].clone();
    rejects(TrustedState::production_bootstrap(Channel::Production, &duplicate), "DUPLICATE_ROOT_KEY");
    let mut mismatch = roots.clone(); mismatch[0].key_id = mismatch[1].key_id.clone();
    rejects(TrustedState::production_bootstrap(Channel::Production, &mismatch), "KEY_ID_MISMATCH");
    for bytes in [[0; 32], { let mut b = [0; 32]; b[0] = 1; b }] {
        let mut weak = roots.clone(); weak[0] = RootKey { key_id: hashes::key_id(&bytes), public_key: URL_SAFE_NO_PAD.encode(bytes) };
        rejects(TrustedState::production_bootstrap(Channel::Production, &weak), "WEAK_OR_NON_CANONICAL_PUBLIC_KEY");
    }
    for text in ["!".to_string(), format!("{}=", roots[0].public_key), URL_SAFE_NO_PAD.encode([0; 31])] {
        let mut invalid = roots.clone(); invalid[0].public_key = text;
        assert!(TrustedState::production_bootstrap(Channel::Production, &invalid).is_err());
    }
}

#[test]
fn every_two_of_three_pair_meets_quorum_but_one_or_duplicate_does_not() {
    let (keys, roots) = inventory();
    let state = TrustedState::production_bootstrap(Channel::Production, &roots).unwrap();
    let doc = document(&roots, 1, 1);
    for (a, b) in [(0, 1), (0, 2), (1, 2)] {
        assert_eq!(state.propose_update(&signed(&doc, &[&keys[a], &keys[b]]), NOW).unwrap().epoch(), 1);
    }
    rejects(state.propose_update(&signed(&doc, &[&keys[0]]), NOW), "ROOT_QUORUM_NOT_MET");
    rejects(state.propose_update(&signed(&doc, &[&keys[0], &keys[0]]), NOW), "DUPLICATE_OR_UNORDERED_SIGNATURE");
    for threshold in [1, 3] {
        let mut bad_doc = doc.clone(); bad_doc.threshold = threshold;
        rejects(state.propose_update(&signed(&bad_doc, &[&keys[0], &keys[1]]), NOW), "TRUST_LIMIT_OR_THRESHOLD");
    }
}

#[test]
fn other_channel_and_self_signed_replacement_cannot_install_roots() {
    let (keys, roots) = inventory();
    let state = TrustedState::production_bootstrap(Channel::Production, &roots).unwrap();
    let mut qa = document(&roots, 1, 1); qa.channel = Channel::Qa;
    rejects(state.propose_update(&signed(&qa, &[&keys[0], &keys[1]]), NOW), "TRUST_FORMAT_OR_CHANNEL_MISMATCH");
    let (other_keys, other_roots) = inventory();
    rejects(state.propose_update(&signed(&document(&other_roots, 1, 1), &[&other_keys[0], &other_keys[1]]), NOW), "ROOT_TRANSITION_REQUIRED");
    rejects(state.propose_update(&signed(&document(&other_roots, 2, 1), &[&other_keys[0], &other_keys[1]]), NOW), "ROOT_QUORUM_NOT_MET");
    rejects(TrustedState::unconfigured_production().propose_update(&signed(&document(&roots, 1, 1), &[&keys[0], &keys[1]]), NOW), "PRODUCTION_BOOTSTRAP_MISSING");
}

#[test]
fn root_rotation_requires_old_and_new_quorums_without_mutating_initial_anchor() {
    let (old_keys, old_roots) = inventory();
    let initial = TrustedState::production_bootstrap(Channel::Production, &old_roots).unwrap();
    let current = initial.propose_update(&signed(&document(&old_roots, 1, 1), &[&old_keys[0], &old_keys[1]]), NOW).unwrap();
    let (new_keys, new_roots) = inventory();
    let next = document(&new_roots, 2, 2);
    rejects(current.propose_update(&signed(&next, &[&old_keys[0], &new_keys[0], &new_keys[1]]), NOW), "ROOT_QUORUM_NOT_MET");
    rejects(current.propose_update(&signed(&next, &[&old_keys[0], &old_keys[1], &new_keys[0]]), NOW), "ROOT_QUORUM_NOT_MET");
    let rotated = current.propose_update(&signed(&next, &[&old_keys[0], &old_keys[1], &new_keys[0], &new_keys[1]]), NOW).unwrap();
    assert_eq!((rotated.root_version(), rotated.epoch()), (2, 2));
    assert_eq!(initial.root_keys, roots(&old_roots).unwrap());
    assert_eq!((initial.root_version(), initial.epoch()), (1, 0));
    assert_eq!(current.root_keys, roots(&old_roots).unwrap());
}

fn known_qa_records() -> BTreeMap<String, RootKey> {
    macro_rules! source { ($path:literal) => { include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../docs/evidence/", $path)) }; }
    let sources = [
        source!("5d3a/qa-example/bootstrap-public.json"), source!("5d3a/qa-example/trust.json"),
        source!("5d3b1/fixtures/bootstrap.json"), source!("5d3b1/fixtures/trust1.json"),
        source!("5d3b1/rotation/bootstrap.json"), source!("5d3b1/rotation/trust1.json"), source!("5d3b1/rotation/trust2.json"),
        source!("5d3b1/renewal/bootstrap.json"), source!("5d3b1/renewal/initial.json"), source!("5d3b1/renewal/middle.json"), source!("5d3b1/renewal/final.json"),
        source!("5d3b2/fixtures/bootstrap.json"), source!("5d3b2/fixtures/trust.json"),
        source!("5d3b2/fixtures-attempt1/bootstrap.json"), source!("5d3b2/fixtures-attempt1/trust.json"),
        source!("5d3b2/fixtures-attempt2/bootstrap.json"), source!("5d3b2/fixtures-attempt2/trust.json"),
    ];
    fn collect(value: &Value, out: &mut BTreeMap<String, RootKey>) {
        if let (Some(id), Some(public)) = (value.get("keyId").and_then(Value::as_str), value.get("publicKey").and_then(Value::as_str)) {
            out.insert(id.into(), RootKey { key_id: id.into(), public_key: public.into() });
        }
        match value { Value::Object(map) => for v in map.values() { collect(v, out); }, Value::Array(list) => for v in list { collect(v, out); }, _ => {} }
    }
    let mut records = BTreeMap::new();
    for source in sources { collect(&serde_json::from_str::<Value>(source).unwrap(), &mut records); }
    records
}

#[test]
fn known_qa_inventory_is_denial_only_and_covers_existing_roots_and_delegates() {
    let qa = known_qa_records();
    assert_eq!(qa.len(), 47);
    assert_eq!(qa.keys().map(String::as_str).collect::<Vec<_>>(), known_qa_keys::IDS);
    let (_, mut records) = inventory();
    for root in qa.values() {
        records[0] = root.clone();
        rejects(TrustedState::production_bootstrap(Channel::Production, &records), "QA_KEY_FORBIDDEN_IN_PRODUCTION");
    }
}

#[test]
fn qa_keys_cannot_enter_production_through_rotation_or_delegation() {
    let (keys, records) = inventory();
    let state = TrustedState::production_bootstrap(Channel::Production, &records).unwrap();
    let qa = known_qa_records().into_values().next().unwrap();
    let mut rotation = document(&records, 2, 1); rotation.root_keys[0] = qa.clone();
    rejects(state.propose_update(&signed(&rotation, &[&keys[0], &keys[1]]), NOW), "QA_KEY_FORBIDDEN_IN_PRODUCTION");
    let mut delegated = document(&records, 1, 1);
    delegated.delegations.push(serde_json::from_value(json!({
        "keyId":qa.key_id,"publicKey":qa.public_key,"purpose":"package","channel":"production","exercise":2026,
        "parameterSchemaId":"test-schema","ruleProfileId":"test-profile","contextualPolicyId":"test-context",
        "streamId":"test-stream","streamEpoch":1,"minimumRevision":1,"maximumRevision":1,
        "notBefore":"2026-11-01T00:00:00Z","notAfter":"2026-12-01T00:00:00Z","operations":["direct"]
    })).unwrap());
    rejects(state.propose_update(&signed(&delegated, &[&keys[0], &keys[1]]), NOW), "QA_KEY_FORBIDDEN_IN_PRODUCTION");
}
