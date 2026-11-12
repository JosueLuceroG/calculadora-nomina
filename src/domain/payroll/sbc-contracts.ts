import type { FiscalParameterSet, FiscalSource, ImssConstants, MinimumWages, SalaryArea, UmaValues } from "./contracts"
import type { DecimalComputation, DecimalText, MoneyText } from "./money"
import type { IntegrationIssue, IntegrationWarning, StandardIntegrationContext, StandardIntegrationInput, StandardSalaryIntegrationResult } from "./standard-integration-contracts"

export type StandardSbcInput = StandardIntegrationInput & Readonly<{ area: SalaryArea }>
export type StandardSbcContext = StandardIntegrationContext & Readonly<{
  uma: readonly FiscalParameterSet<UmaValues>[]
  minimumWages: readonly FiscalParameterSet<MinimumWages>[]
  imssConstants: readonly FiscalParameterSet<ImssConstants>[]
}>
export type SbcIssue = Readonly<Omit<IntegrationIssue, "field"> & { field: IntegrationIssue["field"] | "area" }>
export type ContractualMinimumWarning = Readonly<{
  field: "grossPeriodSalary"
  code: "CONTRACTUAL_DAILY_SALARY_BELOW_GENERAL_MINIMUM"
  declaredGross: MoneyText
  contractualDailySalary: DecimalText
  referenceMinimumDailySalary: MoneyText
  message: string
  sourceReference: "LFT-85-and-CONASAMI-2026"
}>
export type SbcWarning = IntegrationWarning | ContractualMinimumWarning

export type SbcBoundResult = Readonly<{
  internalSdi: DecimalComputation
  limitedInternalValue: DecimalText
  estimatedSbc: MoneyText
  relation: "below-lower" | "at-lower" | "inside-limits" | "at-upper" | "above-upper"
  limitApplied: "none" | "lower" | "upper"
  limitReason: "within-legal-interval" | "minimum-daily-wage-floor" | "uma-daily-ceiling"
  limitDifference: DecimalComputation
  rounding: Readonly<{
    mode: "half-up"
    decimals: 2
    before: DecimalText
    after: MoneyText
    changed: boolean
    verifiedWithinLimits: true
  }>
}>

export type SbcFailure = Readonly<{
  status: "not-determinable" | "not-supported"
  data: null
  issues: readonly SbcIssue[]
  warnings: readonly SbcWarning[]
}>
type IntegrationData = Extract<StandardSalaryIntegrationResult, { status: "estimated" }>["data"]

export type StandardEstimatedSbcResult = SbcFailure | Readonly<{
  status: "estimated"
  inputValidation: "valid"
  data: Readonly<{
    integration: IntegrationData
    area: "general-zone"
    referenceDate: IntegrationData["normalized"]["referenceDate"]
    sbcNature: "estimated-not-registered"
    sbc: SbcBoundResult
    limits: Readonly<{
      lower: MoneyText
      upper: MoneyText
      umaDaily: MoneyText
      umaValueYear: number
      ceilingUmaDailyMultiple: DecimalText
      ceilingProductExact: boolean
    }>
    contractualMinimumCheck: Readonly<{
      relation: "below-general-minimum" | "at-general-minimum" | "above-general-minimum"
      comparedValue: DecimalText
      referenceMinimum: MoneyText
      comparisonBasis: "unrounded-contractual-daily-salary"
      declaredGrossUnchanged: MoneyText
      contractSalaryModified: false
    }>
    fiscalPackageVersion: string
    parameterSetIds: readonly string[]
    sources: readonly FiscalSource[]
    policyVersion: string
    precisionPolicy: string
    assumptions: readonly string[]
    suaEquivalence: "not-validated"
    contpaqiEquivalence: "not-validated"
  }>
  issues: readonly SbcIssue[]
  warnings: readonly SbcWarning[]
}>
