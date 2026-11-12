import type { FiscalParameterSet, ImssConstants, MinimumWages, UmaValues } from "./contracts"
import { FiscalFoundationError } from "./errors"
import { compareDecimals, DECIMAL_POLICY, decimalText, moneyText, multiplyDecimals, presentMoney, subtractDecimals, type DecimalComputation } from "./money"
import { selectByEffectiveDate } from "./parameters"
import { calculateStandardSalaryIntegration } from "./salary-integration"
import type { SbcBoundResult, SbcFailure, SbcIssue, SbcWarning, StandardEstimatedSbcResult, StandardSbcContext } from "./sbc-contracts"

export const STANDARD_SBC_POLICY = Object.freeze({
  id: "estimated-sbc-general-2026-half-up-v1",
  supportedArea: "general-zone" as const,
  order: "internal-sdi-then-legal-limits-then-cent-rounding-then-invariant-check" as const,
  rounding: "half-up" as const,
  decimals: 2 as const,
  nature: "explicit-simulation-policy" as const,
  suaEquivalence: "not-validated" as const,
})

function issue(field: SbcIssue["field"], kind: SbcIssue["kind"], code: string, message: string): SbcIssue {
  return Object.freeze({ field, kind, code, message })
}
function failure(issues: readonly SbcIssue[], warnings: readonly SbcWarning[] = []): SbcFailure {
  return Object.freeze({
    status: issues.some(item => item.kind === "unsupported-scenario") ? "not-supported" : "not-determinable",
    data: null, issues: Object.freeze([...issues]), warnings: Object.freeze([...warnings]),
  })
}

/** Bounding only. Inputs are internal SDI and legal limits, not UI money values. */
export function applyEstimatedSbcBounds(sdi: DecimalComputation, lowerLimit: string, upperLimit: string): SbcBoundResult {
  if (sdi.precision !== DECIMAL_POLICY.significantDigits || typeof sdi.exact !== "boolean") {
    throw new FiscalFoundationError("INCOMPATIBLE_PARAMETERS", "El SDI debe conservar la precisión interna del núcleo.")
  }
  const raw = decimalText(sdi.value)
  if (compareDecimals(raw, "0") <= 0) throw new FiscalFoundationError("INVALID_MONEY_SIGN", "El SDI teórico debe ser positivo.")
  // Official 2026 bounds lie on the cent grid. Reject other representations
  // rather than invent a directional rounding prescription for future limits.
  const lower = moneyText(lowerLimit, "positive")
  const upper = moneyText(upperLimit, "positive")
  if (compareDecimals(lower, upper) >= 0) throw new FiscalFoundationError("INCOMPATIBLE_PARAMETERS", "El piso debe ser inferior al tope de cotización.")
  const below = compareDecimals(raw, lower)
  const above = compareDecimals(raw, upper)
  const relation = below < 0 ? "below-lower" : below === 0 ? "at-lower" : above > 0 ? "above-upper" : above === 0 ? "at-upper" : "inside-limits"
  const limitApplied = below < 0 ? "lower" : above > 0 ? "upper" : "none"
  const limited = decimalText(limitApplied === "lower" ? lower : limitApplied === "upper" ? upper : raw)
  const shown = presentMoney(limited, STANDARD_SBC_POLICY.rounding)
  if (compareDecimals(shown.amount, lower) < 0 || compareDecimals(shown.amount, upper) > 0) {
    throw new FiscalFoundationError("INCOMPATIBLE_PARAMETERS", "El redondeo no puede devolver un SBC fuera del intervalo legal.")
  }
  const difference = subtractDecimals(limited, raw)
  return Object.freeze({
    internalSdi: sdi, limitedInternalValue: limited, estimatedSbc: shown.amount,
    relation, limitApplied,
    limitReason: limitApplied === "lower" ? "minimum-daily-wage-floor" : limitApplied === "upper" ? "uma-daily-ceiling" : "within-legal-interval",
    limitDifference: Object.freeze({ ...difference, exact: difference.exact && sdi.exact }),
    rounding: Object.freeze({ mode: STANDARD_SBC_POLICY.rounding, decimals: STANDARD_SBC_POLICY.decimals, before: limited, after: shown.amount, changed: shown.rounded, verifiedWithinLimits: true }),
  })
}

