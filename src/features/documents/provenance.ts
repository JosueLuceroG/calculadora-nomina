import type { ExecutionFiscalContext } from "../../domain/fiscal-runtime/contracts"
import type { FiscalParameterSet, FiscalSource } from "../../domain/payroll/contracts"
import type { MinimumWageMonthlyScenario } from "../../domain/payroll/gross-to-net-contracts"
import { EMBEDDED_DOCUMENT_REGISTRY } from "./embedded-document-registry"
import { freezeStorageValue } from "../storage/serialization"
import type { FiscalExecutionMetadata } from "../calculator/date-policy"

export const DOCUMENT_PRODUCER = EMBEDDED_DOCUMENT_REGISTRY.active[0]
export type EffectiveParameterMetadata = Readonly<{
  role: string; id: string; version: string; kind: string; key: string; effectiveFrom: string; effectiveThrough: string | null
  validation: string; validationScope: string; sources: readonly FiscalSource[]
}>
export type FiscalIdentityV2 = Readonly<{
  id: string; version: string; sha256: string; hashScheme: "legacy-registry-v1"; exercise: number
  supportedDates: Readonly<{ from: string; through: string }>; parameterSchemaId: string; containerIdentity: null
  verification: Readonly<{ origin: "embedded"; data: "source-verified"; basis: "embedded-build"; integrity: "build-asserted" }>
}>
export type ExecutionDocumentProvenance = Readonly<{
  schemaVersion: 1; producerId: string; reportContractId: string; presentationContractId: string
  versions: Readonly<{ application: string; engine: string }>; fiscalPackage: FiscalIdentityV2
  resolution: Readonly<{
    exercise: number; fiscalDate: string; periodicity: string; operation: string; simulationProfileId: string; ruleProfileId: string; contextualPolicyId: string
    packageRegistryRevision: string; capabilityRegistryVersion: string
  }>
  authorization: ExecutionFiscalContext["authorization"]
  requestScenario: MinimumWageMonthlyScenario
  effectiveParameterSets: readonly EffectiveParameterMetadata[]
  sourceCatalog: readonly FiscalSource[]
  ruleSources: Readonly<{ subsidy: readonly FiscalSource[]; retention: readonly FiscalSource[] }>
}>
const roles = { isrTariff: "isrTariffs", uma: "uma", minimumWages: "minimumWages", subsidy: "subsidy", imssConstants: "imssConstants", contractualDivisors: "contractualDivisors", laborBenefitMinima: "laborBenefitMinima" } as const
function metadata(role: string, set: FiscalParameterSet<unknown>): EffectiveParameterMetadata {
  const { data: _, ...rest } = set
  return { role, ...rest }
}
/** Projection of the already selected execution, never a lookup of an active package. */
export function documentProvenance(context: ExecutionFiscalContext, scenario: MinimumWageMonthlyScenario): ExecutionDocumentProvenance {
  const descriptor = EMBEDDED_DOCUMENT_REGISTRY.forExecution(context)
  const manifest = context.package.manifest
  const effectiveParameterSets = Object.entries(roles).map(([role, key]) => {
    const set = context.engineContext[key].find(item => context.selectedParameterSets.some(selected => selected.id === item.id && selected.version === item.version))
    if (!set) throw new Error("INCOMPLETE_EXECUTION_PROVENANCE")
    return metadata(role, set)
  })
  const value: ExecutionDocumentProvenance = {
    schemaVersion: 1, producerId: descriptor.producerId, reportContractId: descriptor.reportContractId, presentationContractId: descriptor.presentationContractId,
    versions: descriptor.versions,
    fiscalPackage: { id: manifest.packageId, version: manifest.parameterVersion, sha256: manifest.contentIdentity.sha256, hashScheme: manifest.contentIdentity.scheme,
      exercise: manifest.exercise, supportedDates: manifest.supportedDates, parameterSchemaId: manifest.parameterSchemaId, containerIdentity: null,
      verification: { origin: context.package.origin, ...context.package.verification } },
    resolution: { exercise: context.exercise, fiscalDate: context.fiscalDate, periodicity: context.periodicity, operation: context.operation,
      simulationProfileId: context.simulationProfileId, ruleProfileId: context.ruleProfileId, contextualPolicyId: context.contextualPolicyId,
      packageRegistryRevision: context.packageRegistryRevision, capabilityRegistryVersion: context.capabilityRegistryVersion },
    authorization: context.authorization, requestScenario: scenario, effectiveParameterSets, sourceCatalog: manifest.sources,
    ruleSources: { subsidy: context.engineContext.subsidyRulesSources, retention: context.engineContext.retentionRuleSources },
  }
  assertAuthorizedProvenance(value)
  return freezeStorageValue(structuredClone(value))
}
/** Compiled producer descriptor, not authorization supplied by the serialized payload. */
export function assertAuthorizedProvenance(p: ExecutionDocumentProvenance): void {
  EMBEDDED_DOCUMENT_REGISTRY.assertProvenance(p, "write")
}

// Receipts have in-memory object identity. Serialized data cannot manufacture one.
const receipts = new WeakMap<object, ExecutionDocumentProvenance>()
export function bindExecutionReceipt(state: object, provenance: ExecutionDocumentProvenance): void { receipts.set(state, provenance) }
export function executionReceipt(state: object): ExecutionDocumentProvenance | null { return receipts.get(state) ?? null }
const metadataOwners=new WeakMap<object,ExecutionDocumentProvenance>()
const executionTimes=new WeakMap<ExecutionDocumentProvenance,FiscalExecutionMetadata>()
/** Bind the App's clock metadata to the same private execution receipt. */
export function recordDocumentExecutionMetadata(state:object,metadata:FiscalExecutionMetadata):void {
  const receipt=executionReceipt(state);if(!receipt)return // legacy compatibility
  const owner=metadataOwners.get(metadata),previous=executionTimes.get(receipt)
  if((owner&&owner!==receipt)||metadata.packageId!==receipt.fiscalPackage.id||metadata.fiscalDate!==receipt.resolution.fiscalDate
    ||(previous&&(["requestId","consultationLocalDate","preparedAt","fiscalDate","referenceMode","packageId","startedAt"] as const).some(key=>previous[key]!==metadata[key]))
    ||(previous?.completedAt&&previous!==metadata))throw new Error("EXECUTION_METADATA_BINDING_MISMATCH")
  metadataOwners.set(metadata,receipt);executionTimes.set(receipt,metadata)
}
export function documentExecutionMetadata(state:object):FiscalExecutionMetadata|null {const receipt=executionReceipt(state);return receipt?executionTimes.get(receipt)??null:null}
export function assertDocumentExecutionMetadata(state:object,metadata:FiscalExecutionMetadata):void {
  if(executionReceipt(state)&&documentExecutionMetadata(state)!==metadata)throw new Error("EXECUTION_METADATA_BINDING_MISMATCH")
}
