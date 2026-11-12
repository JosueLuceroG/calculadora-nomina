import { civilDate, type CivilDate } from "./civil-date"
import type { ContractualDivisors, LaborBenefitMinima, PayrollPeriodicity } from "./contracts"
import { FiscalFoundationError } from "./errors"
import { compareDecimals, decimalText, divideDecimals, moneyText, type DecimalText, type MoneyText } from "./money"
import { selectByEffectiveDate } from "./parameters"
import { STANDARD_CONVENTIONS } from "./simulation-conventions"
import type { IntegrationFailure, IntegrationField, IntegrationIssue, IntegrationWarning, StandardIntegrationContext, StandardIntegrationNormalization } from "./standard-integration-contracts"

const inputFields = new Set(["profileId", "grossPeriodSalary", "periodicity", "referenceDate", "benefits"])
const benefitFields = new Set(["annualBonusDays", "annualVacationDays", "vacationPremiumPercent", "seniorityAssessment"])
const supportedPeriods = new Set(["weekly", "fortnightly", "monthly"])
const requiredDivisors = { weekly: "7", fortnightly: "15", monthly: "30" } as const

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
function absent(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "")
}
function issue(field: IntegrationField, kind: IntegrationIssue["kind"], code: string, message: string): IntegrationIssue {
  return Object.freeze({ field, kind, code, message })
}
export function integrationFailure(issues: readonly IntegrationIssue[], warnings: readonly IntegrationWarning[] = []): IntegrationFailure {
  return Object.freeze({
    status: issues.some(item => item.kind === "unsupported-scenario") ? "not-supported" : "not-determinable",
    data: null, issues: Object.freeze([...issues]), warnings: Object.freeze([...warnings]),
  })
}

function parseQuantity(value: unknown, field: IntegrationField, issues: IntegrationIssue[], salary = false): DecimalText | MoneyText | undefined {
  if (absent(value)) {
    issues.push(issue(field, "missing-data", "REQUIRED_DATA", "Captura este dato explícitamente; no se utilizan valores predeterminados."))
    return
  }
  try {
    const parsed = salary ? moneyText(value as string, "positive") : decimalText(value as string)
    if (!salary && compareDecimals(parsed, "0") < 0) {
      issues.push(issue(field, "invalid-value", "NEGATIVE_BENEFIT", "La prestación anual no puede ser negativa."))
      return
    }
    return parsed
  } catch (error) {
    if (!(error instanceof FiscalFoundationError)) throw error
    const kind = error.code === "DECIMAL_RANGE" ? "technical-range" : error.code === "INVALID_MONEY_SIGN" ? "invalid-value" : "invalid-format"
    issues.push(issue(field, kind, error.code, error.message))
    return
  }
}

