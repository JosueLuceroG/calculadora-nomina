import { afterEach, expect, it, vi } from "vitest"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import descriptor from "../infrastructure/fiscal/document-producer.json"
import originals from "../../docs/evidence/5d2b/originals-v2.json"
import protectedFiles from "../../docs/r2-simple2-protected.json"
import nativeOriginals from "../../src-tauri/src/storage/fixtures-v2.json"
import { createEmbeddedDocumentRegistry, CURRENT_EMBEDDED_PRODUCER, EMBEDDED_DOCUMENT_REGISTRY } from "../features/documents/embedded-document-registry"
import { createEmbedded2026Provider } from "../infrastructure/fiscal/embedded-2026-provider"
import { createEmbeddedFiscalRegistry2026 } from "../infrastructure/fiscal/package-registry"
import { ENGINE_FISCAL_CAPABILITIES } from "../infrastructure/fiscal/engine-capabilities"
import { resolveFiscalExecution } from "../domain/fiscal-runtime/resolver"
import type { FiscalPackageRegistrySnapshot, FiscalResolutionRequest, VerifiedFiscalPackageRef } from "../domain/fiscal-runtime/contracts"
import { decodeFiscalSnapshot, encodeFiscalSnapshot } from "../features/storage/snapshot"
import { serializeStorageValue } from "../features/storage/serialization"
import { assertHistoricalPresentation } from "../features/history/historical-snapshot"
import { createInitialForm } from "../features/calculator/form"

const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex")
const request: FiscalResolutionRequest = { fiscalDate: "2026-02-01", periodicity: "monthly", operation: "gross-to-net", simulationProfileId: descriptor.authorization.simulationProfileId,
  ruleProfileId: descriptor.authorization.ruleProfileId, contextualPolicyId: descriptor.authorization.contextualPolicyId, requiredCapabilities: ["direct"] }

/** Metadata-only update fixture: SAME 2026 numeric tables and engine, isolated
 * test-only pins. These labels/hashes are not verified fiscal data or a release. */
function updateFixture() {
  const next = structuredClone(descriptor)
  next.producerId = "fixture-only-simple2-producer"
  next.versions.application = "0.2.0-fixture"
  next.manifest.packageId = next.manifest.parameterVersion = "fixture-only-2026-revision"
  next.manifest.contentIdentity.sha256 = "f".repeat(64)
  next.authorization.content = { packageId: next.manifest.packageId, parameterVersion: next.manifest.parameterVersion, scheme: next.manifest.contentIdentity.scheme, sha256: next.manifest.contentIdentity.sha256 }
  next.packageRegistryRevision = "fixture-only-package-registry"
  next.capabilityRegistryVersion = "fixture-only-capabilities"
  const provider = createEmbedded2026Provider()
  const manifest = { ...provider.manifest, packageId: next.manifest.packageId, parameterVersion: next.manifest.parameterVersion,
    contentIdentity: { ...provider.manifest.contentIdentity, sha256: next.manifest.contentIdentity.sha256 } }
  const reference = Object.freeze({ ...provider.reference, manifest }) as VerifiedFiscalPackageRef
  const registry = Object.freeze<FiscalPackageRegistrySnapshot>({
    revision: next.packageRegistryRevision, entries: Object.freeze([{ manifest, reference }]), owns: ref => ref === reference,
    read: (ref, date, period) => {
      if (ref !== reference) return { ok: false, code: "PACKAGE_REFERENCE_UNVERIFIED", cause: "FOREIGN_PACKAGE_REFERENCE" }
      const data = provider.read(provider.reference, date, period)
      return data.ok ? { ...data, engineContext: { ...data.engineContext, fiscalPackageVersion: next.manifest.parameterVersion } } : data
    },
  })
  return { next, registry, capabilities: { registryVersion: next.capabilityRegistryVersion, authorizations: [next.authorization] } as typeof ENGINE_FISCAL_CAPABILITIES,
    documents: createEmbeddedDocumentRegistry([descriptor, CURRENT_EMBEDDED_PRODUCER, next], [next.producerId]) }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.doUnmock("../features/documents/embedded-document-registry")
  vi.doUnmock("../infrastructure/fiscal/package-registry")
  vi.doUnmock("../infrastructure/fiscal/engine-capabilities")
  vi.resetModules()
})

