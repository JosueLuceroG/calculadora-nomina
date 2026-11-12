//! Compiled host inventory. No file, JSON, IPC, argument or environment loader.
//! Remains absent until a separately approved public-key custody ceremony.
use super::core::wire::RootKey;

struct PublicRoot { key_id: &'static str, public_key: &'static str }
const APPROVED_ROOTS: Option<[PublicRoot; 3]> = None;

pub(super) fn compiled_roots() -> Vec<RootKey> {
    if !cfg!(feature = "fiscal-production") { return vec![]; }
    match &APPROVED_ROOTS {
        None => vec![],
        Some(roots) => roots.iter().map(|r| RootKey { key_id: r.key_id.into(), public_key: r.public_key.into() }).collect(),
    }
}
