import { FiscalFoundationError } from "./errors"
import { addDecimals, compareDecimals, DECIMAL_POLICY, decimalText, divideDecimals, moneyText, multiplyDecimals, presentMoney, type DecimalComputation } from "./money"
import { normalizeStandardIntegration, integrationFailure } from "./standard-profile-validation"
import type { StandardIntegrationContext, StandardSalaryIntegrationResult, TheoreticalMoneyValue } from "./standard-integration-contracts"

export const STANDARD_INTEGRATION_RULES = Object.freeze({
  id: "theoretical-fixed-integration-2026-v1",
  annualizationDays: "365",
  availability: "theoretical-integration-only" as const,
  vacationTreatment: "premium-only-already-paid-ordinary-vacation-salary" as const,
})

function nonNegative(value: string) {
  const parsed = decimalText(value)
  if (parsed.startsWith("-")) throw new FiscalFoundationError("INVALID_MONEY_SIGN", "No se admiten prestaciones negativas.")
  return parsed
}

function propagated(final: DecimalComputation, preceding: readonly DecimalComputation[] = []): DecimalComputation {
  return Object.freeze({ ...final, exact: final.exact && preceding.every(value => value.exact) })
}

/** The divisor is contractual, not an actual cotization-day count. */
export function calculateContractualDailySalary(grossPeriodSalary: string, contractualDivisor: string): DecimalComputation {
  const gross = moneyText(grossPeriodSalary, "positive")
  const divisor = decimalText(contractualDivisor)
  if (!["7", "15", "30"].includes(divisor)) throw new FiscalFoundationError("INCOMPATIBLE_PARAMETERS", "El divisor contractual autorizado es 7, 15 o 30.")
  return divideDecimals(gross, divisor)
}

function factorComponents(annualBonusDays: string, annualVacationDays: string, vacationPremiumPercent: string) {
  const bonus = nonNegative(annualBonusDays)
  const vacation = nonNegative(annualVacationDays)
  const premium = divideDecimals(nonNegative(vacationPremiumPercent), "100")
  const premiumDays = propagated(multiplyDecimals(vacation, premium.value), [premium])
  const equivalentDays = propagated(addDecimals(bonus, premiumDays.value), [premiumDays])
  const annualIncrement = propagated(divideDecimals(equivalentDays.value, STANDARD_INTEGRATION_RULES.annualizationDays), [equivalentDays])
  const factor = propagated(addDecimals("1", annualIncrement.value), [annualIncrement])
  return Object.freeze({ factor, equivalentDays })
}

/** FI = 1 + (A + V × (percentage / 100)) / 365. No vacation salary double-count. */
export function calculateFixedIntegrationFactor(annualBonusDays: string, annualVacationDays: string, vacationPremiumPercent: string): DecimalComputation {
  return factorComponents(annualBonusDays, annualVacationDays, vacationPremiumPercent).factor
}

/** Uses internal quantities, never two-decimal representations. No SBC bounds. */
export function calculateTheoreticalSdi(dailySalary: DecimalComputation, factor: DecimalComputation): DecimalComputation {
  if (dailySalary.precision !== DECIMAL_POLICY.significantDigits || factor.precision !== DECIMAL_POLICY.significantDigits || typeof dailySalary.exact !== "boolean" || typeof factor.exact !== "boolean") {
    throw new FiscalFoundationError("INCOMPATIBLE_PARAMETERS", "Las cantidades internas deben conservar la política decimal del núcleo.")
  }
  if (compareDecimals(dailySalary.value, "0") <= 0 || compareDecimals(factor.value, "1") < 0) {
    throw new FiscalFoundationError("INVALID_MONEY_SIGN", "El salario diario debe ser positivo y el FI no inferior a uno.")
  }
  return propagated(multiplyDecimals(dailySalary.value, factor.value), [dailySalary, factor])
}

function theoreticalMoney(internal: DecimalComputation): TheoreticalMoneyValue {
  const presentation = presentMoney(internal.value, DECIMAL_POLICY.displayRounding)
  return Object.freeze({ internal, presentation })
}

export function calculateStandardSalaryIntegration(input: unknown, context: StandardIntegrationContext): StandardSalaryIntegrationResult {
  const normalized = normalizeStandardIntegration(input, context)
  if (normalized.status !== "valid") return normalized
  try {
    const data = normalized.data
    const dailySalary = calculateContractualDailySalary(data.grossPeriodSalary, data.contractualDivisor)
    const components = factorComponents(data.benefits.annualBonusDays, data.benefits.annualVacationDays, data.benefits.vacationPremiumPercent)
    const sdi = calculateTheoreticalSdi(dailySalary, components.factor)
    return Object.freeze({
      status: "estimated", inputValidation: "valid", issues: normalized.issues, warnings: normalized.warnings,
      data: Object.freeze({
        normalized: data, dailySalary: theoreticalMoney(dailySalary), factor: components.factor,
        equivalentAnnualBenefitDays: components.equivalentDays, theoreticalSdi: theoreticalMoney(sdi),
        applicableSbc: null, sbcStatus: "not-calculated", precisionPolicy: DECIMAL_POLICY.id,
        integrationRulesVersion: STANDARD_INTEGRATION_RULES.id,
        assumptions: Object.freeze([
          "Salario ordinario fijo bruto explícito; no se obtiene desde un neto.",
          "Prestaciones anuales conocidas y declaradas; no se infiere antigüedad ni pago efectivo de prestaciones.",
          "Anualización de 365 días para el perfil 2026.",
          "Las vacaciones pagadas ya están en el salario ordinario; solo su prima incrementa el factor.",
          "El divisor contractual no determina días cotizados reales.",
          "SDI teórico sin pisos, topes ni SBC registrado. No se evalúa el salario mínimo del sueldo.",
        ]),
        suaEquivalence: "not-validated",
      }),
    })
  } catch (error) {
    if (!(error instanceof FiscalFoundationError)) throw error
    return integrationFailure([Object.freeze({ field: "calculation", kind: error.code === "DECIMAL_RANGE" ? "technical-range" : "invalid-value", code: error.code, message: error.message })], normalized.warnings)
  }
}
