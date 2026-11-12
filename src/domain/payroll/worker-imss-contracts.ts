import type { FiscalSource, ImssBranch } from "./contracts"
import type { DecimalComputation, DecimalText, MoneyText } from "./money"
import type { SbcIssue, SbcWarning, StandardEstimatedSbcResult, StandardSbcContext, StandardSbcInput } from "./sbc-contracts"

export type StandardWorkerImssInput = StandardSbcInput & Readonly<{ includeWorkerImss: boolean }>
export type StandardWorkerImssContext = StandardSbcContext
export type WorkerImssIssue = Readonly<Omit<SbcIssue, "field"> & { field: SbcIssue["field"] | "includeWorkerImss" }>

export type WorkerImssAmounts = Readonly<{
  calculated: MoneyText
  deducted: MoneyText
  absorbedByEmployer: MoneyText
  excludedBySimulation: MoneyText
}>
export type WorkerImssAllocation = "deducted" | "absorbed-under-LSS-36" | "excluded-by-simulation"
export type EstimatedSbcSuccess = Extract<StandardEstimatedSbcResult, { status: "estimated" }>

export type WorkerImssBranchResult = Readonly<{
  baseReference: "sbc" | "sbc-excess-over-threshold"
  dailyBase: DecimalText
  workerRate: DecimalText
  dailyQuota: DecimalComputation
  periodQuota: DecimalComputation
  rounding: Readonly<{
    mode: "half-up"
    decimals: 2
    before: DecimalText
    after: MoneyText
    changed: boolean
  }>
  quotas: WorkerImssAmounts
}>

export type WorkerImssFailure = Readonly<{
  status: "not-determinable" | "not-supported"
  data: null
  quotas: Readonly<{ calculated: null; deducted: null; absorbedByEmployer: null; excludedBySimulation: null }>
  byBranch: null
  diagnosticSbc: EstimatedSbcSuccess | null
  issues: readonly WorkerImssIssue[]
  warnings: readonly SbcWarning[]
}>

export type StandardEstimatedWorkerImssResult = WorkerImssFailure | Readonly<{
  status: "estimated"
  inputValidation: "valid"
  data: Readonly<{
    sbcResult: EstimatedSbcSuccess
    referenceDate: EstimatedSbcSuccess["data"]["referenceDate"]
    periodicity: StandardSbcInput["periodicity"]
    area: "general-zone"
    sbcNature: "estimated-not-registered"
    estimatedSbc: MoneyText
    includeWorkerImss: boolean
    referenceCotizedDays: DecimalText
    daysNature: "simulation-reference-not-actual-cotization"
    actualCotizedDays: null
    temporalScope: "effective-date-snapshot"
    umaDaily: MoneyText
    umaValueYear: number
    excessThresholdUmaDailyMultiple: DecimalText
    thresholdDaily: DecimalComputation
    excessDaily: DecimalComputation
    thresholdRelation: "below-threshold" | "at-threshold" | "above-threshold"
    contractualMinimumCheck: EstimatedSbcSuccess["data"]["contractualMinimumCheck"]
    allocation: WorkerImssAllocation
    workerAbsorptionReference: "LSS-36"
    fiscalPackageVersion: string
    parameterSetIds: readonly string[]
    parameterSetVersions: readonly Readonly<{ id: string; version: string }>[]
    sources: readonly FiscalSource[]
    conventionVersion: string
    policyVersion: string
    precisionPolicy: string
    assumptions: readonly string[]
    reconciliationVerified: true
    suaEquivalence: "not-validated"
    contpaqiEquivalence: "not-validated"
  }>
  quotas: WorkerImssAmounts
  byBranch: Readonly<Record<ImssBranch, WorkerImssBranchResult>>
  diagnosticSbc: null
  issues: readonly WorkerImssIssue[]
  warnings: readonly SbcWarning[]
}>
