import { civilDate, validateDateInterval, type CivilDate } from "./civil-date"
import type { FiscalParameterSet, IsrTariff, PayrollPeriodicity } from "./contracts"
import { FiscalFoundationError } from "./errors"
import { addDecimals, compareDecimals, DECIMAL_POLICY, decimalText, divideDecimals, moneyText, multiplyDecimals, presentMoney, subtractDecimals, type DecimalComputation, type MoneyText } from "./money"
import { selectByEffectiveDate, validateIsrTariff } from "./parameters"
import { STANDARD_CONVENTIONS } from "./simulation-conventions"
import type { IsrTariffIssue, IsrTariffWarning, SelectedIsrBracket, StandardEstimatedIsrByTariffResult, StandardIsrTariffContext } from "./isr-tariff-contracts"

const inputFields = new Set(["profileId", "grossPeriodSalary", "periodicity", "referenceDate"])
const sections = Object.freeze({ weekly: "B.II", fortnightly: "B.IV", monthly: "B.V" } as const)
const pendingWarnings: readonly IsrTariffWarning[] = Object.freeze([
  Object.freeze({ code: "EMPLOYMENT_SUBSIDY_NOT_EVALUATED", message: "El subsidio no se evalúa; su importe permanece desconocido, no igual a cero." }),
  Object.freeze({ code: "MINIMUM_WAGE_WITHHOLDING_EXCEPTION_NOT_EVALUATED", message: "La excepción de retención por salario mínimo queda pendiente de condiciones legales y contexto mensual en retención final." }),
  Object.freeze({ code: "NOT_FINAL_ISR_WITHHOLDING", message: "Este importe es ISR por tarifa antes del subsidio; no es ISR final retenido ni descuento al trabajador." }),
])

export const STANDARD_ISR_TARIFF_POLICY = Object.freeze({
  id: "standard-isr-tariff-2026-final-half-up-v1",
  nature: "explicit-simulation-policy" as const,
  taxableIncomeBasis: "ordinary-period-gross-without-imss-deduction" as const,
  bracketSelection: "inclusive-cent-grid" as const,
  zeroBase: "zero-tax-without-selecting-or-extending-first-bracket" as const,
  order: "exact-excess-then-exact-marginal-tax-then-fixed-fee-then-final-cent-rounding" as const,
  rounding: "half-up" as const,
  decimals: 2 as const,
  resultNature: "isr-by-tariff-before-subsidy-not-final-withholding" as const,
})

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
function absent(value: unknown): boolean {
  return value == null || (typeof value === "string" && value.trim() === "")
}
function issue(field: IsrTariffIssue["field"], kind: IsrTariffIssue["kind"], code: string, message: string): IsrTariffIssue {
  return Object.freeze({ field, kind, code, message })
}
function failure(issues: readonly IsrTariffIssue[]): StandardEstimatedIsrByTariffResult {
  return Object.freeze({
    status: issues.some(item => item.kind === "unsupported-scenario") ? "not-supported" : "not-determinable",
    data: null, isrByTariff: null, issues: Object.freeze([...issues]), warnings: pendingWarnings,
  })
}
function exact(value: DecimalComputation): DecimalComputation {
  if (!value.exact) throw new FiscalFoundationError("DECIMAL_RANGE", "La operación ISR pierde precisión interna antes de determinar centavos.")
  return value
}

/** Only the requested ISR series is required; IMSS/UMA/subsidy data are not read. */
function selectTariff(context: StandardIsrTariffContext, date: string, periodicity: PayrollPeriodicity): FiscalParameterSet<IsrTariff> {
  if (!context || typeof context.fiscalPackageVersion !== "string" || !context.fiscalPackageVersion.trim() || !record(context.supportedDates) || !Array.isArray(context.isrTariffs)) {
    throw new FiscalFoundationError("INVALID_METADATA", "Falta el paquete, su cobertura o las tarifas versionadas.")
  }
  validateDateInterval(context.supportedDates)
  if (context.exercise !== 2026 || context.supportedDates.from < "2026-01-01" || context.supportedDates.through > "2026-12-31") {
    throw new FiscalFoundationError("INCOMPATIBLE_PARAMETERS", "El paquete debe corresponder al ejercicio y cobertura 2026.")
  }
  if (context.isrTariffs.some(set => !record(set) || typeof set.key !== "string" || !Object.hasOwn(sections, set.key))) {
    throw new FiscalFoundationError("INCOMPATIBLE_PARAMETERS", "Las series ISR incluyen una periodicidad no identificada o fuera de alcance.")
  }
  const sets = context.isrTariffs.filter(set => set.key === periodicity)
  for (const set of sets) {
    // Structural guards keep incomplete runtime data inside the fiscal error contract.
    if (typeof set.id !== "string" || typeof set.version !== "string" || !Array.isArray(set.sources)
      || set.sources.some((source: unknown) => !record(source) || typeof source.document !== "string" || typeof source.locator !== "string")
      || !record(set.data) || !Array.isArray(set.data.rows)) {
      throw new FiscalFoundationError("INVALID_METADATA", "La tarifa carece de identificadores, fuentes o filas estructuradas.")
    }
    if (set.kind !== "isr-tariff" || set.data.exercise !== 2026 || set.data.periodicity !== periodicity) {
      throw new FiscalFoundationError("INCOMPATIBLE_PARAMETERS", "La tarifa no corresponde al periodo y ejercicio solicitados.")
    }
    for (const row of set.data.rows) {
      if (!record(row) || typeof row.lower !== "string" || (row.upper !== null && typeof row.upper !== "string") || typeof row.fixedFee !== "string" || typeof row.ratePercent !== "string") {
        throw new FiscalFoundationError("INVALID_TARIFF", "Una fila de la tarifa está incompleta.")
      }
    }
    validateIsrTariff(set.data)
  }
  return selectByEffectiveDate(sets, date, context.supportedDates)
}

