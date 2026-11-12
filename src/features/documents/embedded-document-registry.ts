import historical2026 from "../../infrastructure/fiscal/document-producer.json"
import policy from "../../infrastructure/fiscal/embedded-document-policy.json"
import release from "../../infrastructure/fiscal/document-producer-0.1.1-rc.1.json"
import type { ExecutionFiscalContext } from "../../domain/fiscal-runtime/contracts"
import { freezeStorageValue, serializeStorageValue } from "../storage/serialization"
import type { ExecutionDocumentProvenance } from "./provenance"

type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T
export type EmbeddedDocumentProducer = Immutable<typeof historical2026>
const same = (a: unknown, b: unknown) => serializeStorageValue(a) === serializeStorageValue(b)

/** Compiled metadata only, never a receipt, calculator registry or IPC authority.
 * Keep every known descriptor unchanged; append new producers on future releases.
 * The factory also permits isolated update fixtures without activating their data. */
export function createEmbeddedDocumentRegistry(known: readonly EmbeddedDocumentProducer[], activeProducerIds: readonly string[]) {
  const descriptors = freezeStorageValue(structuredClone(known))
  if (new Set(descriptors.map(d => d.producerId)).size !== descriptors.length
    || new Set(activeProducerIds).size !== activeProducerIds.length) throw new Error("AMBIGUOUS_DOCUMENT_PRODUCERS")
  const active = Object.freeze(activeProducerIds.map(id => {
    const d = descriptors.find(item => item.producerId === id)
    if (!d) throw new Error("UNKNOWN_ACTIVE_DOCUMENT_PRODUCER")
    return d
  }))
  for (const [i, a] of active.entries()) for (const b of active.slice(i + 1)) {
    if (a.manifest.exercise === b.manifest.exercise && a.authorization.simulationProfileId === b.authorization.simulationProfileId
      && a.manifest.supportedDates.from <= b.manifest.supportedDates.through && b.manifest.supportedDates.from <= a.manifest.supportedDates.through) throw new Error("AMBIGUOUS_DOCUMENT_PRODUCERS")
  }
  function forRead(p: ExecutionDocumentProvenance) {
    const d = descriptors.find(item => item.producerId === p.producerId)
    if (!d || p.schemaVersion !== 1 || p.reportContractId !== d.reportContractId || p.presentationContractId !== d.presentationContractId) throw new Error("INCOMPATIBLE_DOCUMENT_CONTRACT")
    return d
  }
  function assertProvenance(p: ExecutionDocumentProvenance, purpose: "read" | "write") {
    const d = forRead(p), m = d.manifest, r = p.resolution
    if ((purpose === "write" && !active.includes(d))
      || !same(p.versions, d.versions) || !same(p.authorization, d.authorization) || !same(p.sourceCatalog, m.sources) || !same(p.ruleSources, d.ruleSources)
      || !same(p.fiscalPackage, { id: m.packageId, version: m.parameterVersion, sha256: m.contentIdentity.sha256, hashScheme: m.contentIdentity.scheme, exercise: m.exercise,
        supportedDates: m.supportedDates, parameterSchemaId: m.parameterSchemaId, containerIdentity: null,
        verification: { origin: "embedded", data: "source-verified", basis: "embedded-build", integrity: "build-asserted" } })
      || r.exercise !== m.exercise || r.fiscalDate < m.supportedDates.from || r.fiscalDate > m.supportedDates.through
      || r.simulationProfileId !== d.authorization.simulationProfileId || r.ruleProfileId !== d.authorization.ruleProfileId || r.contextualPolicyId !== d.authorization.contextualPolicyId
      || r.packageRegistryRevision !== d.packageRegistryRevision || r.capabilityRegistryVersion !== d.capabilityRegistryVersion
      || !d.authorization.periodicities.includes(r.periodicity) || !["gross-to-net", "net-to-gross"].includes(r.operation)) throw new Error("UNAUTHORIZED_EXECUTION_PROVENANCE")
    const expected = d.effectiveSeries.filter(set => set.effectiveFrom <= r.fiscalDate && (set.effectiveThrough === null || r.fiscalDate <= set.effectiveThrough) && (set.role !== "isrTariff" || set.key === r.periodicity))
    if (!same(p.effectiveParameterSets, expected) || p.requestScenario.kind !== "contextual-retention-2026-v2") throw new Error("INCONSISTENT_EFFECTIVE_PARAMETERS")
  }
  function forExecution(context: ExecutionFiscalContext) {
    const matches = active.filter(d => same(d.manifest, context.package.manifest) && same(d.authorization, context.authorization)
      && d.packageRegistryRevision === context.packageRegistryRevision && d.capabilityRegistryVersion === context.capabilityRegistryVersion)
    if (matches.length !== 1) throw new Error("UNAUTHORIZED_EXECUTION_PROVENANCE")
    return matches[0]
  }
  return Object.freeze({ descriptors, active, forRead, forExecution, assertProvenance })
}

// This immutable historical descriptor retains its original path and bytes.
// Historical readers are NOT added to package-registry.ts or engine capabilities.
// App-only release: project from a pinned immutable base, changing no fiscal
// content or document contract. The native reader also checks the base digest.
if (release.baseProducerId !== historical2026.producerId || release.producerId === historical2026.producerId) throw new Error("INCOMPATIBLE_DOCUMENT_PRODUCER_BASE")
export const CURRENT_EMBEDDED_PRODUCER = freezeStorageValue({ ...historical2026, producerId: release.producerId,
  versions: { ...historical2026.versions, application: release.applicationVersion } })
export const EMBEDDED_DOCUMENT_REGISTRY = createEmbeddedDocumentRegistry([historical2026, CURRENT_EMBEDDED_PRODUCER], policy.activeProducerIds)
