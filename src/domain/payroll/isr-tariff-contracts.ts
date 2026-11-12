import type { CivilDate, DateInterval } from "./civil-date"
import type { FiscalParameterSet, FiscalSource, IsrTariff, PayrollPeriodicity } from "./contracts"
import type { DecimalComputation, DecimalText, MoneyText } from "./money"
import type { IntegrationIssue, StandardIntegrationInput } from "./standard-integration-contracts"

export type StandardIsrTariffInput = Pick<StandardIntegrationInput, "profileId" | "grossPeriodSalary" | "periodicity" | "referenceDate">
export type StandardIsrTariffContext = Readonly<{
  fiscalPackageVersion: string
  exercise: number
  supportedDates: DateInterval
  isrTariffs: readonly FiscalParameterSet<IsrTariff>[]
}>
export type IsrTariffIssue = Readonly<IntegrationIssue>
export type IsrTariffWarning = Readonly<{
  code: "EMPLOYMENT_SUBSIDY_NOT_EVALUATED" | "MINIMUM_WAGE_WITHHOLDING_EXCEPTION_NOT_EVALUATED" | "NOT_FINAL_ISR_WITHHOLDING" | "ZERO_BASE_WITHOUT_TARIFF_BRACKET"
  message: string
}>
export type SelectedIsrBracket = Readonly<{
  number: number
  lower: MoneyText
  upper: MoneyText | null
  fixedFee: MoneyText
  ratePercent: DecimalText
  rateProportion: DecimalComputation
  excessOverLower: DecimalComputation
  taxOnExcess: DecimalComputation
}>

export type StandardEstimatedIsrByTariffResult = Readonly<{
  status: "not-determinable" | "not-supported"
  data: null
  isrByTariff: null
  issues: readonly IsrTariffIssue[]
  warnings: readonly IsrTariffWarning[]
}> | Readonly<{
  status: "estimated"
  inputValidation: "valid"
  isrByTariff: MoneyText
  data: Readonly<{
    profileId: string
    periodicity: PayrollPeriodicity
    referenceDate: CivilDate
    salaryNature: "ordinary-fixed"
    taxTreatment: "fully-taxable"
    taxableIncome: MoneyText
    taxableIncomeBasis: "ordinary-period-gross-without-imss-deduction"
    resultNature: "isr-by-tariff-before-subsidy-not-final-withholding"
    tariff: FiscalParameterSet<IsrTariff>
    tariffSection: "B.II" | "B.IV" | "B.V"
    selectedBracket: SelectedIsrBracket | null
    bracketSelection: "inclusive-cent-grid" | "zero-base-no-bracket"
    isrBeforeRounding: DecimalComputation
    rounding: Readonly<{ mode: "half-up"; decimals: 2; before: DecimalText; after: MoneyText; changed: boolean }>
    subsidy: Readonly<{ status: "not-evaluated"; amount: null }>
    minimumWageWithholdingException: Readonly<{ status: "not-evaluated" }>
    finalWithholding: Readonly<{ status: "not-calculated"; amount: null }>
    fiscalPackageVersion: string
    parameterSetIds: readonly string[]
    parameterSetVersions: readonly Readonly<{ id: string; version: string }>[]
    sources: readonly FiscalSource[]
    policyVersion: string
    precisionPolicy: string
    assumptions: readonly string[]
    suaEquivalence: "not-validated"
    contpaqiEquivalence: "not-validated"
  }>
  issues: readonly IsrTariffIssue[]
  warnings: readonly IsrTariffWarning[]
}>
