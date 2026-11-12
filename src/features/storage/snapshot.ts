import type { CalculationState } from "../calculator/calculation-controller"
import type { FiscalExecutionMetadata } from "../calculator/date-policy"
import type { FiscalCapture, FiscalOutcome } from "../calculator/fiscal-adapter"
import identity from "./build-identity.json"
import { deserializeStorageValue, freezeStorageValue, serializeStorageValue } from "./serialization"
import { assertAuthorizedProvenance, assertDocumentExecutionMetadata, executionReceipt, type ExecutionDocumentProvenance, type FiscalIdentityV2 } from "../documents/provenance"
import type { StoredFiscalSnapshotV3 } from "../documents/contracts-v3"
import { assertSnapshotV3 } from "../documents/provenance-v3"
import { scanDocument,preflightDocumentValue } from "../documents/budget-v3"
import { documentaryRoute, assertCompatEnvelopeVersion } from "./document-dispatch"
import { assertCompatSnapshot } from "../documents/provenance-compat-v1"
import type { StoredCompatSnapshot } from "../documents/contracts-compat-v1"
import { EMBEDDED_DOCUMENT_REGISTRY } from "../documents/embedded-document-registry"

export const SNAPSHOT_VERSION = 2 as const
export const MAX_SNAPSHOT_BYTES = 3 * 1024 * 1024
export const storageBuildIdentity = freezeStorageValue(identity)
export type StoredFiscalSnapshotV1 = Readonly<{
  schemaVersion: 1
  completion: "result"
  executionId: string
  capture: FiscalCapture
  execution: FiscalExecutionMetadata
  outcome: FiscalOutcome
  versions: Readonly<{ application: string; engine: string }>
  fiscalPackage: Readonly<{ id: string; version: string; sha256: string }>
}>
export type StoredFiscalSnapshotV2 = Readonly<Omit<StoredFiscalSnapshotV1, "schemaVersion" | "fiscalPackage"> & {
  schemaVersion: 2
  fiscalPackage: FiscalIdentityV2
  executionProvenance: ExecutionDocumentProvenance
}>
export type StoredFiscalSnapshot = StoredFiscalSnapshotV1 | StoredFiscalSnapshotV2 | StoredFiscalSnapshotV3 | StoredCompatSnapshot
export type HistoryClassification = "exact" | "approximate" | "conditioned" | "limited" | "estimated"

/** Debe llamarse en la frontera segura de 5B.8: lee el estado ACTUAL, nunca toma
 * el resultado de una promesa antigua. El ID UUID se asigna una vez por ejecución. */
export function createStoredFiscalSnapshot({ getCurrentState, expectedRequestId, executionId, execution }: {
  getCurrentState: () => CalculationState; expectedRequestId: number; executionId: string; execution: FiscalExecutionMetadata
}): StoredFiscalSnapshot {
  const state = getCurrentState()
  if (state.phase !== "result" || state.requestId !== expectedRequestId || execution.requestId !== expectedRequestId || !state.snapshot || !state.outcome || !execution.completedAt) throw new Error("STALE_OR_INCOMPLETE_EXECUTION")
  const { report, presentation } = state.outcome
  const usable = report.operation === "gross-to-net" ? report.status === "estimated" && report.complete : report.recommended !== null && report.recommendedForwardResult !== null && report.match !== "none" && report.metrics.stopReason !== "aborted"
  if (!usable || presentation.values.netSalary === null || presentation.values.grossSalary === null) throw new Error("UNUSABLE_FISCAL_RESULT")
  if (state.executionProvenance) {
    const provenance = executionReceipt(state)
    if (!provenance || provenance !== state.executionProvenance) throw new Error("UNBOUND_EXECUTION_RECEIPT")
    assertDocumentExecutionMetadata(state,execution)
    assertAuthorizedProvenance(provenance)
    const snapshot: StoredFiscalSnapshotV2 = { schemaVersion: SNAPSHOT_VERSION, completion: "result", executionId,
      capture: state.snapshot, execution, outcome: state.outcome, versions: provenance.versions, fiscalPackage: provenance.fiscalPackage, executionProvenance: provenance }
    return decodeFiscalSnapshot(encodeFiscalSnapshot(snapshot))
  }
  if (execution.packageId !== identity.fiscalPackage.id || report.provenance.fiscalPackageVersion !== identity.fiscalPackage.version) throw new Error("FISCAL_PACKAGE_MISMATCH")
  // Compatibility constructor for legacy fixtures/callers. Productive contextual
  // executions always carry a receipt and use the v2 branch above.
  const value: StoredFiscalSnapshotV1 = {
    schemaVersion: 1, completion: "result", executionId,
    capture: state.snapshot, execution, outcome: state.outcome,
    versions: { application: identity.applicationVersion, engine: identity.engineVersion },
    fiscalPackage: { id: identity.fiscalPackage.id, version: identity.fiscalPackage.version, sha256: identity.fiscalPackage.sha256 },
  }
  return decodeFiscalSnapshot(encodeFiscalSnapshot(value))
}

