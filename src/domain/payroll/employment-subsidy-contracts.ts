import type { EmploymentSubsidyParameters, FiscalParameterSet, FiscalSource, UmaValues } from "./contracts"
import type { DecimalComputation, DecimalText, MoneyText } from "./money"
import type { IsrTariffIssue, IsrTariffWarning, StandardEstimatedIsrByTariffResult, StandardIsrTariffContext, StandardIsrTariffInput } from "./isr-tariff-contracts"

export type StandardEmploymentSubsidyInput = StandardIsrTariffInput
export type StandardEmploymentSubsidyContext = StandardIsrTariffContext & Readonly<{
  uma: readonly FiscalParameterSet<UmaValues>[]
  subsidy: readonly FiscalParameterSet<EmploymentSubsidyParameters>[]
  subsidyRulesSources: readonly FiscalSource[]
}>
export type EmploymentSubsidyWarning = IsrTariffWarning | Readonly<{
  code: "ESTIMATED_MONTHLY_REFERENCE" | "MONTHLY_SUBSIDY_RECONCILIATION_NOT_SIMULATED" | "EMPLOYER_ELECTION_NOT_EVALUATED" | "PROVISIONAL_ISR_AFTER_SUBSIDY" | "SUBSIDY_EXCESS_NOT_PAID_OR_CARRIED"
  message: string
}>
export type EmploymentSubsidyAmounts = Readonly<{
  isrByTariff: MoneyText
  subsidyDetermined: MoneyText
  subsidyPotentiallyApplicable: MoneyText
  isrAfterSubsidyProvisional: MoneyText
  excessNotDelivered: MoneyText
  cashDelivered: MoneyText
}>
type IsrSuccess = Extract<StandardEstimatedIsrByTariffResult, { status: "estimated" }>
export type StandardEstimatedEmploymentSubsidyResult = Readonly<{
  status: "not-determinable" | "not-supported"
  data: null
  amounts: Readonly<{ [K in keyof EmploymentSubsidyAmounts]: null }>
  diagnosticIsr: IsrSuccess | null
  issues: readonly IsrTariffIssue[]
  warnings: readonly EmploymentSubsidyWarning[]
}> | Readonly<{
  status: "estimated"
  inputValidation: "valid"
  amounts: EmploymentSubsidyAmounts
  data: Readonly<{
    isrResult: IsrSuccess
    referenceDate: IsrSuccess["data"]["referenceDate"]
    periodicity: StandardIsrTariffInput["periodicity"]
    referenceDays: DecimalText
    monthlyReferenceDays: DecimalText
    monthlyReferenceIncome: DecimalComputation
    eligibility: Readonly<{
      nature: "estimated-reference-income-test-only"
      eligibleEstimate: boolean
      relation: "below-limit" | "at-limit" | "above-limit"
      reason: "within-monthly-reference-limit" | "above-monthly-reference-limit"
      monthlyIncomeLimit: MoneyText
      comparisonBasis: "exact-cross-products-without-monthly-income-rounding"
      incomeNumerator: DecimalComputation
      referenceDivisor: DecimalText
      limitNumerator: DecimalComputation
    }>
    monthlySubsidyTheoretical: DecimalComputation
    periodSubsidyUncapped: DecimalComputation
    periodSubsidyTheoretical: DecimalComputation
    monthlyMaximumApplied: boolean
    periodSubsidyBeforeRounding: DecimalComputation
    rounding: Readonly<{ mode: "half-up"; decimals: 2; before: DecimalText; after: MoneyText; changed: boolean }>
    umaMonthly: MoneyText
    umaValueYear: number
    subsidyRateProportion: DecimalText
    submonthlyDivisor: DecimalText
    parameters: Readonly<{ uma: FiscalParameterSet<UmaValues>; subsidy: FiscalParameterSet<EmploymentSubsidyParameters> }>
    fiscalPackageVersion: string
    parameterSetIds: readonly string[]
    parameterSetVersions: readonly Readonly<{ id: string; version: string }>[]
    sources: readonly FiscalSource[]
    resultNature: "estimated-subsidy-and-provisional-isr-not-final-withholding"
    temporalScope: "effective-date-snapshot"
    monthlyReconciliation: "not-simulated"
    actualMonthlyContext: Readonly<{ income: null; priorSubsidyApplied: null; priorIsrWithheld: null; otherPayments: null; employerElection: "not-evaluated" }>
    excessCarryForwardAllowed: false
    minimumWageWithholdingException: Readonly<{ status: "not-evaluated" }>
    finalWithholding: Readonly<{ status: "not-calculated"; amount: null }>
    reconciliationVerified: true
    conventionVersion: string
    policyVersion: string
    precisionPolicy: string
    assumptions: readonly string[]
    suaEquivalence: "not-validated"
    contpaqiEquivalence: "not-validated"
  }>
  diagnosticIsr: null
  issues: readonly IsrTariffIssue[]
  warnings: readonly EmploymentSubsidyWarning[]
}>
