import type { EmploymentSubsidyParameters, FiscalParameterSet, FiscalSource, UmaValues } from "./contracts"
import { FiscalFoundationError } from "./errors"
import { calculateStandardEstimatedIsrByTariff } from "./isr-tariff"
import type { IsrTariffIssue, StandardEstimatedIsrByTariffResult } from "./isr-tariff-contracts"
import { addDecimals, compareDecimals, DECIMAL_POLICY, decimalText, divideDecimals, moneyText, multiplyDecimals, presentMoney, subtractDecimals, type DecimalComputation } from "./money"
import { selectByEffectiveDate, validateFiscalSource } from "./parameters"
import { STANDARD_CONVENTIONS } from "./simulation-conventions"
import type { EmploymentSubsidyAmounts, EmploymentSubsidyWarning, StandardEmploymentSubsidyContext, StandardEstimatedEmploymentSubsidyResult } from "./employment-subsidy-contracts"

type IsrSuccess = Extract<StandardEstimatedIsrByTariffResult, { status: "estimated" }>
const zero = moneyText("0", "non-negative")
const subsidyWarnings: readonly EmploymentSubsidyWarning[] = Object.freeze([
  Object.freeze({ code: "ESTIMATED_MONTHLY_REFERENCE", message: "Elegibilidad estimada solo por referencia de ingreso; bruto × 30/7, ×2 o mensual son convenciones, no ingresos mensuales reales." }),
  Object.freeze({ code: "MONTHLY_SUBSIDY_RECONCILIATION_NOT_SIMULATED", message: "No se reproduce la conciliación mensual ni el límite acumulado entre pagos; ingresos, otros pagos y subsidios previos reales son desconocidos." }),
  Object.freeze({ code: "EMPLOYER_ELECTION_NOT_EVALUATED", message: "No se comprueba elección del empleador que aplica subsidio ni otros empleadores; la aplicación es potencial y provisional." }),
  Object.freeze({ code: "PROVISIONAL_ISR_AFTER_SUBSIDY", message: "ISR después del subsidio provisional, no retención final; la excepción legal por salario mínimo sigue pendiente." }),
  Object.freeze({ code: "SUBSIDY_EXCESS_NOT_PAID_OR_CARRIED", message: "El excedente no se entrega en efectivo, no se agrega al neto ni se traslada a ISR posterior." }),
])

export const STANDARD_EMPLOYMENT_SUBSIDY_POLICY = Object.freeze({
  id: "standard-employment-subsidy-2026-period-half-up-v1",
  nature: "explicit-simulation-policy" as const,
  eligibility: "exact-cross-products-of-estimated-monthly-reference" as const,
  monthlyQuota: "official-uma-monthly-times-versioned-rate" as const,
  periodOrder: "unrounded-monthly-times-reference-days-divided-by-submonthly-divisor-then-monthly-cap-then-eligibility-then-cent-rounding" as const,
  monthlyPeriod: "full-monthly-quota-without-30-over-30-point-4" as const,
  rounding: "half-up" as const,
  decimals: 2 as const,
  application: "minimum-of-determined-subsidy-and-isr-by-tariff" as const,
  monthlyReconciliation: "not-simulated" as const,
})

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
function failure(issues: readonly IsrTariffIssue[], warnings: readonly EmploymentSubsidyWarning[], diagnosticIsr: IsrSuccess | null = null): StandardEstimatedEmploymentSubsidyResult {
  return Object.freeze({
    status: issues.some(item => item.kind === "unsupported-scenario") ? "not-supported" : "not-determinable",
    data: null, amounts: Object.freeze({ isrByTariff: null, subsidyDetermined: null, subsidyPotentiallyApplicable: null, isrAfterSubsidyProvisional: null, excessNotDelivered: null, cashDelivered: null }),
    diagnosticIsr, issues: Object.freeze([...issues]), warnings: Object.freeze([...warnings]),
  })
}
function exact(value: DecimalComputation): DecimalComputation {
  if (!value.exact) throw new FiscalFoundationError("DECIMAL_RANGE", "Un producto del subsidio pierde precisión antes del prorrateo o comparación.")
  return value
}
function validateSourceBodies(sources: unknown): asserts sources is readonly FiscalSource[] {
  if (!Array.isArray(sources) || !sources.length) throw new FiscalFoundationError("MISSING_PARAMETER", "Faltan fuentes de las reglas vigentes del subsidio.")
  for (const source of sources) {
    if (!record(source) || typeof source.document !== "string" || typeof source.locator !== "string") throw new FiscalFoundationError("INVALID_METADATA", "Una fuente del subsidio está incompleta.")
    validateFiscalSource(source as unknown as FiscalSource)
  }
}
function validateSeriesBodies<T>(series: readonly FiscalParameterSet<T>[]): void {
  if (!Array.isArray(series)) throw new FiscalFoundationError("MISSING_PARAMETER", "Falta una serie versionada de UMA o subsidio.")
  for (const set of series) {
    if (!record(set) || !record(set.data) || typeof set.id !== "string" || typeof set.key !== "string" || typeof set.version !== "string") throw new FiscalFoundationError("INVALID_METADATA", "Un conjunto UMA/subsidio está incompleto.")
    validateSourceBodies(set.sources)
  }
}
function snapshot<T>(set: FiscalParameterSet<T>): FiscalParameterSet<T> {
  return Object.freeze({ ...set, data: Object.freeze({ ...set.data }), sources: Object.freeze(set.sources.map(source => Object.freeze({ ...source }))) })
}

