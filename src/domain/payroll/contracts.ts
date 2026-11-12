import type { CivilDate, DateInterval } from "./civil-date"
import type { DecimalText, MoneyText } from "./money"

export type PayrollOperation = "gross-to-net" | "net-to-gross"
export type PayrollPeriodicity = "weekly" | "fortnightly" | "monthly"
export type SalaryArea = "general-zone" | "northern-border-zone"
export type DeterminationStatus = "valid" | "estimated" | "not-determinable" | "not-supported"

export type DeclaredBenefits = Readonly<{
  annualBonusDays: string
  annualVacationDays: string
  vacationPremiumPercent: string
  seniorityAssessment: "declared-entitlement-not-inferred"
}>

export type StandardScenario = Readonly<{
  kind: "standard-estimate"
  conventionVersion: string
  effectiveDate: CivilDate
  interval: null
}>

/** Future contract only; no calendar calculation is activated in Hito 2C. */
export type CalendarScenario = Readonly<{
  kind: "calendar-context"
  availability: "future-not-activated"
  paymentDate: CivilDate
  interval: DateInterval
  paidDays: string
  cotizationSegments: readonly Readonly<{ interval: DateInterval; registeredSbc: MoneyText }>[]
  monthlyContext: Readonly<{
    completeness: "complete" | "provisional" | "unknown"
    taxableIncomeOtherPayments: MoneyText | null
    subsidyPreviouslyAllocated: MoneyText | null
    subsidyPreviouslyApplied: MoneyText | null
    isrPreviouslyWithheld: MoneyText | null
  }>
}>

export type PayrollRequest = Readonly<{
  operation: PayrollOperation
  amount: string
  periodicity: PayrollPeriodicity
  salaryNature: "ordinary-fixed"
  area: SalaryArea
  benefits: DeclaredBenefits
  includeWorkerImss: boolean
  scenario: StandardScenario | CalendarScenario
  fiscalPackageVersion: string
}>

export type MonetaryComponent = Readonly<{
  status: DeterminationStatus
  amount: MoneyText | null
  reason?: string
}>

export type ImssBranch = "pensioner-medical" | "cash-benefits" | "disability-life" | "unemployment-old-age" | "excess-medical"

export type PayrollResult = Readonly<{
  status: DeterminationStatus
  operation: PayrollOperation
  periodicity: PayrollPeriodicity
  gross: MonetaryComponent
  net: MonetaryComponent
  integration?: Readonly<{
    status: DeterminationStatus
    dailySalary: MoneyText | null
    factor: DecimalText | null
    theoreticalSdi: MoneyText | null
    applicableSbc: MoneyText | null
  }>
  isr?: Readonly<{
    taxableIncome: MonetaryComponent
    accordingToTariff: MonetaryComponent
    beforeSubsidyAfterExceptions: MonetaryComponent
    withheld: MonetaryComponent
  }>
  subsidy?: Readonly<{ calculated: MonetaryComponent; applicable: MonetaryComponent; applied: MonetaryComponent }>
  imss?: Readonly<{
    calculated: MonetaryComponent
    deducted: MonetaryComponent
    absorbedByEmployer: MonetaryComponent
    byBranch: Partial<Readonly<Record<ImssBranch, MonetaryComponent>>>
  }>
  inverse?: Readonly<{
    requestedNet: MoneyText
    match: "exact-within-scenario" | "no-exact-match" | "not-converged"
    candidates: readonly Readonly<{ gross: MoneyText; checkedNet: MoneyText; difference: MoneyText }>[]
  }>
  provenance: Readonly<{
    parameterSetIds: readonly string[]
    precisionPolicy: string
    assumptions: readonly string[]
    suaEquivalence: "not-validated"
    contpaqiEquivalence: "not-validated"
  }>
}>

export type FiscalAuthority = "SAT" | "SHCP" | "DOF" | "IMSS" | "INEGI" | "CONASAMI" | "Cámara de Diputados"
export type SourceValidation = "source-verified" | "pending-review" | "rejected"
export type FiscalSource = Readonly<{
  authority: FiscalAuthority
  document: string
  url: string
  locator: string
  publicationDate: string
  verifiedOn: string
  currentTextAsOf?: string
}>

export type FiscalParameterKind = "isr-tariff" | "uma" | "minimum-wages" | "employment-subsidy" | "imss-constants" | "contractual-divisors" | "labor-benefit-minima"
export type FiscalParameterSet<T> = Readonly<{
  id: string
  kind: FiscalParameterKind
  key: string
  version: string
  effectiveFrom: string
  effectiveThrough: string | null
  validation: SourceValidation
  validationScope: "source-data-only"
  sources: readonly FiscalSource[]
  data: T
}>

export type IsrTariffRow = Readonly<{ lower: string; upper: string | null; fixedFee: string; ratePercent: string }>
export type IsrTariff = Readonly<{ exercise: number; periodicity: PayrollPeriodicity; rows: readonly IsrTariffRow[] }>
export type UmaValues = Readonly<{ valueYear: number; daily: string; monthly: string; annual: string; unit: "MXN" }>
export type MinimumWages = Readonly<{
  general: Readonly<{ daily: string; publishedMonthlyReference: string }>
  northernBorder: Readonly<{ daily: string; publishedMonthlyReference: string }>
  territorialDefinitionReference: string
  monthlyExpressionReference: "daily-times-365-divided-by-12"
}>
export type EmploymentSubsidyParameters = Readonly<{
  umaMonthlyValueYear: number
  rateProportion: string
  monthlyIncomeLimit: string
  submonthlyDivisor: string
  monthlyQuotaDefinition: "official-uma-monthly-times-rate"
  formulaText: string
}>
export type ImssConstants = Readonly<{
  sbcCeilingUmaDailyMultiple: string
  excessThresholdUmaDailyMultiple: string
  workerRates: Readonly<Record<ImssBranch, string>>
  baseReferences: Readonly<Record<ImssBranch, "sbc" | "sbc-excess-over-threshold">>
  minimumSbcReference: "area-minimum-daily-wage"
  workerAbsorptionReference: "LSS-36"
}>
export type ContractualDivisors = Readonly<Record<PayrollPeriodicity, string>>
export type LaborBenefitMinima = Readonly<{
  annualBonusDays: string
  firstAnnualVacationDays: string
  vacationPremiumPercent: string
  vacationSeniorityReference: "LFT-76-not-inferred"
}>

export type FiscalRegistry = Readonly<{
  version: string
  exercise: number
  supportedDates: DateInterval
  isrTariffs: readonly FiscalParameterSet<IsrTariff>[]
  uma: readonly FiscalParameterSet<UmaValues>[]
  minimumWages: readonly FiscalParameterSet<MinimumWages>[]
  subsidy: readonly FiscalParameterSet<EmploymentSubsidyParameters>[]
  imssConstants: readonly FiscalParameterSet<ImssConstants>[]
  contractualDivisors: readonly FiscalParameterSet<ContractualDivisors>[]
  laborBenefitMinima: readonly FiscalParameterSet<LaborBenefitMinima>[]
}>
