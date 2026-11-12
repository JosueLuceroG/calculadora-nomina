# Fiscal editorial tools — QA and external production signatures

These tools are **not Tauri resources or application commands**. The application
is not provisioned for production. Production signatures are supplied externally;
the production commands never load private keys. Keys passed to `sign-qa`
must resolve outside the project. Root keys used by the exercise stay in memory;
temporary publisher/approval PEMs are removed before success is reported.

## Setup and tests (from project root)

```text
npm --prefix tools/fiscal-editorial ci --ignore-scripts --no-audit --no-fund
cargo test --locked --manifest-path crates/nomina-fiscal-package/Cargo.toml
cargo build --locked --manifest-path tools/fiscal-editorial/native-verify/Cargo.toml
npm --prefix tools/fiscal-editorial test
node tools/fiscal-editorial/exercise.mjs
```

`exercise.mjs --fiscal` also runs the project's full Vitest regression after
checking that the input registry is exactly the unchanged historical2026 content.
It refuses to claim that these old controls validate a different revision. New
content requires its own independent reference runner and review evidence.

## Commands

Prefix commands with `node tools/fiscal-editorial/src/cli.mjs`:

- `build SOURCE_JSON NEW_OUTPUT`: unsigned QA candidate, native data validation.
- `canonicalize INPUT NEW_OUTPUT`: strict JSON profile and independent JCS.
- `validate PACKAGE`: structure, hashes, fiscal coherence, **no authentication**.
- `hash PACKAGE`: content, signed payload and envelope identities.
- `inspect PACKAGE`: escaped JSON; no evaluation or modules.
- `diff A B`: changes to signed data, not signature-set changes.
- `sign-qa INPUT EXTERNAL_QA_PEM PURPOSE NEW_OUTPUT`: domain-separated signature.
- `verify PACKAGE BOOTSTRAP CHAIN REVISIONS NOW OPERATION MODE`: native verification.
- `verify-independent PACKAGE BOOTSTRAP TRUST NOW`: independent OpenSSL checks.
- `publication-report` with the same arguments as `verify`: QA report, no upload.
- `qa-demo NEW_TEMP_DIRECTORY`: ephemeral keys, public artifacts only.
- `fiscal-check PACKAGE`: unchanged2026 regression only, never a new-data approval.

`NOW` is explicit canonical UTC (`2026-10-23T12:00:00Z` in fixtures). `OPERATION`
is `direct` or `inverse`; `MODE` is `qa`, `direct-only` (restrictive test policy),
or `production` (fails closed: no production bootstrap). The distinct
`production-editorial` mode verifies against operator-supplied public inputs only;
it does not install an application anchor. CHAIN is an operator
supplied JSON array of local trust-document paths, not a path inside the package.
REVISIONS is an operator supplied immutable JSON array of observed floors.

The `native-verify` CLI contains filesystem access only as an editorial host;
all reads are bounded. The Rust library itself has no filesystem, SQL, network,
clock access, private signing, installation or activation.

## Public reference vectors

`fetch-vectors.mjs` is an explicit preparation step, never invoked by the verifier.
It uses fixed Git commits and records original-byte hashes and licenses. Tests
run offline from local inputs. RFC fixtures store public keys/messages/signatures
only; no RFC secret seeds are copied. Wycheproof `acceptable` cases are rejected
by this project's deliberately strict canonical/prime-subgroup profile.

The independent Node verifier authenticates signatures, root quorum and content
hashes. It does not replace the native semantic validator or claim installed
state. Every successful candidate still reports `not-installed-not-authorized`.

## R2.B.2 — public-only external signing

Run only the focused checks for this milestone; `run-tests.mjs` above writes the
historical QA evidence and is not the R2.B.2 runner:

```text
cargo test --locked --offline --manifest-path tools/fiscal-editorial/native-verify/Cargo.toml editorial::tests
cargo build --locked --offline --manifest-path tools/fiscal-editorial/native-verify/Cargo.toml
npm --prefix tools/fiscal-editorial run test:production
```

The following commands use the same `node tools/fiscal-editorial/src/cli.mjs` prefix:

```text
production-prepare SOURCE_JSON NEW_CANDIDATE
production-export CANDIDATE PURPOSE KEY_ID NEW_REQUEST_JSON NEW_MESSAGE_BIN
production-assemble CANDIDATE RESPONSE_PATHS_JSON CONTEXT_JSON NEW_SIGNED_DOCUMENT
production-verify SIGNED_DOCUMENT CONTEXT_JSON
production-report SIGNED_PACKAGE CONTEXT_JSON NEW_PUBLIC_REPORT
```

- Sources use the existing `SignedPackage` or `SignedTrust` schema with channel
  `production`. Preparation preserves that payload, validates packages natively
  and emits an unsigned canonical envelope. Trust preparation checks the closed
  schema, header and public roots; full chain/validity/delegation checks happen at assembly.
- Purposes are `trust-root` for trust, `package` and `content-approval` for packages.
  A root transition needs both old and new quorums. Publisher and approver keys
  must be distinct and independently delegated.
- Export produces the **exact bytes** from the existing protocol:
  UTF-8 `mx.calculadoranomina/fiscal/<purpose>/ed25519-jcs/v1`, a NUL byte, then
  RFC 8785 bytes of `{protected, signed}`. Native Rust and Node must agree byte-for-byte.
- The external signer checks the request's purpose, channel, key ID, document
  identifiers, payload hash, message hash and length. It signs `NEW_MESSAGE_BIN`
  with ordinary Ed25519, **not a textual hash or Ed25519ph**.
- All outputs use create-new semantics; signed output is written only after native
  and independent verification. Verification snapshots the public inputs so both
  implementations inspect identical bytes. No command uploads or publishes files.

The external signer returns canonical JSON with these fields:

```text
{
  format: "mx.nomina.external-signature",
  formatVersion: 1,
  requestSha256: SHA256(RFC8785(request)),
  request: <the exported request object, unchanged>,
  signature: <64 signature bytes encoded as unpadded Base64URL>
}
```

`RESPONSE_PATHS_JSON` is a canonical array of response-file paths. `CONTEXT_JSON`
is an operator-owned JSON object, separate from the package:

```json
{
  "bootstrap": "bootstrap.json",
  "chain": "chain.json",
  "revisions": "revisions.json",
  "now": "2026-11-04T12:00:00Z",
  "operation": "direct"
}
```

Referenced paths are relative to their containing JSON file. The public bootstrap
uses the existing `{channel, rootKeys}` shape. `chain.json` is a canonical array
of trust-document paths, and `revisions.json` is the existing array of observed
revision floors. For initial trust, the chain is empty; for a trust update it
contains the preceding documents; for a package it includes the current final trust.

The native verifier additionally enforces strict public-key validation, known-QA
key exclusion, fiscal coherence and compiled compatibility. The independent
Node/OpenSSL control checks authentication, root transitions, roles, delegation
scope, validity, revisions, revocations, withdrawals and content hashes; it does
not replace native semantic validation or certify fiscal content.

Reports contain hashes, versions, sources, review references and both results.
They say `not-published` and `not-installed-not-authorized`: selecting an editorial
bootstrap does not approve custody, modify `APPROVED_ROOTS`, or provision the app.
Private signing material exists only in the isolated test signer, in memory.
