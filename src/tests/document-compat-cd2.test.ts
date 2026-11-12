import { describe, it, expect, afterAll } from "vitest"
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { createHash } from "node:crypto"
import { decodeFiscalSnapshot, encodeFiscalSnapshot } from "../features/storage/snapshot"
import { assertSnapshotV3 } from "../features/documents/provenance-v3"
import { assertCompatSnapshot, assertCompatShape } from "../features/documents/provenance-compat-v1"
import { compatClassification } from "../features/documents/presentation-compat-v1"
import { documentaryRoute } from "../features/storage/document-dispatch"
import { serializeStorageValue } from "../features/storage/serialization"
import descriptor from "../features/documents/document-producer-compat-v1.json"
import { scanDocument, DOCUMENT_BYTES, DOCUMENT_NODES } from "../features/documents/budget-v3"

type J = null | boolean | number | string | J[] | { [key: string]: J }
type O = { [key: string]: J }
type Case = { name: string; payload: string; accepted: boolean; classification?: string; historical?: boolean }
const root = new URL("../../", import.meta.url), out = new URL("docs/evidence/snapshot-v3-compat/cd2/", root)
const read = (p: string): J => JSON.parse(readFileSync(new URL(p, root), "utf8")) as J
const obj = (v: J): O => { if (!v || typeof v !== "object" || Array.isArray(v)) throw Error("object required"); return v }
const arr = (v: J): J[] => { if (!Array.isArray(v)) throw Error("array required"); return v }
const get = (v: J, p: string): J => p.split(".").reduce<J>((x, k) => Array.isArray(x) ? x[Number(k)] : obj(x)[k], v)
function set(v: J, p: string, x: J) { const a = p.split("."), k = a.pop()!; const parent = a.length ? get(v, a.join(".")) : v; if (Array.isArray(parent)) parent[Number(k)] = x; else obj(parent)[k] = x }
const clone = (x: J): J => structuredClone(x)
const fixtures = arr(read("docs/evidence/5d3b3/fixtures-v3.json"))
const old = (name: string): J => obj(JSON.parse(String(obj(fixtures.find(x => obj(x).name === name)!).payload)) as J).value
function evaluation(s: J) {
  const r = get(s, "outcome.report"), p = get(r, "provenance"), inverse = get(r, "operation") === "net-to-gross"
  set(s, "effectiveContext.evaluationObservation", { basis: "report-not-attested", availability: "reported",
    reportedParameterSetVersions: inverse ? null : get(p, "parameterSetVersions"),
    reportedForwardPolicyVersions: get(p, inverse ? "forwardPolicyVersions" : "policyVersions"),
    reportedDirectEvaluations: inverse ? get(r, "metrics.directEvaluations") : null })
}
function fresh(name = "direct-manual"): J {
  const s = old(name)
  for (const k of ["producerId", "reportContractId", "presentationContractId"] as const) set(s, "executionProvenance." + k, descriptor[k])
  const r = get(s, "outcome.report"), inverse = get(r, "operation") === "net-to-gross"
  set(s, "executionProvenance.policyVersions", [...arr(get(r, inverse ? "provenance.forwardPolicyVersions" : "provenance.policyVersions")), ...(inverse ? [{ component: "net-to-gross", version: get(r, "provenance.policyVersion") }] : [])])
  evaluation(s); return s
}
const dwPath = "docs/evidence/5d3b5/runs/ccb510ae-3be6-4e57-9951-77403524ba6e/dw2-outcome.json"
const dw = read(dwPath)
function dwFixture(): J {
  const s = fresh("inverse-exact"), windows = read("docs/evidence/5d3b5/windows-differential.json")
  set(s, "outcome", clone(dw)); set(s, "capture", clone(get(windows, "dw2.preflight.capture")))
  set(s, "capture.form.mode", "net-to-gross"); set(s, "capture.form.amount", "13202.64"); evaluation(s); return s
}
function emptyInverse(): J {
  const s = dwFixture(), r = get(s, "outcome.report"), p = get(s, "outcome.presentation")
  for (const k of ["recommended", "recommendedForwardResult", "nearestVerifiedBelow", "nearestVerifiedAbove", "smallestFound"]) set(r, k, null)
  set(r, "match", "none"); set(r, "exactCandidates", []); set(r, "recommendationBasis", "none")
  set(r, "provenance.forwardPolicyVersions", []); set(r, "provenance.sources", []); delete obj(get(r, "provenance")).retentionReviewRegion
  set(s, "executionProvenance.policyVersions", [{ component: "net-to-gross", version: get(r, "provenance.policyVersion") }])
  const range = clone(get(r, "coverage.domain"))
  set(r, "coverage.evidence", [{ ...obj(range), disposition: "pending-budget", reason: "time-budget" }]); set(r, "coverage.pendingIntervals", [range]); set(r, "coverage.fiscalUnresolvedIntervals", [])
  for (const k of ["directEvaluations", "cacheHits", "cacheEntries", "exhaustivePoints", "certifiedClosures", "yields"]) set(r, "metrics." + k, 0)
  set(p, "determination", "blocked"); for (const k of Object.keys(obj(get(p, "values")))) set(p, "values." + k, null)
  set(p, "componentStates", null); set(p, "integrationFactorRaw", null); set(p, "variableIncome", "unknown")
  for (const k of Object.keys(obj(get(p, "subsidy")))) set(p, "subsidy." + k, null)
  set(p, "warnings", arr(get(p, "warnings")).filter(x => obj(x).code === "INVERSE_SEARCH_LIMITED"))
  for (const k of ["recommendedGross", "obtainedNet", "difference", "absoluteDifference", "smallestFoundGross"]) set(p, "inverse." + k, null)
  set(p, "inverse.match", "none"); set(p, "inverse.alternatives", []); set(p, "inverse.recommendationBasis", "none")
  evaluation(s); return s
}
function partialDirect(): J {
  const s = fresh(), r = get(s, "outcome.report"), p = get(s, "outcome.presentation")
  const reason = "MONTHLY_PAYMENTS_OUTSIDE_STANDARD_PROFILE", message = "Contexto fuera del perfil declarado."
  const unknown: J = { status: "not-supported", amount: null, reason }
  set(r, "status", "not-supported"); set(r, "complete", false); set(r, "reconciliationVerified", false); set(r, "net", clone(unknown)); set(r, "isr.withheld", clone(unknown))
  for (const k of ["applied", "notAppliedDueToNoWithholding", "totalNotApplied"]) set(r, "subsidy." + k, clone(unknown))
  set(r, "retention.status", "not-supported"); set(r, "retention.kind", "blocked"); set(r, "retention.reason", reason)
  for (const path of ["executionProvenance.requestScenario", "outcome.report.retention.scenario", "outcome.report.retention.assessment.context"]) set(s, path + ".monthlyCondition", "outside-profile")
  set(r, "retention.assessment.state", "outside-profile"); set(r, "retention.assessment.message", message); set(r, "retention.assessment.reason", reason)
  set(r, "issues", [{ stages: ["retention"], field: "scenario", kind: "unsupported-scenario", code: reason, message }])
  set(p, "fiscalStatus", "not-supported"); set(p, "determination", "blocked"); set(p, "values.netSalary", null); set(p, "values.isr", null); set(p, "values.employmentSubsidy", null)
  set(p, "componentStates.net", clone(unknown)); set(p, "componentStates.isr", clone(unknown)); set(p, "componentStates.subsidyApplied", clone(unknown))
  set(p, "subsidy.applied", null); set(p, "subsidy.notAppliedDueToNoWithholding", null)
  const a = get(r, "retention.assessment"), context = get(a, "context")
  set(p, "confirmation", { referenceMonth: get(context, "referenceMonth"), candidateGross: get(r, "gross.amount"), basis: "direct-retention", contextual: { salaryBasis: get(context, "salaryBasis"), monthlyCondition: get(context, "monthlyCondition"), dailyRelation: get(a, "dailyRelation"), message, references: { daily: get(a, "referenceDailyMinimum"), standardMonth: get(a, "reviewRegion.from"), publishedMonth: get(a, "publishedMonthlyReference") } } })
  set(p, "issues", [{ field: "scenario", code: reason, message }]); evaluation(s); return s
}
const cases: Case[] = []
function add(name: string, s: J, accepted: boolean, classification?: string, historical = false) { cases.push({ name, payload: serializeStorageValue(s), accepted, classification, historical }) }
for (const name of ["direct-manual", "direct-imss-off-auto", "inverse-exact", "inverse-approximate", "inverse-limited", "direct-conditioned"]) {
  const classification = name === "inverse-limited" ? "limited" : name === "direct-conditioned" ? "conditioned" : name === "inverse-exact" ? "exact" : name === "inverse-approximate" ? "approximate" : "estimated"
  add("legacy-" + name, old(name), true, classification, true); add("compat-" + name, fresh(name), true, classification)
}
add("D-W2-compat-unchanged", dwFixture(), true, "not-determinable")
add("partial-direct", partialDirect(), true, "not-determinable")
add("no-candidate", emptyInverse(), true, "not-determinable")
const fiscal = dwFixture(), interval = obj(arr(get(fiscal, "outcome.report.coverage.pendingIntervals"))[0]), from = String(interval.from), to = String(interval.to)
const next = (BigInt(from.replace(".", "")) + 1n).toString().padStart(3, "0"), nextText = next.slice(0, -2) + "." + next.slice(-2)
const unresolved: J = { from, to: from }
set(fiscal, "outcome.report.coverage.fiscalUnresolvedIntervals", [unresolved]); set(fiscal, "outcome.report.coverage.pendingIntervals.0.from", nextText)
const evidence = arr(get(fiscal, "outcome.report.coverage.evidence")), index = evidence.findIndex(x => get(x, "from") === from && get(x, "to") === to && get(x, "disposition") === "pending-budget")
evidence.splice(index, 1, { ...obj(unresolved), disposition: "fiscally-unresolved", reason: "MONTHLY_MINIMUM_CONFIRMATION_REQUIRED" }, { from: nextText, to, disposition: "pending-budget", reason: "time-budget" })
add("fiscal-unresolved", fiscal, true, "not-determinable")
// Derived one-point documentary consistency control, not a fresh payroll run.
// Reuse the observed complete direct candidate; the original D-W2 is untouched.
const bounded = dwFixture(), br = get(bounded, "outcome.report"), bp = get(bounded, "outcome.presentation"), point = get(br, "recommended.gross"), target = get(br, "recommended.net")
set(br, "recommended.difference", "0.00"); set(br, "recommended.absoluteDifference", "0.00")
const exactPoint = clone(get(br, "recommended")), onePoint: J = { from: point, to: point }
set(bounded, "capture.form.amount", target); set(br, "targetNet", target); set(br, "status", "estimated"); set(br, "match", "exact"); set(br, "smallestFound", clone(exactPoint)); set(br, "exactCandidates", [clone(exactPoint)]); set(br, "recommendationBasis", "minimum-proven-in-domain"); set(br, "nearestVerifiedBelow", null); set(br, "nearestVerifiedAbove", null)
set(br, "coverage.state", "complete"); set(br, "coverage.domain", clone(onePoint)); set(br, "coverage.evidence", [{ ...obj(onePoint), disposition: "examined", reason: "EXHAUSTIVE_CENT" }]); set(br, "coverage.pendingIntervals", []); set(br, "coverage.fiscalUnresolvedIntervals", [])
for (const k of ["minimumProven", "uniquenessProven", "exactSetComplete"]) set(br, "coverage." + k, true)
set(br, "conclusion", "unique-exact-in-domain")
for (const k of ["directEvaluations", "cacheEntries", "exhaustivePoints", "elapsedMs", "peakQueueIntervals"]) set(br, "metrics." + k, 1)
for (const k of ["cacheHits", "yields", "certifiedClosures"]) set(br, "metrics." + k, 0)
set(br, "metrics.stopReason", "completed")
set(bp, "fiscalStatus", "estimated"); set(bp, "confirmation", null)
set(bp, "warnings", arr(get(br, "recommendedForwardResult.warnings")).map(x => ({ code: get(x, "code"), message: get(x, "message") })))
for (const [k, v] of Object.entries({ targetNet: target, match: "exact", difference: "0.00", absoluteDifference: "0.00", coverage: "complete", domain: onePoint, conclusion: "unique-exact-in-domain", smallestFoundGross: point, minimumProven: true, uniquenessProven: true, exactSetComplete: true, recommendationBasis: "minimum-proven-in-domain", alternatives: [exactPoint], stopReason: "completed" } as O)) set(bp, "inverse." + k, v)
evaluation(bounded); add("bounded-enumeration-without-certificate", bounded, true, "exact")
for (const [name, base, path, value] of [
  ["mixed-ids", fresh(), "executionProvenance.presentationContractId", "nomina-presentation-5c2-v1"],
  ["unknown-producer", fresh(), "executionProvenance.producerId", "unknown"],
  ["unknown-provenance", fresh(), "executionProvenance.schemaVersion", 2],
  ["null-complete-net", fresh(), "outcome.report.net.amount", null],
  ["contradictory-net", fresh(), "outcome.report.net.amount", "1.00"],
  ["numeric-money", fresh(), "capture.form.amount", 15000],
  ["unknown-root-field", fresh(), "unreviewed", true],
  ["false-uniqueness", dwFixture(), "outcome.report.coverage.uniquenessProven", true],
  ["fabricated-certificate", dwFixture(), "outcome.report.metrics.certifiedClosures", 1],
  ["wrong-difference", dwFixture(), "outcome.report.recommended.difference", "0.00"],
  ["erased-pending", dwFixture(), "outcome.report.coverage.pendingIntervals", []],
  ["changed-presentation", fresh(), "outcome.presentation.values.netSalary", "0.00"],
  ["fake-evaluation", fresh(), "effectiveContext.evaluationObservation.reportedDirectEvaluations", 1],
  ["false-fixture-authority", fresh(), "executionProvenance.authorizationObservation.kind", "native-observation-v1"],
  ["invalid-execution-time", fresh(), "execution.completedAt", "2026-02-31T12:00:00.000Z"],
  ["invalid-local-offset", fresh(), "execution.utcOffsetMinutes", 841],
  ["negative-benefit", fresh(), "capture.form.bonusDays", "-1"],
  ["false-fiscal-certification", fresh(), "outcome.report.provenance.fiscalCertification", "certified"],
  ["false-actual-withholding", fresh(), "outcome.report.provenance.actualWithholdingConfirmed", true],
  ["false-registered-sbc", fresh(), "outcome.report.sbc.data.sbcNature", "registered"],
  ["inconsistent-net-status", fresh(), "outcome.report.net.status", "valid"],
  ["foreign-candidate-parameter", fresh("inverse-exact"), "outcome.report.recommendedForwardResult.provenance.parameterSetVersions.0.id", "foreign"],
  ["wrong-context-days", fresh(), "executionProvenance.requestScenario.actualDays", 28],
  ["fractional-counter", dwFixture(), "outcome.report.metrics.cacheHits", 0.5],
  ["candidate-marked-unsupported", dwFixture(), "outcome.report.status", "not-supported"],
  ["signature", fresh(), "fiscalEvidence.packageEnvelope.signatures.0.value", "A".repeat(86)],
  ["floor-reason-unsigned", fresh(), "fiscalEvidence.trustHeadEnvelope.signed.floors.0.reason", "changed without signature"],
  ["source-digest-unsigned", fresh(), "fiscalEvidence.packageEnvelope.signed.review.sourceChecks.0.documentSha256", "0".repeat(64)],
  ["supersedes-unsigned", fresh(), "fiscalEvidence.packageEnvelope.signed.publication.changes.supersedes", { scheme: "legacy-registry-v1", sha256: "0".repeat(64) }],
  ["withdrawn-unsigned", fresh(), "fiscalEvidence.trustHeadEnvelope.signed.withdrawnPayloads", ["0".repeat(64)]]
] as [string, J, string, J][]) { set(base, path, value); add(name, base, false) }
const wrongLegacy = dwFixture(); set(wrongLegacy, "executionProvenance.producerId", "nomina-signed-fiscal-document-v3-v1"); set(wrongLegacy, "executionProvenance.reportContractId", "standard-payroll-2026-contextual-v2"); set(wrongLegacy, "executionProvenance.presentationContractId", "nomina-presentation-5c2-v1"); add("legacy-never-falls-forward", wrongLegacy, false, undefined, true)
const wrongConclusion = fresh("inverse-exact"); set(wrongConclusion, "outcome.report.coverage.uniquenessProven", false); set(wrongConclusion, "outcome.presentation.inverse.uniquenessProven", false); add("contradictory-conclusion", wrongConclusion, false)
for (const version of [1, 2]) { const downgrade = fresh(); set(downgrade, "schemaVersion", version); cases.push({ name: "compat-cannot-downgrade-envelope-" + version, payload: serializeStorageValue(downgrade), accepted: false }) }
const embeddedDowngrade = obj(JSON.parse(String(obj(arr(read("src-tauri/src/storage/fixtures-v2.json"))[0]).payload)) as J).value
set(embeddedDowngrade, "executionProvenance.producerId", descriptor.producerId); add("new-producer-cannot-hide-in-embedded-v2", embeddedDowngrade, false)
const hiddenEvaluation = fresh(); set(hiddenEvaluation, "effectiveContext.evaluationObservation", { basis: "report-not-attested", availability: "not-reported", reportedParameterSetVersions: null, reportedForwardPolicyVersions: null, reportedDirectEvaluations: null }); add("cannot-hide-reported-evaluation", hiddenEvaluation, false)
const unknownPolicy = fresh(); for (const path of ["outcome.report.provenance.policyVersions.0.version", "executionProvenance.policyVersions.0.version", "effectiveContext.evaluationObservation.reportedForwardPolicyVersions.0.version"]) set(unknownPolicy, path, "unreviewed"); add("unreviewed-reported-policy", unknownPolicy, false)
const phantomSmallest = fresh("inverse-approximate"); set(phantomSmallest, "outcome.report.smallestFound", clone(get(phantomSmallest, "outcome.report.recommended"))); set(phantomSmallest, "outcome.presentation.inverse.smallestFoundGross", get(phantomSmallest, "outcome.report.recommended.gross")); add("approximation-cannot-invent-smallest-exact", phantomSmallest, false)
const falseSmallest = fresh("inverse-exact"); set(falseSmallest, "outcome.report.coverage.minimumProven", false); set(falseSmallest, "outcome.presentation.inverse.minimumProven", false); for (const p of ["outcome.report.recommendationBasis", "outcome.presentation.inverse.recommendationBasis"]) set(falseSmallest, p, "smallest-verified-only"); set(falseSmallest, "outcome.report.smallestFound.gross", "14999.00"); set(falseSmallest, "outcome.presentation.inverse.smallestFoundGross", "14999.00"); add("smallest-found-must-be-observed-exact", falseSmallest, false)
for (const [name, value] of [["approximate-cannot-claim-minimum-basis", dwFixture()], ["no-candidate-has-no-recommendation-basis", emptyInverse()]] as [string, J][]) { for (const p of ["outcome.report.recommendationBasis", "outcome.presentation.inverse.recommendationBasis"]) set(value, p, "minimum-proven-in-domain"); add(name, value, false) }
const proofCount = fresh("inverse-exact"); set(proofCount, "outcome.report.metrics.certifiedClosures", 0); add("proof-row-count-contradiction", proofCount, false)
const proofBound = fresh("inverse-exact"), proofRow = arr(get(proofBound, "outcome.report.coverage.evidence")).find(x => obj(x).proof !== undefined)!
set(proofRow, "proof.netLower", "0.00"); add("proof-envelope-equation-contradiction", proofBound, false)
const hiddenBudget = clone(fiscal); set(hiddenBudget, "outcome.report.coverage.state", "fiscally-incomplete"); set(hiddenBudget, "outcome.presentation.inverse.coverage", "fiscally-incomplete"); set(hiddenBudget, "outcome.presentation.warnings", [...arr(get(hiddenBudget, "outcome.presentation.warnings")).filter(x => get(x, "code") !== "INVERSE_SEARCH_LIMITED"), { code: "INVERSE_FISCALLY_INCOMPLETE", message: "Hay condiciones fiscales irresueltas; no se presenta ausencia o unicidad sin demostración." }]); add("fiscal-label-cannot-hide-budget-pending", hiddenBudget, false)
const counterEncoding = serializeStorageValue(dwFixture()); cases.push({ name: "noncanonical-integer-encoding", payload: counterEncoding.replace('"directEvaluations":1894', '"directEvaluations":1894.0'), accepted: false })
cases.push({ name: "duplicate-key", payload: counterEncoding.replace('"schemaVersion":3', '"schemaVersion":3,"schemaVersion":3'), accepted: false })
cases.push({ name: "negative-zero-token", payload: serializeStorageValue(fresh()).replace('"utcOffsetMinutes":0', '"utcOffsetMinutes":-0'), accepted: false })
const maxDocument = fresh()
const originalBytes = Buffer.byteLength(serializeStorageValue(maxDocument))
const firstAssumption = String(get(maxDocument, "outcome.report.provenance.assumptions.0"))
set(maxDocument, "outcome.report.provenance.assumptions.0", firstAssumption + "Q".repeat(DOCUMENT_BYTES - originalBytes))
add("size-exact-N", maxDocument, true, "estimated")
set(maxDocument, "outcome.report.provenance.assumptions.0", String(get(maxDocument, "outcome.report.provenance.assumptions.0")) + "Q")
add("size-N-plus1", maxDocument, false)
for (const [version, path] of [["v1", "src-tauri/src/storage/fixtures.json"], ["v2", "src-tauri/src/storage/fixtures-v2.json"]]) for (const item of arr(read(path))) {
  const x = obj(item); cases.push({ name: version + "-" + String(x.name), payload: String(x.payload), accepted: true, historical: true })
}
for (const item of arr(read("docs/evidence/5d3b3/parity-v3.json"))) { const c = obj(item); if (c.accepted === false) cases.push({ name: "approved-reject-" + String(c.name), payload: String(c.payload), accepted: false, historical: true }) }
const results: { name: string; accepted: boolean; classification: string | null; error: string | null }[] = []
describe("CD-2 read-only documentary compatibility", () => {
  it.each(cases)("$name", c => {
    let accepted = false, classification: string | null = null, error: string | null = null
    try {
      const s = decodeFiscalSnapshot(c.payload); accepted = true
      if (!c.historical) { assertCompatSnapshot(s); classification = compatClassification(s) }
    } catch (e) { accepted = false; error = e instanceof Error ? e.stack ?? e.message : String(e) }
    results.push({ name: c.name, accepted, classification, error }); expect(accepted, error ?? c.name).toBe(c.accepted)
    if (accepted) expect(encodeFiscalSnapshot(decodeFiscalSnapshot(c.payload))).toBe(c.payload)
    if (c.classification && !c.historical) expect(classification).toBe(c.classification)
  })
  it("D-W2 original and historical producer remain untouched", () => {
    expect(createHash("sha256").update(readFileSync(new URL(dwPath, root))).digest("hex")).toBe("a9c89ebbba1ccf1cd655cc4b8cb326a85fb408bdd573d59319eadd70bb9b27fc")
    const s = dwFixture(); expect(get(s, "outcome")).toEqual(dw); expect(() => assertSnapshotV3(s)).toThrow()
    expect(get(s, "executionProvenance.authorizationObservation.kind")).toBe("not-issued-qa-fixture")
  })
  it("wire grammar variants are closed, but unsigned mutations are not trust", () => {
    for (const name of ["floor-reason-unsigned", "source-digest-unsigned", "supersedes-unsigned", "withdrawn-unsigned"]) {
      const c = cases.find(x => x.name === name)!; expect(() => assertCompatShape(obj(JSON.parse(c.payload) as J).value)).not.toThrow()
      expect(() => decodeFiscalSnapshot(c.payload)).toThrow()
    }
  })
  it("dispatch routes exact tuples only", () => {
    expect(documentaryRoute(old("direct-manual"))).toBe("historical-v3"); expect(documentaryRoute(fresh())).toBe("compat-v1")
    for (const name of ["mixed-ids", "unknown-producer", "unknown-provenance"]) expect(() => documentaryRoute(obj(JSON.parse(cases.find(x => x.name === name)!.payload) as J).value)).toThrow()
  })
  it("unchanged resource scanners retain exact depth and node limits", () => {
    const nesting = (n: number) => '{"value":{"schemaVersion":3,"v":' + "[".repeat(n) + "0" + "]".repeat(n) + "}}"
    expect(scanDocument(nesting(94)).depth).toBe(96); expect(() => scanDocument(nesting(95))).toThrow()
    const small = '{"value":{"schemaVersion":3,"v":[0,0]}}', n = scanDocument(small).nodes
    expect(scanDocument(small, { nodes: n }).nodes).toBe(n); expect(() => scanDocument(small, { nodes: n - 1 })).toThrow()
    expect(DOCUMENT_NODES).toBe(1572864)
    expect(Buffer.byteLength(cases.find(c => c.name === "size-exact-N")!.payload)).toBe(3145728)
    expect(Buffer.byteLength(cases.find(c => c.name === "size-N-plus1")!.payload)).toBe(3145729)
  })
})
afterAll(() => {
  mkdirSync(out, { recursive: true })
  if (existsSync(new URL("ts-results.json", out))) {
    mkdirSync(new URL("attempts/", out), { recursive: true })
    writeFileSync(new URL(`attempts/ts-${Date.now()}.json`, out), readFileSync(new URL("ts-results.json", out)))
  }
  writeFileSync(new URL("cases.json", out), JSON.stringify(cases, null, 2) + "\n")
  writeFileSync(new URL("ts-results.json", out), JSON.stringify({ results, failures: results.filter((r, i) => r.accepted !== cases[i].accepted), newNativeAuthority: false }, null, 2) + "\n")
})