/** Validation of theoretical integration only, not payroll/tax withholding. */
export function normalizeStandardIntegration(input: unknown, context: StandardIntegrationContext): StandardIntegrationNormalization {
  if (!record(input)) return integrationFailure([issue("request", absent(input) ? "missing-data" : "invalid-format", "INVALID_REQUEST", "Se requiere un objeto de captura de integración estándar.")])
  const issues: IntegrationIssue[] = []
  if (Object.keys(input).some(key => !inputFields.has(key))) {
    issues.push(issue("request", "unsupported-scenario", "EXTRA_CONCEPT_NOT_SUPPORTED", "No se admiten operaciones desde neto, intervalos, bonos ni otros conceptos en esta captura."))
  }
  if (absent(input.profileId)) issues.push(issue("profileId", "missing-data", "REQUIRED_PROFILE", "Indica el identificador del perfil estándar."))
  else if (typeof input.profileId !== "string") issues.push(issue("profileId", "invalid-format", "INVALID_PROFILE_FORMAT", "El identificador de perfil debe ser una cadena."))
  else if (input.profileId !== STANDARD_CONVENTIONS.id) issues.push(issue("profileId", "unsupported-scenario", "PROFILE_NOT_SUPPORTED", "Solo se admite el perfil estándar de salario ordinario fijo 2026."))
  if (absent(input.periodicity)) issues.push(issue("periodicity", "missing-data", "REQUIRED_PERIODICITY", "Indica la periodicidad contractual."))
  else if (typeof input.periodicity !== "string") issues.push(issue("periodicity", "invalid-format", "INVALID_PERIODICITY_FORMAT", "La periodicidad debe ser una cadena."))
  else if (!supportedPeriods.has(input.periodicity)) issues.push(issue("periodicity", "unsupported-scenario", "PERIODICITY_NOT_SUPPORTED", "Las periodicidades admitidas son semanal, quincenal y mensual."))
  const gross = parseQuantity(input.grossPeriodSalary, "grossPeriodSalary", issues, true)
  let date: CivilDate | undefined
  if (absent(input.referenceDate)) issues.push(issue("referenceDate", "missing-data", "REQUIRED_DATE", "Indica la fecha de referencia normativa."))
  else {
    try { date = civilDate(input.referenceDate as string) }
    catch (error) {
      if (!(error instanceof FiscalFoundationError)) throw error
      issues.push(issue("referenceDate", "invalid-format", error.code, error.message))
    }
  }
  if (date && !date.startsWith("2026-")) issues.push(issue("referenceDate", "unsupported-scenario", "REFERENCE_DATE_NOT_SUPPORTED", "El perfil aprobado de este módulo corresponde únicamente a 2026."))

  const benefits = record(input.benefits) ? input.benefits : {}
  if (!record(input.benefits) && !absent(input.benefits)) issues.push(issue("benefits", "invalid-format", "INVALID_BENEFITS", "Las prestaciones deben ser datos anuales declarados."))
  if (Object.keys(benefits).some(key => !benefitFields.has(key)) || (benefits.seniorityAssessment !== undefined && benefits.seniorityAssessment !== "declared-entitlement-not-inferred")) {
    issues.push(issue("benefits", "unsupported-scenario", "BENEFIT_SCOPE_NOT_SUPPORTED", "No se calculan antigüedad, variables ni otras prestaciones fuera de las declaradas."))
  }
  const bonus = parseQuantity(benefits.annualBonusDays, "benefits.annualBonusDays", issues)
  const vacation = parseQuantity(benefits.annualVacationDays, "benefits.annualVacationDays", issues)
  const premium = parseQuantity(benefits.vacationPremiumPercent, "benefits.vacationPremiumPercent", issues)
  if (issues.length || !gross || !date || bonus === undefined || vacation === undefined || premium === undefined) return integrationFailure(issues)

  try {
    if (!context || typeof context.fiscalPackageVersion !== "string" || !context.fiscalPackageVersion.trim() || !context.supportedDates || !Array.isArray(context.contractualDivisors) || !Array.isArray(context.laborBenefitMinima)) {
      return integrationFailure([issue("parameters", "missing-data", "REQUIRED_INTEGRATION_PARAMETERS", "Faltan los conjuntos versionados necesarios para la integración.")])
    }
    const periodicity = input.periodicity as PayrollPeriodicity
    const divisorSet = selectByEffectiveDate<ContractualDivisors>(context.contractualDivisors, date, context.supportedDates)
    const minimumSet = selectByEffectiveDate<LaborBenefitMinima>(context.laborBenefitMinima, date, context.supportedDates)
    if (divisorSet.kind !== "contractual-divisors" || divisorSet.key !== "LSS-29-II" || minimumSet.kind !== "labor-benefit-minima" || minimumSet.key !== "LFT-annual-benefits") {
      throw new FiscalFoundationError("INCOMPATIBLE_PARAMETERS", "Los conjuntos no corresponden a las reglas de integración declaradas.")
    }
    const divisor = decimalText(divisorSet.data[periodicity])
    if (compareDecimals(divisor, requiredDivisors[periodicity]) !== 0) throw new FiscalFoundationError("INCOMPATIBLE_PARAMETERS", "El divisor no corresponde al perfil contractual autorizado.")
    const minima = minimumSet.data
    const bonusMinimum = decimalText(minima.annualBonusDays)
    const vacationMinimum = decimalText(minima.firstAnnualVacationDays)
    const premiumMinimum = decimalText(minima.vacationPremiumPercent)
    if (compareDecimals(bonusMinimum, "0") <= 0 || compareDecimals(vacationMinimum, "0") <= 0 || compareDecimals(premiumMinimum, "0") <= 0 || minima.vacationSeniorityReference !== "LFT-76-not-inferred") {
      throw new FiscalFoundationError("INVALID_METADATA", "La referencia de prestaciones mínimas es inválida.")
    }
    const warnings: IntegrationWarning[] = []
    if (compareDecimals(bonus, bonusMinimum) < 0) warnings.push(Object.freeze({
      field: "benefits.annualBonusDays", code: "BONUS_BELOW_LEGAL_MINIMUM", declared: bonus as DecimalText, referenceMinimum: bonusMinimum,
      message: "El aguinaldo declarado es inferior al mínimo anual de referencia. No se sustituye el valor capturado.", sourceReference: "LFT-87",
    }))
    if (compareDecimals(vacation, vacationMinimum) < 0) warnings.push(Object.freeze({
      field: "benefits.annualVacationDays", code: "VACATIONS_BELOW_FIRST_ANNUAL_MINIMUM", declared: vacation as DecimalText, referenceMinimum: vacationMinimum,
      message: "Las vacaciones declaradas son inferiores al primer derecho anual de referencia; la antigüedad no se infiere.", sourceReference: "LFT-76",
    }))
    if (compareDecimals(premium, premiumMinimum) < 0) warnings.push(Object.freeze({
      field: "benefits.vacationPremiumPercent", code: "PREMIUM_BELOW_LEGAL_MINIMUM", declared: premium as DecimalText, referenceMinimum: premiumMinimum,
      message: "La prima declarada es inferior al mínimo porcentual de referencia. No se corrige automáticamente.", sourceReference: "LFT-80",
    }))
    let proportion
    try { proportion = divideDecimals(premium, "100") }
    catch (error) {
      if (!(error instanceof FiscalFoundationError)) throw error
      return integrationFailure([issue("benefits.vacationPremiumPercent", "technical-range", error.code, error.message)], warnings)
    }
    return Object.freeze({
      status: "valid", issues: Object.freeze([]), warnings: Object.freeze(warnings),
      data: Object.freeze({
        profileId: STANDARD_CONVENTIONS.id, grossPeriodSalary: gross as MoneyText, periodicity, referenceDate: date,
        contractualDivisor: divisor, actualCotizedDays: null,
        benefits: Object.freeze({ annualBonusDays: bonus as DecimalText, annualVacationDays: vacation as DecimalText, vacationPremiumPercent: premium as DecimalText, vacationPremiumProportion: proportion, seniorityAssessment: "declared-entitlement-not-inferred" as const }),
        fiscalPackageVersion: context.fiscalPackageVersion,
        parameterSetIds: Object.freeze([divisorSet.id, minimumSet.id]),
        sources: Object.freeze([...divisorSet.sources, ...minimumSet.sources]),
      }),
    })
  } catch (error) {
    if (!(error instanceof FiscalFoundationError)) throw error
    const unsupported = error.code === "UNSUPPORTED_DATE"
    const kind = unsupported ? "unsupported-scenario" : error.code === "DECIMAL_RANGE" ? "technical-range" : "parameter-data"
    return integrationFailure([issue("parameters", kind, error.code, error.message)])
  }
}
