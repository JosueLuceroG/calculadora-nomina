import type { FiscalSource, PayrollPeriodicity } from "../payroll/contracts"
import type { StandardGrossToNetContext } from "../payroll/gross-to-net-contracts"

export type FiscalOperation = "gross-to-net" | "net-to-gross"
export type FiscalCapability = "direct" | "inverse"
export type ParameterSetIdentity = Readonly<{ id: string; version: string }>
export type FiscalPackageManifest = Readonly<{
  manifestVersion: 1
  packageId: string
  parameterVersion: string
  exercise: number
  supportedDates: Readonly<{ from: string; through: string }>
  parameterSchemaId: string
  requiredRuleProfileId: string
  requiredContextualPolicyId: string
  requiredCapabilities: readonly FiscalCapability[]
  parameterSets: readonly ParameterSetIdentity[]
  sources: readonly FiscalSource[]
  contentIdentity: Readonly<{ scheme: "legacy-registry-v1"; sha256: string }>
}>

declare const verifiedPackage: unique symbol
/** The brand is not authority: the owning registry must recognize object identity. */
export type VerifiedFiscalPackageRef = Readonly<{
  [verifiedPackage]: true
  manifest: FiscalPackageManifest
  origin: "embedded"
  verification: Readonly<{ data: "source-verified"; basis: "embedded-build"; integrity: "build-asserted" }>
}>
export type EngineFiscalAuthorization = Readonly<{
  capabilityId: string
  implementationBindingId: string
  exercise: number
  simulationProfileId: string
  ruleProfileId: string
  contextualPolicyId: string
  parameterSchemaId: string
  content: Readonly<{ packageId: string; parameterVersion: string; scheme: "legacy-registry-v1"; sha256: string }>
  periodicities: readonly PayrollPeriodicity[]
  direct: boolean
  inverse: boolean
  policyVersions: readonly Readonly<{ component: string; version: string }>[]
}>
export type EngineFiscalCapabilities = Readonly<{ registryVersion: string; authorizations: readonly EngineFiscalAuthorization[] }>
export type FiscalResolutionRequest = Readonly<{
  fiscalDate: string
  periodicity: PayrollPeriodicity
  simulationProfileId: string
  ruleProfileId: string
  contextualPolicyId: string
  operation: FiscalOperation
  requiredCapabilities: readonly FiscalCapability[]
}>
export type FiscalResolutionCode =
  | "INVALID_FISCAL_DATE" | "INVALID_RESOLUTION_REQUEST" | "EXERCISE_PACKAGE_MISSING"
  | "DATE_OUTSIDE_PACKAGE_COVERAGE" | "AMBIGUOUS_FISCAL_PACKAGES" | "PACKAGE_REFERENCE_UNVERIFIED"
  | "PACKAGE_INCOMPLETE" | "INVALID_PARAMETER_TIMELINE" | "PARAMETER_SCHEMA_UNSUPPORTED"
  | "PACKAGE_CONTENT_NOT_AUTHORIZED" | "ENGINE_RULE_PROFILE_UNSUPPORTED" | "SIMULATION_PROFILE_UNSUPPORTED"
  | "CONTEXTUAL_POLICY_UNSUPPORTED" | "DIRECT_CAPABILITY_UNAVAILABLE" | "INVERSE_CAPABILITY_UNAVAILABLE"
  | "PERIODICITY_UNSUPPORTED"
export type FiscalResolutionStage = "request" | "selection" | "verification" | "compatibility" | "parameters"
export type FiscalPackageRead = Readonly<{
  ok: true
  implementationBindingId: string
  engineContext: StandardGrossToNetContext
  selectedParameterSets: readonly ParameterSetIdentity[]
}> | Readonly<{ ok: false; code: FiscalResolutionCode; cause: string }>
/** Trusted in-memory provider port, never a package's executable payload. */
export type FiscalPackageRegistrySnapshot = Readonly<{
  revision: string
  entries: readonly Readonly<{ manifest: FiscalPackageManifest; reference: VerifiedFiscalPackageRef | null }>[]
  owns: (reference: VerifiedFiscalPackageRef) => boolean
  read: (reference: VerifiedFiscalPackageRef, date: string, periodicity: PayrollPeriodicity) => FiscalPackageRead
}>
export type ExecutionFiscalContext = Readonly<{
  package: VerifiedFiscalPackageRef
  exercise: number
  fiscalDate: string
  periodicity: PayrollPeriodicity
  operation: FiscalOperation
  simulationProfileId: string
  ruleProfileId: string
  contextualPolicyId: string
  packageRegistryRevision: string
  capabilityRegistryVersion: string
  authorization: EngineFiscalAuthorization
  selectedParameterSets: readonly ParameterSetIdentity[]
  engineContext: StandardGrossToNetContext
}>
export type FiscalResolution = Readonly<{ status: "resolved"; context: ExecutionFiscalContext }> | Readonly<{
  status: "rejected"
  code: FiscalResolutionCode
  stage: FiscalResolutionStage
  request: FiscalResolutionRequest
  exercise: number | null
  candidates: readonly string[]
  cause: string | null
}>

/** New runtime objects are acyclic data trees; no mutable collections are exposed. */
export function freezeFiscalRuntime<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeFiscalRuntime)
    Object.freeze(value)
  }
  return value
}