it("SIMPLE-2: archivos protegidos conservan las huellas previas; corpus nativo idéntico", () => {
  for (const [path, hash] of Object.entries(protectedFiles.files)) expect(sha(readFileSync(new URL(`../../${path}`, import.meta.url))), path).toBe(hash)
  expect(originals.map(({ name, payload }) => ({ name, payload }))).toEqual(nativeOriginals)
})

it("SIMPLE-2: la emisión real actual conserva productor, revisión, motor y Snapshot v2", async () => {
  const { createContextualCalculationController } = await import("../features/calculator/calculation-controller")
  const storage = await import("../features/storage/snapshot")
  const provenance = await import("../features/documents/provenance")
  const controller = createContextualCalculationController()
  try {
    await controller.submit({ area: "general-zone", form: { ...createInitialForm(), mode: "gross-to-net", amount: "15000.50", period: "monthly", effectiveDate: "2026-02-01" } }).completion
    const state = controller.getState(), original = decodeFiscalSnapshot(originals[0].payload)
    expect(state.phase).toBe("result")
    const execution = { ...original.execution, requestId: state.requestId }
    provenance.recordDocumentExecutionMetadata(state, execution)
    const snapshot = storage.createStoredFiscalSnapshot({ getCurrentState: controller.getState, expectedRequestId: state.requestId, executionId: "00000000-0000-4000-8000-000000002001", execution })
    expect(snapshot.schemaVersion).toBe(2)
    expect(snapshot.versions).toEqual(EMBEDDED_DOCUMENT_REGISTRY.active[0].versions)
    expect(snapshot.fiscalPackage).toEqual(original.fiscalPackage)
    expect(snapshot.outcome.presentation.values).toEqual(original.outcome.presentation.values)
  } finally { controller.dispose() }
})

it.each(originals)("SIMPLE-2: $name conserva wire, checksum, revisión, valores y clasificación", item => {
  const snapshot = decodeFiscalSnapshot(item.payload)
  expect(snapshot.schemaVersion).toBe(2)
  expect(sha(item.payload)).toBe(item.checksum)
  expect(encodeFiscalSnapshot(snapshot)).toBe(item.payload)
  expect(assertHistoricalPresentation(snapshot)).toBe(snapshot)
  expect(snapshot.fiscalPackage.version).toBe(descriptor.manifest.parameterVersion)
  if (snapshot.schemaVersion !== 2) throw Error("Expected v2")
  expect(EMBEDDED_DOCUMENT_REGISTRY.forRead(snapshot.executionProvenance).producerId).toBe(CURRENT_EMBEDDED_PRODUCER.producerId)
  expect(Object.isFrozen(snapshot.outcome.report)).toBe(true)
})