/** Reuses theoretical integration. No quotas, withholding or contract rewriting. */
export function calculateStandardEstimatedSbc(input: unknown, context: StandardSbcContext): StandardEstimatedSbcResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return failure([issue("request", input == null ? "missing-data" : "invalid-format", "INVALID_SBC_REQUEST", "Se requiere captura estándar con zona salarial explícita.")])
  }
  const capture = input as Record<string, unknown>
  if (capture.area === undefined || capture.area === null || (typeof capture.area === "string" && capture.area.trim() === "")) {
    return failure([issue("area", "missing-data", "REQUIRED_SALARY_AREA", "Indica zona general explícitamente; no se infiere desde una entidad federativa.")])
  }
  if (typeof capture.area !== "string") return failure([issue("area", "invalid-format", "INVALID_SALARY_AREA", "La zona salarial debe ser un identificador.")])
  if (capture.area !== STANDARD_SBC_POLICY.supportedArea) {
    return failure([issue("area", "unsupported-scenario", "SALARY_AREA_NOT_SUPPORTED", "El perfil inicial admite únicamente zona general; ZLFN no se infiere ni se aproxima.")])
  }
  const { area: _area, ...integrationInput } = capture
  const integration = calculateStandardSalaryIntegration(integrationInput, context)
  if (integration.status !== "estimated") return integration
  const warnings: SbcWarning[] = [...integration.warnings]
  try {
    if (!Array.isArray(context.uma) || !Array.isArray(context.minimumWages) || !Array.isArray(context.imssConstants)) {
      return failure([issue("parameters", "missing-data", "REQUIRED_SBC_PARAMETERS", "Faltan UMA, salarios mínimos o límites normativos versionados.")], warnings)
    }
    const date = integration.data.normalized.referenceDate
    const uma = selectByEffectiveDate<UmaValues>(context.uma, date, context.supportedDates)
    const minima = selectByEffectiveDate<MinimumWages>(context.minimumWages, date, context.supportedDates)
    const constants = selectByEffectiveDate<ImssConstants>(context.imssConstants, date, context.supportedDates)
    const sets: readonly FiscalParameterSet<unknown>[] = [uma, minima, constants]
    if (uma.kind !== "uma" || uma.key !== "daily-monthly-annual" || minima.kind !== "minimum-wages" || minima.key !== "official-zones" || constants.kind !== "imss-constants" || constants.key !== "ordinary-regime") {
      throw new FiscalFoundationError("INCOMPATIBLE_PARAMETERS", "Las series no corresponden a los límites de SBC del perfil.")
    }
    if (uma.data.unit !== "MXN" || ![2025, 2026].includes(uma.data.valueYear) || constants.data.minimumSbcReference !== "area-minimum-daily-wage" || !minima.data.territorialDefinitionReference) {
      throw new FiscalFoundationError("INVALID_METADATA", "La unidad, piso o zona del límite no están identificados correctamente.")
    }
    const umaDaily = moneyText(uma.data.daily, "positive")
    const lower = moneyText(minima.data.general.daily, "positive")
    const multiplier = decimalText(constants.data.sbcCeilingUmaDailyMultiple)
    if (compareDecimals(multiplier, "0") <= 0) throw new FiscalFoundationError("INVALID_METADATA", "El múltiplo normativo de UMA debe ser positivo.")
    const ceiling = multiplyDecimals(umaDaily, multiplier)
    if (!ceiling.exact) throw new FiscalFoundationError("INCOMPATIBLE_PARAMETERS", "El límite superior debe conservar su producto decimal exacto.")
    const upper = moneyText(ceiling.value, "positive")
    const daily = integration.data.dailySalary.internal.value
    const contractComparison = compareDecimals(daily, lower)
    if (contractComparison < 0) warnings.push(Object.freeze({
      field: "grossPeriodSalary", code: "CONTRACTUAL_DAILY_SALARY_BELOW_GENERAL_MINIMUM",
      declaredGross: integration.data.normalized.grossPeriodSalary, contractualDailySalary: daily,
      referenceMinimumDailySalary: lower, sourceReference: "LFT-85-and-CONASAMI-2026",
      message: "El diario contractual no redondeado es inferior al mínimo general: posible incumplimiento. Estimar el piso de SBC no aumenta ni corrige el salario capturado.",
    }))
    const sbc = applyEstimatedSbcBounds(integration.data.theoreticalSdi.internal, lower, upper)
    return Object.freeze({
      status: "estimated", inputValidation: "valid", issues: Object.freeze([]), warnings: Object.freeze(warnings),
      data: Object.freeze({
        integration: integration.data, area: STANDARD_SBC_POLICY.supportedArea, referenceDate: date,
        sbcNature: "estimated-not-registered", sbc,
        limits: Object.freeze({ lower, upper, umaDaily, umaValueYear: uma.data.valueYear, ceilingUmaDailyMultiple: multiplier, ceilingProductExact: ceiling.exact }),
        contractualMinimumCheck: Object.freeze({
          relation: contractComparison < 0 ? "below-general-minimum" : contractComparison === 0 ? "at-general-minimum" : "above-general-minimum",
          comparedValue: daily, referenceMinimum: lower, comparisonBasis: "unrounded-contractual-daily-salary",
          declaredGrossUnchanged: integration.data.normalized.grossPeriodSalary, contractSalaryModified: false,
        }),
        fiscalPackageVersion: context.fiscalPackageVersion,
        parameterSetIds: Object.freeze([...integration.data.normalized.parameterSetIds, ...sets.map(set => set.id)]),
        sources: Object.freeze([...integration.data.normalized.sources, ...sets.flatMap(set => set.sources)]),
        policyVersion: STANDARD_SBC_POLICY.id, precisionPolicy: DECIMAL_POLICY.id,
        assumptions: Object.freeze([
          "Se reutiliza la integración teórica adjunta del Hito 2D.1 sin modificar sus valores ni fórmulas.",
          "SBC estimado para zona general explícita; no incluye mínimos profesionales ni modalidad de ZLFN.",
          "Límites por fecha normativa puntual del escenario estándar; no se reconstruye afiliación ni días cotizados reales.",
          "El piso de cotización no regulariza ni modifica una remuneración contractual inferior al mínimo.",
          "Primero se limita el SDI interno, luego se determina a centavos con half-up y se verifica el intervalo.",
          "No existe confirmación de SBC comunicado al IMSS; no se declara SBC registrado ni homologación SUA.",
        ]),
        suaEquivalence: "not-validated", contpaqiEquivalence: "not-validated",
      }),
    })
  } catch (error) {
    if (!(error instanceof FiscalFoundationError)) throw error
    return failure([issue("parameters", error.code === "UNSUPPORTED_DATE" ? "unsupported-scenario" : error.code === "DECIMAL_RANGE" ? "technical-range" : "parameter-data", error.code, error.message)], warnings)
  }
}