export function encodeFiscalSnapshot(snapshot: StoredFiscalSnapshot): string {
  if(snapshot.schemaVersion===3)preflightDocumentValue(snapshot)
  validateSnapshotEnvelope(snapshot)
  const text = serializeStorageValue(snapshot)
  if(snapshot.schemaVersion===3)scanDocument(text)
  if (new TextEncoder().encode(text).length > MAX_SNAPSHOT_BYTES) throw new Error("SNAPSHOT_TOO_LARGE")
  return text
}
export function decodeFiscalSnapshot(text: string): StoredFiscalSnapshot {
  scanDocument(text)
  if (new TextEncoder().encode(text).length > MAX_SNAPSHOT_BYTES) throw new Error("SNAPSHOT_TOO_LARGE")
  const value = deserializeStorageValue(text)
  validateSnapshotEnvelope(value)
  if (value && typeof value === "object" && "schemaVersion" in value && value.schemaVersion === 3
    && documentaryRoute(value) === "compat-v1" && serializeStorageValue(value) !== text) throw new Error("INVALID_COMPAT_ENCODING")
  return freezeStorageValue(value)
}
function validateSnapshotEnvelope(value: unknown): asserts value is StoredFiscalSnapshot {
  assertCompatEnvelopeVersion(value)
  const s = value as StoredFiscalSnapshot | null
  if(s&&typeof s.schemaVersion==='number'&&![1,2,3].includes(s.schemaVersion))throw new Error('INCOMPATIBLE_SNAPSHOT_VERSION')
  if (!s || ![1,2,3].includes(s.schemaVersion) || s.completion !== "result" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s.executionId)) throw new Error("INVALID_SNAPSHOT_ENVELOPE")
  if (!s.capture || s.capture.area !== "general-zone" || typeof s.capture.form.amount !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(s.capture.form.amount)) throw new Error("INVALID_SNAPSHOT_CAPTURE")
  if (!s.execution?.completedAt || s.execution.fiscalDate !== s.capture.form.effectiveDate || !["automatic", "manual"].includes(s.execution.referenceMode)) throw new Error("INVALID_SNAPSHOT_EXECUTION")
  if (!s.outcome || (s.capture.form.mode === "gross-to-net") !== (s.outcome.kind === "direct") || !s.versions?.application || !s.versions.engine || !/^[a-f0-9]{64}$/.test(s.fiscalPackage?.sha256)) throw new Error("INVALID_SNAPSHOT_PROVENANCE")
  if (s.schemaVersion === 2) assertSnapshotV2(s)
  if (s.schemaVersion === 3) {
    if (documentaryRoute(s) === "historical-v3") assertSnapshotV3(s)
    else assertCompatSnapshot(s)
  }
}

export function assertSnapshotV2(s: StoredFiscalSnapshotV2): void {
  const p = s.executionProvenance, r = p?.resolution
  if (!p || p.schemaVersion !== 1 || p.reportContractId !== "standard-payroll-2026-contextual-v2" || p.presentationContractId !== "nomina-presentation-5c2-v1") throw new Error("INCOMPATIBLE_DOCUMENT_CONTRACT")
  EMBEDDED_DOCUMENT_REGISTRY.assertProvenance(p, "read")
  const same = (a: unknown, b: unknown) => serializeStorageValue(a) === serializeStorageValue(b)
  if (!same(s.versions, p.versions) || !same(s.fiscalPackage, p.fiscalPackage) || s.execution.packageId !== p.fiscalPackage.id
    || s.capture.form.effectiveDate !== r.fiscalDate || s.execution.fiscalDate !== r.fiscalDate || s.capture.form.period !== r.periodicity
    || s.capture.form.mode !== r.operation || s.outcome.report.operation !== r.operation || s.outcome.report.provenance.fiscalPackageVersion !== s.fiscalPackage.version
    || r.exercise !== s.fiscalPackage.exercise || Number(r.fiscalDate.slice(0,4)) !== r.exercise || s.fiscalPackage.containerIdentity !== null
    || p.effectiveParameterSets.length !== 7 || new Set(p.effectiveParameterSets.map(set => set.role)).size !== 7
    || p.effectiveParameterSets.some(set => set.effectiveFrom > r.fiscalDate || (set.effectiveThrough !== null && set.effectiveThrough < r.fiscalDate))) throw new Error("FISCAL_PACKAGE_MISMATCH")
  const report = s.outcome.report
  if (report.operation === "gross-to-net") {
    if (report.retention.policyVersion !== r.contextualPolicyId || !same(report.retention.assessment?.context, p.requestScenario)) throw new Error("CONTEXTUAL_PROVENANCE_MISMATCH")
  } else if (!same(report.provenance.retentionContext, p.requestScenario) || report.provenance.policyVersion !== "standard-net-to-gross-2026-contextual-partitions-v2") throw new Error("CONTEXTUAL_PROVENANCE_MISMATCH")
}