it("SIMPLE-2: actualización aislada calcula con la revisión nueva y exporta el histórico original sin motor ni selector", async () => {
  const fixture = updateFixture(), item = originals.find(row => row.name === "direct-manual")!
  const before = decodeFiscalSnapshot(item.payload), originalBytes = item.payload
  const previous = await import("../features/documents/embedded-document-registry")
  vi.doMock("../features/documents/embedded-document-registry", () => ({ ...previous, EMBEDDED_DOCUMENT_REGISTRY: fixture.documents }))
  vi.doMock("../infrastructure/fiscal/package-registry", () => ({ createEmbeddedFiscalRegistry2026: () => fixture.registry }))
  vi.doMock("../infrastructure/fiscal/engine-capabilities", () => ({ ENGINE_FISCAL_CAPABILITIES: fixture.capabilities }))
  vi.resetModules()
  const { createContextualCalculationController } = await import("../features/calculator/calculation-controller")
  const storage = await import("../features/storage/snapshot")
  const provenance = await import("../features/documents/provenance")
  const controller = createContextualCalculationController()
  try {
    const submission = controller.submit({ area: "general-zone", form: { ...createInitialForm(), mode: "gross-to-net", amount: "15000.50", period: "monthly", effectiveDate: "2026-02-01" } })
    await submission.completion
    const state = controller.getState()
    expect(submission.accepted).toBe(true); expect(state.phase).toBe("result")
    expect(state.executionProvenance?.fiscalPackage.version).toBe(fixture.next.manifest.parameterVersion)
    expect(state.executionProvenance?.producerId).toBe(fixture.next.producerId)
    expect(state.outcome?.report.provenance.fiscalPackageVersion).toBe(fixture.next.manifest.parameterVersion)
    const execution = { ...before.execution, requestId: state.requestId, packageId: fixture.next.manifest.packageId }
    provenance.recordDocumentExecutionMetadata(state, execution)
    const current = storage.createStoredFiscalSnapshot({ getCurrentState: controller.getState, expectedRequestId: state.requestId, executionId: "00000000-0000-4000-8000-000000002002", execution })
    expect(current.schemaVersion).toBe(2)
    expect(current.versions.application).toBe("0.2.0-fixture")
    expect(current.versions.engine).toBe(before.versions.engine)
    expect(current.fiscalPackage.version).not.toBe(before.fiscalPackage.version)
    expect(current.outcome.presentation.values).toEqual(before.outcome.presentation.values)
    // A known reader is not a current writer, even though both use Snapshot v2.
    if (before.schemaVersion !== 2) throw Error("Expected v2")
    expect(() => provenance.assertAuthorizedProvenance(before.executionProvenance)).toThrow("UNAUTHORIZED")

    const direct = vi.spyOn(await import("../domain/payroll/gross-to-net"), "calculateStandardEstimatedGrossToNet").mockImplementation(() => { throw Error("Historical recalculation") })
    const inverse = vi.spyOn(await import("../domain/payroll/net-to-gross"), "calculateStandardEstimatedNetToGross").mockImplementation(() => { throw Error("Historical inverse recalculation") })
    const selector = vi.spyOn(await import("../infrastructure/fiscal/2026"), "selectFiscalParameters2026").mockImplementation(() => { throw Error("Historical active selection") })
    const resolver = vi.spyOn(await import("../domain/fiscal-runtime/resolver"), "resolveFiscalExecution").mockImplementation(() => { throw Error("Historical resolution") })
    const { createNativeStorageApi } = await import("../features/storage/storage-api")
    const { documentFromPersisted } = await import("../features/pdf/persisted-document")
    const { createPdfExportController } = await import("../features/pdf/export-controller")
    const { renderSalaryReport } = await import("../features/pdf/render-report")
    const { originalDocumentIdentity } = await import("../features/documents/original-document")
    const invoke = vi.fn().mockResolvedValue(originalBytes)
    const api = createNativeStorageApi(invoke)
    const recovered = await api.get(before.executionId)
    expect(recovered).toEqual(before)
    expect(originalDocumentIdentity(recovered!)?.sha256).toBe(item.checksum)
    expect(storage.encodeFiscalSnapshot(recovered!)).toBe(originalBytes)
    const model = await documentFromPersisted(before.executionId, item.checksum, api)
    expect(model.original.outcome).toEqual(before.outcome)
    expect(model.original.executionProvenance).toEqual(before.executionProvenance)
    expect(model.original.versions).toEqual(before.versions)
    expect(model.original.fiscalPackage).toEqual(before.fiscalPackage)
    const fonts = { regular: new Uint8Array(readFileSync(new URL("../features/pdf/assets/DejaVuSans.ttf", import.meta.url))), bold: new Uint8Array(readFileSync(new URL("../features/pdf/assets/DejaVuSans-Bold.ttf", import.meta.url))) }
    const directory = mkdtempSync(join(tmpdir(), "opencode", "simple2-update-")), pdfPath = join(directory, "historical-original.pdf")
    const save = vi.fn(async (bytes: Uint8Array) => { writeFileSync(pdfPath, bytes); return { status: "saved" as const, path: pdfPath, bytes: bytes.length, sha256: sha(bytes) } })
    const exporter = createPdfExportController({ clock: () => new Date("2026-11-05T12:00:00.000Z"), newId: () => "00000000-0000-4000-8000-000000002003", loadRuntime: async () => ({ render: report => renderSalaryReport(report, fonts) }), save })
    expect(await exporter.exportPdf({ source: "history", getDocument: () => model, isCurrent: () => true })).toBe(true)
    expect(exporter.getState().phase).toBe("saved")
    const saved = readFileSync(pdfPath)
    expect(saved.subarray(0, 8).toString()).toBe("%PDF-1.3")
    expect(sha(saved)).toBe(sha(save.mock.calls[0][0]))
    expect(serializeStorageValue(recovered)).toBe(originalBytes)
    for (const spy of [direct, inverse, selector, resolver]) expect(spy).not.toHaveBeenCalled()
    expect(invoke.mock.calls.every(call => call[0] === "storage_get")).toBe(true)
    writeFileSync(join(directory, "verification.json"), JSON.stringify({ simple2: "PASS", fixtureOnly: true, currentApplication: current.versions.application, currentRevision: current.fiscalPackage.version,
      historicalRevision: before.fiscalPackage.version, historicalChecksum: item.checksum, historicalAmounts: model.amounts, pdfPath, pdfSha256: sha(saved), fiscalCallsDuringReadAndExport: 0 }, null, 2))
  } finally { controller.dispose() }
}, 30000)

