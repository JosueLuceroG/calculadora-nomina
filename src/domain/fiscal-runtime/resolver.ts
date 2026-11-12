import { isCivilDate } from "../payroll/civil-date"
import { freezeFiscalRuntime } from "./contracts"
import type { EngineFiscalCapabilities, FiscalPackageRegistrySnapshot, FiscalResolution, FiscalResolutionCode, FiscalResolutionRequest, FiscalResolutionStage } from "./contracts"

/** Selects data and compiled authorization. Does not call a calculator or proof. */
export function resolveFiscalExecution(request: FiscalResolutionRequest, registry: FiscalPackageRegistrySnapshot, capabilities: EngineFiscalCapabilities): FiscalResolution {
  const query = freezeFiscalRuntime(structuredClone(request))
  let exercise: number | null = null
  let candidates: string[] = []
  const reject = (code: FiscalResolutionCode, stage: FiscalResolutionStage, cause: string | null = null): FiscalResolution =>
    freezeFiscalRuntime({ status: "rejected", code, stage, request: query, exercise, candidates: [...candidates], cause })
  if (!query || typeof query !== "object" || typeof query.fiscalDate !== "string"
    || Object.keys(query).some(key => !["fiscalDate", "periodicity", "simulationProfileId", "ruleProfileId", "contextualPolicyId", "operation", "requiredCapabilities"].includes(key))
    || !["gross-to-net", "net-to-gross"].includes(query.operation)
    || ![query.simulationProfileId, query.ruleProfileId, query.contextualPolicyId].every(v => typeof v === "string" && v.length > 0)
    || !Array.isArray(query.requiredCapabilities) || query.requiredCapabilities.some(v => !["direct", "inverse"].includes(v))) return reject("INVALID_RESOLUTION_REQUEST", "request")
  if (!isCivilDate(query.fiscalDate)) return reject("INVALID_FISCAL_DATE", "request")
  exercise = Number(query.fiscalDate.slice(0, 4))
  const annual = registry.entries.filter(entry => entry.manifest.exercise === exercise)
  candidates = annual.map(entry => entry.manifest.packageId)
  if (!annual.length) return reject("EXERCISE_PACKAGE_MISSING", "selection")
  if (annual.some(({ manifest: m }) => !isCivilDate(m.supportedDates.from) || !isCivilDate(m.supportedDates.through) || m.supportedDates.from > m.supportedDates.through)) return reject("INVALID_PARAMETER_TIMELINE", "selection", "INVALID_MANIFEST_INTERVAL")
  const covered = annual.filter(({ manifest: m }) => m.supportedDates.from <= query.fiscalDate && query.fiscalDate <= m.supportedDates.through)
  if (!covered.length) return reject("DATE_OUTSIDE_PACKAGE_COVERAGE", "selection")
  candidates = covered.map(entry => entry.manifest.packageId)
  if (covered.length !== 1) return reject("AMBIGUOUS_FISCAL_PACKAGES", "selection")
  const { manifest, reference } = covered[0]
  if (!reference || !registry.owns(reference) || reference.manifest !== manifest
    || reference.origin !== "embedded" || reference.verification.data !== "source-verified" || reference.verification.basis !== "embedded-build"
    || reference.verification.integrity !== "build-asserted") return reject("PACKAGE_REFERENCE_UNVERIFIED", "verification")
  if (!manifest.sources.length || !manifest.parameterSets.length || new Set(manifest.parameterSets.map(set => set.id)).size !== manifest.parameterSets.length
    || manifest.parameterSets.some(set => !set.id || !set.version)) return reject("PACKAGE_INCOMPLETE", "verification", "INCOMPLETE_MANIFEST")
  let grants = capabilities.authorizations.filter(a => a.exercise === exercise && a.ruleProfileId === query.ruleProfileId && a.ruleProfileId === manifest.requiredRuleProfileId)
  if (!grants.length) return reject("ENGINE_RULE_PROFILE_UNSUPPORTED", "compatibility")
  grants = grants.filter(a => a.simulationProfileId === query.simulationProfileId)
  if (!grants.length) return reject("SIMULATION_PROFILE_UNSUPPORTED", "compatibility")
  grants = grants.filter(a => a.contextualPolicyId === query.contextualPolicyId && a.contextualPolicyId === manifest.requiredContextualPolicyId)
  if (!grants.length) return reject("CONTEXTUAL_POLICY_UNSUPPORTED", "compatibility")
  grants = grants.filter(a => a.parameterSchemaId === manifest.parameterSchemaId)
  if (!grants.length) return reject("PARAMETER_SCHEMA_UNSUPPORTED", "compatibility")
  grants = grants.filter(a => a.content.packageId === manifest.packageId && a.content.parameterVersion === manifest.parameterVersion
    && a.content.scheme === manifest.contentIdentity.scheme && a.content.sha256 === manifest.contentIdentity.sha256)
  if (!grants.length) return reject("PACKAGE_CONTENT_NOT_AUTHORIZED", "compatibility")
  // Never resolve authorization ambiguity by array order, even if one grants more.
  if (grants.length !== 1) return reject("AMBIGUOUS_FISCAL_PACKAGES", "compatibility", "AMBIGUOUS_ENGINE_AUTHORIZATION")
  const grant = grants[0]
  if (!grant.periodicities.includes(query.periodicity)) return reject("PERIODICITY_UNSUPPORTED", "compatibility")
  const required = new Set([...query.requiredCapabilities, ...manifest.requiredCapabilities, "direct"])
  if (query.operation === "net-to-gross") required.add("inverse")
  if (!grant.direct) return reject("DIRECT_CAPABILITY_UNAVAILABLE", "compatibility")
  if (required.has("inverse") && !grant.inverse) return reject("INVERSE_CAPABILITY_UNAVAILABLE", "compatibility")
  const data = registry.read(reference, query.fiscalDate, query.periodicity)
  if (!data.ok) return reject(data.code, "parameters", data.cause)
  if (data.implementationBindingId !== grant.implementationBindingId) return reject("ENGINE_RULE_PROFILE_UNSUPPORTED", "compatibility", "IMPLEMENTATION_BINDING_MISMATCH")
  if (data.engineContext.fiscalPackageVersion !== manifest.parameterVersion
    || data.engineContext.exercise !== exercise
    || data.engineContext.supportedDates.from !== manifest.supportedDates.from || data.engineContext.supportedDates.through !== manifest.supportedDates.through
    || data.selectedParameterSets.length !== 7
    || new Set(data.selectedParameterSets.map(set => set.id)).size !== 7
    || data.selectedParameterSets.some(set => !manifest.parameterSets.some(item => item.id === set.id && item.version === set.version))) return reject("PACKAGE_INCOMPLETE", "parameters", "PROVIDER_CONTEXT_MISMATCH")
  return freezeFiscalRuntime({ status: "resolved", context: {
    package: reference, exercise, fiscalDate: query.fiscalDate, periodicity: query.periodicity, operation: query.operation,
    simulationProfileId: query.simulationProfileId, ruleProfileId: query.ruleProfileId, contextualPolicyId: query.contextualPolicyId,
    packageRegistryRevision: registry.revision, capabilityRegistryVersion: capabilities.registryVersion,
    authorization: structuredClone(grant), selectedParameterSets: structuredClone(data.selectedParameterSets), engineContext: structuredClone(data.engineContext),
  } })
}
