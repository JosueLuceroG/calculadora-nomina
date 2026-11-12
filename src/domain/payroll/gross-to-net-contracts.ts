import type { DeterminationStatus, FiscalSource, MonetaryComponent } from "./contracts"
import type { StandardEmploymentSubsidyContext, StandardEstimatedEmploymentSubsidyResult } from "./employment-subsidy-contracts"
import type { MoneyText } from "./money"
import type { StandardEstimatedSbcResult } from "./sbc-contracts"
import type { IntegrationIssueKind, StandardSalaryIntegrationResult } from "./standard-integration-contracts"
import type { StandardEstimatedWorkerImssResult, StandardWorkerImssContext, StandardWorkerImssInput, WorkerImssBranchResult } from "./worker-imss-contracts"
import type { ImssBranch } from "./contracts"
import type {ContextualRetentionContext,RetentionAssessment} from './minimum-retention-context'

export type MinimumWageMonthlyScenario = Readonly<{ kind: "unconfirmed" }> | Readonly<{
  kind: "only-general-minimum-assumed-for-reference-month"
  referenceMonth: string
  noOtherSalaryPayments: true
  acknowledgement: "explicit-standard-simulation-assumption-not-payroll-verification"
}> | Readonly<{ kind: "monthly-payments-outside-standard-profile" }> | ContextualRetentionContext

export type StandardEstimatedGrossToNetInput = StandardWorkerImssInput & Readonly<{ minimumWageMonthlyScenario: MinimumWageMonthlyScenario }>
export type StandardGrossToNetContext = StandardWorkerImssContext & StandardEmploymentSubsidyContext & Readonly<{ retentionRuleSources: readonly FiscalSource[] }>
export type GrossToNetStatus = "estimated" | "not-determinable" | "not-supported"
export type GrossToNetStage = "capture" | "imss" | "subsidy" | "coherence" | "retention" | "net"
export type GrossToNetIssue = Readonly<{ stages: readonly GrossToNetStage[]; field: string; kind: IntegrationIssueKind; code: string; message: string }>
export type GrossToNetWarning = Readonly<{ stages: readonly (GrossToNetStage | "composition")[]; field?: string; code: string; message: string }>
export type StandardWithholdingDecision = Readonly<{
  status: GrossToNetStatus
  kind: "ordinary-above-minimum" | "conditional-no-withholding-LISR-96" | "unconfirmed-minimum-month" | "blocked"
  reason: string
  scenario: MinimumWageMonthlyScenario | null
  referenceMonth: string | null
  factualMonthlyVerification: "not-performed"
  nature: "standard-scenario-estimate-not-actual-withholding"
  policyVersion: string
  sources: readonly FiscalSource[]
  assessment?:RetentionAssessment
}>
type IntegrationData = Extract<StandardSalaryIntegrationResult, { status: "estimated" }>["data"]
type GrossToNetCommon = Readonly<{
  operation: "gross-to-net"
  gross: MonetaryComponent
  integration: Readonly<{ status: DeterminationStatus; data: IntegrationData | null }>
  sbc: StandardEstimatedSbcResult | null
  isr: Readonly<{
    accordingToTariff: MonetaryComponent
    afterSubsidyProvisional: MonetaryComponent
    beforeSubsidyAfterExceptions: MonetaryComponent
    withheld: MonetaryComponent
  }>
  subsidy: Readonly<{
    determined: MonetaryComponent
    potentiallyApplicable: MonetaryComponent
    applied: MonetaryComponent
    notAppliedDueToNoWithholding: MonetaryComponent
    excessOverTariffIsrNotDelivered: MonetaryComponent
    totalNotApplied: MonetaryComponent
    cashDelivered: MonetaryComponent
  }>
  imss: Readonly<{
    calculated: MonetaryComponent
    deducted: MonetaryComponent
    absorbedByEmployer: MonetaryComponent
    excludedBySimulation: MonetaryComponent
    byBranch: Readonly<Record<ImssBranch, WorkerImssBranchResult>> | null
  }>
  retention: StandardWithholdingDecision
  modules: Readonly<{ workerImss: StandardEstimatedWorkerImssResult | null; employmentSubsidy: StandardEstimatedEmploymentSubsidyResult | null }>
  provenance: Readonly<{
    fiscalPackageVersion: string | null
    parameterSetIds: readonly string[]
    parameterSetVersions: readonly Readonly<{ id: string; version: string }>[]
    policyVersions: readonly Readonly<{ component: string; version: string }>[]
    sources: readonly FiscalSource[]
    assumptions: readonly string[]
    fiscalCertification: "not-certified"
    actualMonthlyContextVerified: false
    actualWithholdingConfirmed: false
    suaEquivalence: "not-validated"
    contpaqiEquivalence: "not-validated"
  }>
  issues: readonly GrossToNetIssue[]
  warnings: readonly GrossToNetWarning[]
}>
export type StandardEstimatedGrossToNetResult = GrossToNetCommon & (Readonly<{
  status: "estimated"
  complete: true
  net: Readonly<{ status: "estimated"; amount: MoneyText }>
  reconciliationVerified: true
}> | Readonly<{
  status: "not-determinable" | "not-supported"
  complete: false
  net: Readonly<{ status: "not-determinable" | "not-supported"; amount: null; reason: string }>
  reconciliationVerified: false
}>)