it("SIMPLE-2: selección activa única, sin lectores históricos ni fallback de compatibilidad", () => {
  const fixture = updateFixture()
  expect(fixture.documents.descriptors).toHaveLength(3); expect(fixture.documents.active).toHaveLength(1)
  expect(fixture.registry.entries).toHaveLength(1)
  const resolved = resolveFiscalExecution(request, fixture.registry, fixture.capabilities)
  expect(resolved.status).toBe("resolved")
  if (resolved.status !== "resolved") throw Error("Fixture resolution rejected")
  expect(fixture.documents.forExecution(resolved.context).producerId).toBe(fixture.next.producerId)
  expect(resolveFiscalExecution(request, fixture.registry, ENGINE_FISCAL_CAPABILITIES)).toMatchObject({ status: "rejected", code: "PACKAGE_CONTENT_NOT_AUTHORIZED" })
  expect(resolveFiscalExecution({ ...request, fiscalDate: "2027-01-01" }, fixture.registry, fixture.capabilities)).toMatchObject({ status: "rejected", code: "EXERCISE_PACKAGE_MISSING" })
  expect(resolveFiscalExecution({ ...request, ruleProfileId: "unknown" }, fixture.registry, fixture.capabilities)).toMatchObject({ status: "rejected", code: "ENGINE_RULE_PROFILE_UNSUPPORTED" })
  const overlapping = { ...fixture.registry, entries: [...fixture.registry.entries, ...createEmbeddedFiscalRegistry2026().entries] }
  expect(resolveFiscalExecution(request, overlapping, fixture.capabilities)).toMatchObject({ status: "rejected", code: "AMBIGUOUS_FISCAL_PACKAGES" })
  expect(() => createEmbeddedDocumentRegistry([descriptor, fixture.next], [descriptor.producerId, fixture.next.producerId])).toThrow("AMBIGUOUS")
  expect(() => createEmbeddedDocumentRegistry([descriptor], ["unknown"])).toThrow("UNKNOWN_ACTIVE")
  expect(() => createEmbeddedDocumentRegistry([descriptor, descriptor], [descriptor.producerId])).toThrow("AMBIGUOUS")
})

it.each(["producerId", "reportContractId", "presentationContractId"])("SIMPLE-2: descriptor desconocido %s no usa lector actual como fallback", field => {
  const original = decodeFiscalSnapshot(originals[0].payload)
  const changed = structuredClone(original)
  if (changed.schemaVersion !== 2) throw Error("Expected v2")
  const value = { ...changed, executionProvenance: { ...changed.executionProvenance, [field]: "unknown" } }
  expect(() => decodeFiscalSnapshot(serializeStorageValue(value))).toThrow("INCOMPATIBLE_DOCUMENT_CONTRACT")
  expect(encodeFiscalSnapshot(original)).toBe(originals[0].payload)
})

it("SIMPLE-2: revisión, hash o versión de aplicación alterados se rechazan sin normalizar el original", () => {
  for (const field of ["version", "sha256"] as const) {
    const changed = structuredClone(decodeFiscalSnapshot(originals[0].payload))
    if (changed.schemaVersion !== 2) throw Error("Expected v2")
    const fiscalPackage = { ...changed.fiscalPackage, [field]: field === "sha256" ? "f".repeat(64) : "unknown" }
    const value = { ...changed, fiscalPackage, executionProvenance: { ...changed.executionProvenance, fiscalPackage } }
    expect(() => decodeFiscalSnapshot(serializeStorageValue(value))).toThrow("UNAUTHORIZED")
  }
  const changed = structuredClone(decodeFiscalSnapshot(originals[0].payload))
  if (changed.schemaVersion !== 2) throw Error("Expected v2")
  const versions = { ...changed.versions, application: "unknown" }
  expect(() => decodeFiscalSnapshot(serializeStorageValue({ ...changed, versions, executionProvenance: { ...changed.executionProvenance, versions } }))).toThrow("UNAUTHORIZED")
})