function snapshotTariff(set: FiscalParameterSet<IsrTariff>): FiscalParameterSet<IsrTariff> {
  return Object.freeze({
    ...set,
    sources: Object.freeze(set.sources.map(source => Object.freeze({ ...source }))),
    data: Object.freeze({ ...set.data, rows: Object.freeze(set.data.rows.map(row => Object.freeze({ ...row }))) }),
  })
}

/** Fully taxable ordinary period gross only. No subsidy, withholding exception or net pay. */
export function calculateStandardEstimatedIsrByTariff(input: unknown, context: StandardIsrTariffContext): StandardEstimatedIsrByTariffResult {
  if (!record(input)) return failure([issue("request", input == null ? "missing-data" : "invalid-format", "INVALID_ISR_TARIFF_REQUEST", "Se requiere captura explícita de bruto ordinario gravado, periodo, perfil y fecha.")])
  const issues: IsrTariffIssue[] = []
  if (Object.keys(input).some(key => !inputFields.has(key))) issues.push(issue("request", "unsupported-scenario", "ISR_EXTRA_CONCEPT_NOT_SUPPORTED", "Este perfil solo admite bruto ordinario completamente gravado; no recibe IMSS, exentos, subsidio, neto ni otros conceptos."))
  if (absent(input.profileId)) issues.push(issue("profileId", "missing-data", "REQUIRED_PROFILE", "Indica el perfil estándar explícitamente."))
  else if (typeof input.profileId !== "string") issues.push(issue("profileId", "invalid-format", "INVALID_PROFILE_FORMAT", "El perfil debe ser una cadena."))
  else if (input.profileId !== STANDARD_CONVENTIONS.id) issues.push(issue("profileId", "unsupported-scenario", "ISR_PROFILE_NOT_SUPPORTED", "Solo se admite salario ordinario fijo completamente gravado del perfil estándar 2026."))
  if (absent(input.periodicity)) issues.push(issue("periodicity", "missing-data", "REQUIRED_PERIODICITY", "Indica la periodicidad explícitamente."))
  else if (typeof input.periodicity !== "string") issues.push(issue("periodicity", "invalid-format", "INVALID_PERIODICITY_FORMAT", "La periodicidad debe ser una cadena."))
  else if (!Object.hasOwn(sections, input.periodicity)) issues.push(issue("periodicity", "unsupported-scenario", "ISR_PERIODICITY_NOT_SUPPORTED", "Solo se admiten pagos de siete días, quince días y mensuales."))

  let taxableIncome: MoneyText | undefined
  if (absent(input.grossPeriodSalary)) issues.push(issue("grossPeriodSalary", "missing-data", "REQUIRED_GROSS", "Captura el bruto ordinario gravado del periodo; no se infiere desde neto."))
  else {
    try { taxableIncome = moneyText(input.grossPeriodSalary as string, "non-negative") }
    catch (error) {
      if (!(error instanceof FiscalFoundationError)) throw error
      issues.push(issue("grossPeriodSalary", error.code === "DECIMAL_RANGE" ? "technical-range" : error.code === "INVALID_MONEY_SIGN" ? "invalid-value" : "invalid-format", error.code, error.message))
    }
  }
  let referenceDate: CivilDate | undefined
  if (absent(input.referenceDate)) issues.push(issue("referenceDate", "missing-data", "REQUIRED_DATE", "Indica la fecha normativa explícitamente."))
  else {
    try {
      referenceDate = civilDate(input.referenceDate as string)
      if (!referenceDate.startsWith("2026-")) issues.push(issue("referenceDate", "unsupported-scenario", "ISR_REFERENCE_DATE_NOT_SUPPORTED", "No se sustituye una fecha fuera de 2026 por otro ejercicio."))
    } catch (error) {
      if (!(error instanceof FiscalFoundationError)) throw error
      issues.push(issue("referenceDate", "invalid-format", error.code, error.message))
    }
  }
  if (issues.length || taxableIncome === undefined || referenceDate === undefined) return failure(issues)

  try {
    const base = taxableIncome
    const periodicity = input.periodicity as PayrollPeriodicity
    const tariff = snapshotTariff(selectTariff(context, referenceDate, periodicity))
    const isZero = compareDecimals(base, "0") === 0
    let selectedBracket: SelectedIsrBracket | null = null
    let isrBeforeRounding = exact(addDecimals("0", "0"))
    if (!isZero) {
      const index = tariff.data.rows.findIndex(row => compareDecimals(base, row.lower) >= 0 && (row.upper === null || compareDecimals(base, row.upper) <= 0))
      if (index < 0) throw new FiscalFoundationError("INVALID_TARIFF", "La base gravable no encuentra un tramo: no se aproxima ni extiende otro intervalo.")
      const row = tariff.data.rows[index]
      const rateProportion = exact(divideDecimals(row.ratePercent, "100"))
      const excessOverLower = exact(subtractDecimals(base, row.lower))
      const taxOnExcess = exact(multiplyDecimals(excessOverLower.value, rateProportion.value))
      isrBeforeRounding = exact(addDecimals(row.fixedFee, taxOnExcess.value))
      selectedBracket = Object.freeze({
        number: index + 1, lower: moneyText(row.lower), upper: row.upper === null ? null : moneyText(row.upper),
        fixedFee: moneyText(row.fixedFee), ratePercent: decimalText(row.ratePercent), rateProportion, excessOverLower, taxOnExcess,
      })
    }
    const determined = presentMoney(isrBeforeRounding.value, STANDARD_ISR_TARIFF_POLICY.rounding)
    const warnings = isZero ? Object.freeze([...pendingWarnings, Object.freeze({ code: "ZERO_BASE_WITHOUT_TARIFF_BRACKET" as const, message: "Base cero: ISR aritmético cero sin seleccionar un tramo. El primer límite inferior oficial permanece en 0.01; no se aplica una exención de retención." })]) : pendingWarnings
    return Object.freeze({
      status: "estimated", inputValidation: "valid", isrByTariff: determined.amount,
      data: Object.freeze({
        profileId: STANDARD_CONVENTIONS.id, periodicity, referenceDate,
        salaryNature: "ordinary-fixed", taxTreatment: "fully-taxable", taxableIncome: base,
        taxableIncomeBasis: STANDARD_ISR_TARIFF_POLICY.taxableIncomeBasis, resultNature: STANDARD_ISR_TARIFF_POLICY.resultNature,
        tariff, tariffSection: sections[periodicity], selectedBracket,
        bracketSelection: isZero ? "zero-base-no-bracket" : "inclusive-cent-grid", isrBeforeRounding,
        rounding: Object.freeze({ mode: "half-up", decimals: 2, before: isrBeforeRounding.value, after: determined.amount, changed: determined.rounded }),
        subsidy: Object.freeze({ status: "not-evaluated", amount: null }),
        minimumWageWithholdingException: Object.freeze({ status: "not-evaluated" }),
        finalWithholding: Object.freeze({ status: "not-calculated", amount: null }),
        fiscalPackageVersion: context.fiscalPackageVersion,
        parameterSetIds: Object.freeze([tariff.id]), parameterSetVersions: Object.freeze([Object.freeze({ id: tariff.id, version: tariff.version })]),
        sources: tariff.sources, policyVersion: STANDARD_ISR_TARIFF_POLICY.id, precisionPolicy: DECIMAL_POLICY.id,
        assumptions: Object.freeze([
          "Base gravable igual al bruto ordinario del periodo, completamente gravado; no se restan cuotas IMSS.",
          "Se selecciona la tarifa B.II/B.IV/B.V por periodicidad y vigencia de la fecha normativa puntual 2026.",
          "Captura en centavos: no se redondean bases con más de dos decimales para forzar un tramo.",
          "Se conservan cuota fija y tasa oficiales aun si hay discontinuidad aritmética entre tramos.",
          "Se conserva precisión interna en excedente, tasa y suma; half-up solo al determinar el ISR por tarifa a centavos.",
          "Base cero produce cero sin extender el tramo cuyo límite inferior oficial es 0.01.",
          "Subsidio no evaluado, no igual a cero; excepción de retención por salario mínimo pendiente de condiciones y contexto mensual.",
          "ISR por tarifa antes del subsidio, no ISR final retenido ni descuento al trabajador; no hay cálculo bruto/neto.",
        ]),
        suaEquivalence: "not-validated", contpaqiEquivalence: "not-validated",
      }),
      issues: Object.freeze([]), warnings,
    })
  } catch (error) {
    if (!(error instanceof FiscalFoundationError)) throw error
    return failure([issue("parameters", error.code === "UNSUPPORTED_DATE" ? "unsupported-scenario" : error.code === "DECIMAL_RANGE" ? "technical-range" : "parameter-data", error.code, error.message)])
  }
}
