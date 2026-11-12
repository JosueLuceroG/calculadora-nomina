//! Native-only tests. No generated key or synthetic anchor is compiled into the app.
use super::*;
use self::core::wire::*;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use ed25519_dalek::{Signer, SigningKey};
use std::sync::Arc;

const NOW: &str = "2026-11-04T12:00:00Z";
fn id() -> String { uuid::Uuid::new_v4().to_string() }
fn inventory() -> (Vec<SigningKey>, Vec<RootKey>) {
    let keys = (0..3).map(|_| {
        let mut seed = [0; 32];
        seed[..16].copy_from_slice(uuid::Uuid::new_v4().as_bytes());
        seed[16..].copy_from_slice(uuid::Uuid::new_v4().as_bytes());
        let key = SigningKey::from_bytes(&seed); seed.fill(0); key
    }).collect::<Vec<_>>();
    let records = keys.iter().map(|key| {
        let bytes = key.verifying_key().to_bytes();
        RootKey { key_id: core::hashes::key_id(&bytes), public_key: URL_SAFE_NO_PAD.encode(bytes) }
    }).collect();
    (keys, records)
}
fn policy(roots: &[RootKey]) -> Policy { Policy { channel: "production".into(), roots: roots.to_vec() } }
fn trust(roots: &[RootKey], version: u64, epoch: u64, signers: &[&SigningKey]) -> Vec<u8> {
    let signed = serde_json::json!({
        "format":"mx.nomina.fiscal-trust","formatVersion":1,"canonicalization":"RFC8785","channel":"production",
        "rootVersion":version,"epoch":epoch,"issuedAt":"2026-11-01T00:00:00Z","expiresAt":"2026-12-01T00:00:00Z",
        "rootValidity":{"from":"2026-01-01T00:00:00Z","through":"2031-01-01T00:00:00Z"},
        "rootKeys":roots,"threshold":2,"delegations":[],"revokedKeyIds":[],"withdrawnPayloads":[],"floors":[]
    });
    sign_document(&signed, &signers.iter().map(|key|(*key,Purpose::TrustRoot)).collect::<Vec<_>>())
}
fn sign_document(signed:&serde_json::Value,signers:&[(&SigningKey,Purpose)])->Vec<u8>{
    let mut signatures = signers.iter().map(|(key,purpose)| {
        let protected = Protected { protocol_version:1, algorithm:"Ed25519".into(), key_id:core::hashes::key_id(&key.verifying_key().to_bytes()), purpose:*purpose };
        let value = URL_SAFE_NO_PAD.encode(key.sign(&core::signature::message(&protected, &signed).unwrap()).to_bytes());
        SignatureRecord { protected, value }
    }).collect::<Vec<_>>();
    signatures.sort_by(|a,b| (a.protected.purpose,&a.protected.key_id).cmp(&(b.protected.purpose,&b.protected.key_id)));
    core::canonical::bytes(&serde_json::json!({"signed":signed,"signatures":signatures})).unwrap()
}
struct Sandbox(PathBuf);
impl Sandbox {
    fn new() -> Self {
        let parent = std::env::temp_dir().join("opencode"); assert!(parent.is_dir());
        Self(parent.join(format!("r2b1-{}", id())))
    }
    fn repository(&self, policy: Policy) -> Repository {
        let mut repo = Repository::new(self.0.clone(), policy);
        repo.clock = Clock { fixed: Some(Arc::new(Mutex::new(NOW.into()))) }; repo
    }
}
impl Drop for Sandbox { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
fn rejects<T>(result: Result<T>, code: &str) {
    match result { Err(error) => assert_eq!(error.code, code), Ok(_) => panic!("Expected {code}") }
}

#[test]
fn compiled_production_inventory_is_absent_and_preserves_unconfigured_policy_hash() {
    let p = Policy::production();
    assert!(production_bootstrap::compiled_roots().is_empty()); assert!(p.roots.is_empty());
    assert_eq!(p.hash().unwrap(), "4b27b88243aff863742034b0fef7cb2cf78ae863d3d5d7e31ac7366232780924");
    assert_eq!(p.initial().unwrap().root_version(), 0);
    assert_eq!(p.initial().unwrap().current(NOW).err().unwrap().code, "PRODUCTION_BOOTSTRAP_MISSING");
    let sandbox = Sandbox::new();
    let repo = sandbox.repository(p);
    assert_eq!(repo.initialize_new().unwrap().validity, "production-bootstrap-missing");
    let qa_document = include_bytes!("../../../docs/evidence/5d3b2/fixtures/trust.json");
    rejects(repo.accept_trust_episode(&id(), 0, &[qa_document.to_vec()]), "PRODUCTION_BOOTSTRAP_MISSING");
    assert_eq!(repo.open_existing().unwrap().generation, 0);
}

#[test]
fn production_policy_rejects_qa_roots_and_unknown_channel_configuration() {
    let qa = Policy::import_qa();
    rejects(policy(&qa.roots).initial(), "QA_KEY_FORBIDDEN_IN_PRODUCTION");
    rejects(policy(&qa.roots).hash(), "QA_KEY_FORBIDDEN_IN_PRODUCTION");
    let (_, roots) = inventory();
    rejects(policy(&roots[..2]).hash(), "THREE_ROOT_KEYS_REQUIRED");
    rejects(Policy { channel:"other".into(), roots }.initial(), "INVALID_POLICY_CHANNEL");
}

#[test]
fn initial_anchor_hash_and_markers_survive_signed_rotation_and_reopening() {
    let sandbox = Sandbox::new();
    let (old_keys, old_roots) = inventory();
    let anchor = policy(&old_roots).hash().unwrap();
    let repo = sandbox.repository(policy(&old_roots));
    assert_eq!(repo.initialize_new().unwrap().validity, "metadata-required");
    let marker = fs::read(sandbox.0.join("fiscal-initialized.json")).unwrap();
    repo.accept_trust_episode(&id(), 0, &[trust(&old_roots, 1, 1, &[&old_keys[0], &old_keys[1]])]).unwrap();
    let (new_keys, new_roots) = inventory();
    repo.accept_trust_episode(&id(), 1, &[trust(&new_roots, 2, 2, &[&old_keys[0], &old_keys[1], &new_keys[0], &new_keys[1]])]).unwrap();
    let reopened = sandbox.repository(policy(&old_roots));
    let status = reopened.open_existing().unwrap();
    assert_eq!((status.generation, status.root_version, status.trust_epoch), (2, 2, 2));
    assert_eq!(status.validity, "current");
    assert_eq!(reopened.policy.hash().unwrap(), anchor);
    assert_eq!(fs::read(sandbox.0.join("fiscal-initialized.json")).unwrap(), marker);
    assert_eq!(fs::read(sandbox.0.join("fiscal-initialization.json")).unwrap(), marker);
    let c = schema::open(&reopened.db(), false).unwrap();
    assert_eq!(c.query_row("SELECT bootstrap_sha256 FROM repository_meta WHERE id=1", [], |r|r.get::<_,String>(0)).unwrap(), anchor);
    assert_eq!(count(&c, "trust_documents").unwrap(), 2);
    assert_eq!(count(&c, "installations").unwrap(), 0);
}

#[test]
fn changed_removed_reordered_or_qa_anchor_is_rejected_without_rewriting_repository() {
    let sandbox = Sandbox::new();
    let (_, roots) = inventory();
    let repo = sandbox.repository(policy(&roots)); repo.initialize_new().unwrap();
    let before_db = fs::read(repo.db()).unwrap();
    let before_marker = fs::read(sandbox.0.join("fiscal-initialized.json")).unwrap();
    let (_, changed) = inventory(); let mut reordered = roots.clone(); reordered.swap(0, 1);
    for p in [policy(&changed), Policy::production(), policy(&reordered), Policy::import_qa()] {
        rejects(sandbox.repository(p).open_existing(), "REPOSITORY_IDENTITY_MISMATCH");
        assert_eq!(fs::read(repo.db()).unwrap(), before_db);
        assert_eq!(fs::read(sandbox.0.join("fiscal-initialized.json")).unwrap(), before_marker);
    }
    assert_eq!(repo.open_existing().unwrap().generation, 0);
}

#[test]
fn test_provisioned_anchor_alone_does_not_authorize_execution() {
    let sandbox = Sandbox::new(); let (_, roots) = inventory();
    let repo = sandbox.repository(policy(&roots));
    assert!(repo.management_enabled(false).is_ok());
    repo.initialize_new().unwrap();
    rejects(repo.prepare_execution(&SelectionIdentity::integrated(), "2026-11-04", "weekly", "gross-to-net"), "EXTERNAL_SELECTION_REQUIRED");
    let service = crate::fiscal_import::ImportService::new(repo, false);
    assert!(service.enabled().is_ok());
    assert!(!sandbox.0.join("payroll.sqlite3").exists());
}
#[path="production_management_tests.rs"]pub(crate) mod management;
