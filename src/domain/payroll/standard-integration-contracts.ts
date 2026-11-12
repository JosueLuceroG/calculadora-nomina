import type { CivilDate, DateInterval } from "./civil-date"
import type { ContractualDivisors, DeclaredBenefits, FiscalParameterSet, FiscalSource, LaborBenefitMinima, PayrollPeriodicity } from "./contracts"
import type { DecimalComputation, DecimalText, MoneyText, RoundingMode } from "./money"

export type StandardIntegrationInput = Readonly<{
  profileId: string
  grossPeriodSalary: string
  periodicity: PayrollPeriodicity
  referenceDate: string
  benefits: Omit<DeclaredBenefits, "seniorityAssessment"> & Partial<Pick<DeclaredBenefits, "seniorityAssessment">>
}>

export type StandardIntegrationContext = Readonly<{
  fiscalPackageVersion: string
  supportedDates: DateInterval
  contractualDivisors: readonly FiscalParameterSet<ContractualDivisors>[]
  laborBenefitMinima: readonly FiscalParameterSet<LaborBenefitMinima>[]
}>

export type IntegrationField = "request" | "profileId" | "grossPeriodSalary" | "periodicity" | "referenceDate" | "benefits" | "benefits.annualBonusDays" | "benefits.annualVacationDays" | "benefits.vacationPremiumPercent" | "parameters" | "calculation"
export type IntegrationIssueKind = "missing-data" | "invalid-format" | "invalid-value" | "unsupported-scenario" | "parameter-data" | "technical-range"
export type IntegrationIssue = Readonly<{ field: IntegrationField; kind: IntegrationIssueKind; code: string; message: string }>
export type IntegrationWarning = Readonly<{
  field: "benefits.annualBonusDays" | "benefits.annualVacationDays" | "benefits.vacationPremiumPercent"
  code: "BONUS_BELOW_LEGAL_MINIMUM" | "VACATIONS_BELOW_FIRST_ANNUAL_MINIMUM" | "PREMIUM_BELOW_LEGAL_MINIMUM"
  declared: DecimalText
  referenceMinimum: DecimalText
  message: string
  sourceReference: string
}>

export type NormalizedStandardIntegration = Readonly<{
  profileId: string
  grossPeriodSalary: MoneyText
  periodicity: PayrollPeriodicity
  referenceDate: CivilDate
  contractualDivisor: DecimalText
  actualCotizedDays: null
  benefits: Readonly<{
    annualBonusDays: DecimalText
    annualVacationDays: DecimalText
    vacationPremiumPercent: DecimalText
    vacationPremiumProportion: DecimalComputation
    seniorityAssessment: "declared-entitlement-not-inferred"
  }>
  fiscalPackageVersion: string
  parameterSetIds: readonly string[]
  sources: readonly FiscalSource[]
}>

export type IntegrationFailure = Readonly<{
  status: "not-determinable" | "not-supported"
  data: null
  issues: readonly IntegrationIssue[]
  warnings: readonly IntegrationWarning[]
}>
export type StandardIntegrationNormalization = IntegrationFailure | Readonly<{
  status: "valid"
  data: NormalizedStandardIntegration
  issues: readonly IntegrationIssue[]
  warnings: readonly IntegrationWarning[]
}>

export type TheoreticalMoneyValue = Readonly<{
  internal: DecimalComputation
  presentation: Readonly<{ raw: DecimalText; amount: MoneyText; rounded: boolean; rounding: RoundingMode }>
}>

export type StandardSalaryIntegrationResult = IntegrationFailure | Readonly<{
  status: "estimated"
  inputValidation: "valid"
  data: Readonly<{
    normalized: NormalizedStandardIntegration
    dailySalary: TheoreticalMoneyValue
    factor: DecimalComputation
    equivalentAnnualBenefitDays: DecimalComputation
    theoreticalSdi: TheoreticalMoneyValue
    applicableSbc: null
    sbcStatus: "not-calculated"
    precisionPolicy: string
    integrationRulesVersion: string
    assumptions: readonly string[]
    suaEquivalence: "not-validated"
  }>
  issues: readonly IntegrationIssue[]
  warnings: readonly IntegrationWarning[]
}>