/** Reuses ISR by tariff. Estimates eligibility/application, never final withholding or net pay. */
export function calculateStandardEstimatedEmploymentSubsidy(input: unknown, context: StandardEmploymentSubsidyContext): StandardEstimatedEmploymentSubsidyResult {
  const isr = calculateStandardEstimatedIsrByTariff(input, context)
  if (isr.status !== "estimated") return failure(isr.issues, isr.warnings)
  // The underlying ISR report remains unchanged; this component now evaluates subsidy estimates.
  const warnings = Object.freeze([...isr.warnings.filter(warning => warning.code !== "EMPLOYMENT_SUBSIDY_NOT_EVALUATED"), ...subsidyWarnings])
  try {
    validateSeriesBodies(context.uma)
    validateSeriesBodies(context.subsidy)
    validateSourceBodies(context.subsidyRulesSources)
    const date = isr.data.referenceDate
    const uma = selectByEffectiveDate<UmaValues>(context.uma, date, context.supportedDates)
    const subsidy = selectByEffectiveDate<EmploymentSubsidyParameters>(context.subsidy, date, context.supportedDates)
    if (uma.kind !== "uma" || uma.key !== "daily-monthly-annual" || subsidy.kind !== "employment-subsidy" || subsidy.key !== "2026-decree") throw new FiscalFoundationError("INCOMPATIBLE_PARAMETERS", "Las series no corresponden a UMA y subsidio 2026.")
    if (uma.data.unit !== "MXN" || ![2025, 2026].includes(uma.data.valueYear) || uma.data.valueYear !== subsidy.data.umaMonthlyValueYear
      || subsidy.data.monthlyQuotaDefinition !== "official-uma-monthly-times-rate" || typeof subsidy.data.formulaText !== "string" || !subsidy.data.formulaText.trim()) {
      throw new FiscalFoundationError("INCOMPATIBLE_PARAMETERS", "La UMA mensual/año o definición de cuota no corresponde al subsidio elegido.")
    }
    const umaMonthly = moneyText(uma.data.monthly, "positive")
    const rate = decimalText(subsidy.data.rateProportion)
    const divisor = decimalText(subsidy.data.submonthlyDivisor)
    const limit = moneyText(subsidy.data.monthlyIncomeLimit, "positive")
    if (compareDecimals(rate, "0") <= 0 || compareDecimals(rate, "1") > 0 || compareDecimals(divisor, "0") <= 0) throw new FiscalFoundationError("INCOMPATIBLE_PARAMETERS", "El porcentaje o divisor del subsidio es inválido.")
    const periodicity = isr.data.periodicity
    const days = decimalText(STANDARD_CONVENTIONS.referenceCotizedDays[periodicity])
    const monthlyDays = decimalText(STANDARD_CONVENTIONS.monthlyIncomeReferenceDays)
    // Weekly reference is rational; compare exact numerator/limit products, not its cent display.
    const referenceDivisor = decimalText(periodicity === "weekly" ? days : "1")
    const referenceMultiplier = periodicity === "weekly" ? monthlyDays : periodicity === "fortnightly" ? exact(divideDecimals(monthlyDays, days)).value : "1"
    const incomeNumerator = exact(multiplyDecimals(isr.data.taxableIncome, referenceMultiplier))
    const monthlyReferenceIncome = divideDecimals(incomeNumerator.value, referenceDivisor)
    const limitNumerator = exact(multiplyDecimals(limit, referenceDivisor))
    const comparison = compareDecimals(incomeNumerator.value, limitNumerator.value)
    const eligibleEstimate = comparison <= 0

    const monthlySubsidyTheoretical = exact(multiplyDecimals(umaMonthly, rate))
    // Equivalent to monthly / 30.4 * days; exact numerator first avoids a second precision rounding.
    const periodSubsidyUncapped = periodicity === "monthly" ? monthlySubsidyTheoretical : divideDecimals(exact(multiplyDecimals(monthlySubsidyTheoretical.value, days)).value, divisor)
    const monthlyMaximumApplied = compareDecimals(periodSubsidyUncapped.value, monthlySubsidyTheoretical.value) > 0
    const periodSubsidyTheoretical = monthlyMaximumApplied ? monthlySubsidyTheoretical : periodSubsidyUncapped
    const periodSubsidyBeforeRounding = eligibleEstimate ? periodSubsidyTheoretical : addDecimals("0", "0")
    const determined = presentMoney(periodSubsidyBeforeRounding.value, STANDARD_EMPLOYMENT_SUBSIDY_POLICY.rounding)
    const applicable = compareDecimals(determined.amount, isr.isrByTariff) <= 0 ? determined.amount : isr.isrByTariff
    const amounts: EmploymentSubsidyAmounts = Object.freeze({
      isrByTariff: isr.isrByTariff, subsidyDetermined: determined.amount, subsidyPotentiallyApplicable: applicable,
      isrAfterSubsidyProvisional: moneyText(exact(subtractDecimals(isr.isrByTariff, applicable)).value, "non-negative"),
      excessNotDelivered: moneyText(exact(subtractDecimals(determined.amount, applicable)).value, "non-negative"), cashDelivered: zero,
    })
    if (compareDecimals(exact(addDecimals(amounts.isrAfterSubsidyProvisional, applicable)).value, isr.isrByTariff) !== 0
      || compareDecimals(exact(addDecimals(amounts.excessNotDelivered, applicable)).value, determined.amount) !== 0) {
      throw new FiscalFoundationError("INCOMPATIBLE_PARAMETERS", "El ISR provisional o subsidio no concilia con su aplicación.")
    }
    const sources = [...new Map([...isr.data.sources, ...uma.sources, ...subsidy.sources, ...context.subsidyRulesSources].map(source => [`${source.url}|${source.locator}`, Object.freeze({ ...source })])).values()]
    return Object.freeze({
      status: "estimated", inputValidation: "valid", amounts, diagnosticIsr: null,
      data: Object.freeze({
        isrResult: isr, referenceDate: date, periodicity, referenceDays: days, monthlyReferenceDays: monthlyDays, monthlyReferenceIncome,
        eligibility: Object.freeze({ nature: "estimated-reference-income-test-only", eligibleEstimate, relation: comparison < 0 ? "below-limit" : comparison === 0 ? "at-limit" : "above-limit", reason: eligibleEstimate ? "within-monthly-reference-limit" : "above-monthly-reference-limit", monthlyIncomeLimit: limit, comparisonBasis: "exact-cross-products-without-monthly-income-rounding", incomeNumerator, referenceDivisor, limitNumerator }),
        monthlySubsidyTheoretical, periodSubsidyUncapped, periodSubsidyTheoretical, monthlyMaximumApplied, periodSubsidyBeforeRounding,
        rounding: Object.freeze({ mode: "half-up", decimals: 2, before: periodSubsidyBeforeRounding.value, after: determined.amount, changed: determined.rounded }),
        umaMonthly, umaValueYear: uma.data.valueYear, subsidyRateProportion: rate, submonthlyDivisor: divisor,
        parameters: Object.freeze({ uma: snapshot(uma), subsidy: snapshot(subsidy) }),
        fiscalPackageVersion: isr.data.fiscalPackageVersion,
        parameterSetIds: Object.freeze([...isr.data.parameterSetIds, uma.id, subsidy.id]),
        parameterSetVersions: Object.freeze([...isr.data.parameterSetVersions, Object.freeze({ id: uma.id, version: uma.version }), Object.freeze({ id: subsidy.id, version: subsidy.version })]),
        sources: Object.freeze(sources), resultNature: "estimated-subsidy-and-provisional-isr-not-final-withholding", temporalScope: "effective-date-snapshot", monthlyReconciliation: "not-simulated",
        actualMonthlyContext: Object.freeze({ income: null, priorSubsidyApplied: null, priorIsrWithheld: null, otherPayments: null, employerElection: "not-evaluated" }),
        excessCarryForwardAllowed: false, minimumWageWithholdingException: isr.data.minimumWageWithholdingException, finalWithholding: isr.data.finalWithholding,
        reconciliationVerified: true, conventionVersion: STANDARD_CONVENTIONS.id, policyVersion: STANDARD_EMPLOYMENT_SUBSIDY_POLICY.id, precisionPolicy: DECIMAL_POLICY.id,
        assumptions: Object.freeze([
          "Perfil ordinario fijo completamente gravado; se reutiliza ISR por tarifa sin modificar su cálculo ni descontar IMSS de la base.",
          "Ingreso mensual de referencia semanal = bruto ×30/7; quincenal = bruto ×2; mensual = bruto mensual. Son convenciones explícitas de simulación.",
          "La elegibilidad estimada compara productos exactos con el límite oficial, sin redondear previamente la referencia mensual.",
          "Cuota mensual teórica = UMA mensual oficial × porcentaje versionado; no se sustituye por un monto fijo de considerandos.",
          "Periodos menores: cuota mensual interna × días / divisor normativo; periodo mensual usa cuota mensual completa, no ×30/30.4.",
          "Solo se redondea half-up el subsidio del periodo después de prorrateo, límite mensual por pago y elegibilidad; no se redondea primero la cuota mensual o diaria.",
          "Las divisiones periódicas conservan 50 dígitos con exactitud identificada; la aplicación usa importes ya determinados a centavos, sin otro redondeo.",
          "Aplicación potencial = menor entre subsidio determinado e ISR por tarifa; ISR después del subsidio provisional, no retención final.",
          "No se conoce ingreso mensual real, pagos adicionales, subsidios previos ni elección de empleador. No se reproduce conciliación ni límite acumulado mensual.",
          "El excedente no se entrega en efectivo, no se acumula al neto ni se traslada a ISR posterior (decreto 01/05/2024, art. Segundo, segundo párrafo vigente).",
        ]), suaEquivalence: "not-validated", contpaqiEquivalence: "not-validated",
      }), issues: Object.freeze([]), warnings,
    })
  } catch (error) {
    if (!(error instanceof FiscalFoundationError)) throw error
    return failure([Object.freeze({ field: "parameters", kind: error.code === "UNSUPPORTED_DATE" ? "unsupported-scenario" : error.code === "DECIMAL_RANGE" ? "technical-range" : "parameter-data", code: error.code, message: error.message })], warnings, isr)
  }
}
