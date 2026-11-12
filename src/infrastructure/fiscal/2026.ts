import type {
  FiscalParameterKind, FiscalParameterSet, FiscalRegistry, FiscalSource, PayrollPeriodicity,
} from "../../domain/payroll/contracts"
import { compareDecimals, decimalText, moneyText } from "../../domain/payroll/money"
import { FiscalFoundationError } from "../../domain/payroll/errors"
import { selectByEffectiveDate, validateIsrTariff, validateParameterTimeline } from "../../domain/payroll/parameters"
import importedIsr from "./parameters/2026/isr.json"
import { FISCAL_SOURCES } from "./sources"
import type { StandardIntegrationContext } from "../../domain/payroll/standard-integration-contracts"
import type { StandardSbcContext } from "../../domain/payroll/sbc-contracts"
import type { StandardIsrTariffContext } from "../../domain/payroll/isr-tariff-contracts"
import type { StandardEmploymentSubsidyContext } from "../../domain/payroll/employment-subsidy-contracts"
import type { StandardGrossToNetContext } from "../../domain/payroll/gross-to-net-contracts"

function immutable<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(immutable)
    Object.freeze(value)
  }
  return value
}

function parameterSet<T>(id: string, kind: FiscalParameterKind, key: string, data: T, sources: readonly FiscalSource[], from = "2026-01-01", through = "2026-12-31"): FiscalParameterSet<T> {
  return {
    id, kind, key, version: `${id}-source-2026-10-13`,
    effectiveFrom: from, effectiveThrough: through,
    validation: "source-verified", validationScope: "source-data-only", sources, data,
  }
}

export const FISCAL_PARAMETERS_2026: FiscalRegistry = immutable({
  version: "mx-fiscal-2026-source-v3",
  exercise: 2026,
  supportedDates: { from: "2026-01-01", through: "2026-12-31" },
  isrTariffs: (["weekly", "fortnightly", "monthly"] as const).map(periodicity => parameterSet(
    `mx-isr-2026-${periodicity}`, "isr-tariff", periodicity,
    { exercise: 2026, periodicity, rows: importedIsr[periodicity] }, [FISCAL_SOURCES.isrSat, FISCAL_SOURCES.isrDof],
  )),
  uma: [
    parameterSet("mx-uma-2025-for-january-2026", "uma", "daily-monthly-annual", {
      valueYear: 2025, daily: "113.14", monthly: "3439.46", annual: "41273.52", unit: "MXN" as const,
    }, [FISCAL_SOURCES.uma2025], "2025-02-01", "2026-01-31"),
    parameterSet("mx-uma-2026", "uma", "daily-monthly-annual", {
      valueYear: 2026, daily: "117.31", monthly: "3566.22", annual: "42794.64", unit: "MXN" as const,
    }, [FISCAL_SOURCES.uma2026], "2026-02-01"),
  ],
  minimumWages: [parameterSet("mx-minimum-wages-2026", "minimum-wages", "official-zones", {
    general: { daily: "315.04", publishedMonthlyReference: "9582.47" },
    northernBorder: { daily: "440.87", publishedMonthlyReference: "13409.80" },
    territorialDefinitionReference: "CONASAMI DOF 09/12/2025, resolutivo Primero: ZLFN por municipios; ZSMG resto del país",
    monthlyExpressionReference: "daily-times-365-divided-by-12" as const,
  }, [FISCAL_SOURCES.minimumWages, FISCAL_SOURCES.contractualMinimumSalary])],
  subsidy: [
    parameterSet("mx-employment-subsidy-january-2026", "employment-subsidy", "2026-decree", {
      umaMonthlyValueYear: 2025, rateProportion: "0.1559", monthlyIncomeLimit: "11492.66", submonthlyDivisor: "30.4",
      monthlyQuotaDefinition: "official-uma-monthly-times-rate" as const,
      formulaText: "UMA mensual vigente × 15.59%; en enero sustituye a 15.02% (Transitorio Segundo)",
    }, [FISCAL_SOURCES.subsidy, FISCAL_SOURCES.uma2025], "2026-01-01", "2026-01-31"),
    parameterSet("mx-employment-subsidy-february-2026", "employment-subsidy", "2026-decree", {
      umaMonthlyValueYear: 2026, rateProportion: "0.1502", monthlyIncomeLimit: "11492.66", submonthlyDivisor: "30.4",
      monthlyQuotaDefinition: "official-uma-monthly-times-rate" as const,
      formulaText: "UMA mensual vigente × 15.02% (Artículo Segundo)",
    }, [FISCAL_SOURCES.subsidy, FISCAL_SOURCES.uma2026], "2026-02-01"),
  ],
  imssConstants: [parameterSet("mx-imss-worker-constants-2026", "imss-constants", "ordinary-regime", {
    sbcCeilingUmaDailyMultiple: "25", excessThresholdUmaDailyMultiple: "3",
    workerRates: {
      "pensioner-medical": "0.00375",
      "cash-benefits": "0.0025",
      "disability-life": "0.00625",
      "unemployment-old-age": "0.01125",
      "excess-medical": "0.004",
    },
    baseReferences: {
      "pensioner-medical": "sbc" as const,
      "cash-benefits": "sbc" as const,
      "disability-life": "sbc" as const,
      "unemployment-old-age": "sbc" as const,
      "excess-medical": "sbc-excess-over-threshold" as const,
    },
    minimumSbcReference: "area-minimum-daily-wage" as const,
    workerAbsorptionReference: "LSS-36" as const,
  }, [FISCAL_SOURCES.lss, FISCAL_SOURCES.umaConstitution])],
  contractualDivisors: [parameterSet("mx-contractual-divisors", "contractual-divisors", "LSS-29-II", {
    weekly: "7", fortnightly: "15", monthly: "30",
  }, [FISCAL_SOURCES.lss])],
  laborBenefitMinima: [parameterSet("mx-labor-benefit-minima-2026", "labor-benefit-minima", "LFT-annual-benefits", {
    annualBonusDays: "15", firstAnnualVacationDays: "12", vacationPremiumPercent: "25",
    vacationSeniorityReference: "LFT-76-not-inferred" as const,
  }, [FISCAL_SOURCES.laborBenefits])],
} satisfies FiscalRegistry)

function positiveDecimal(value: string): void {
  decimalText(value)
  if (compareDecimals(value, "0") <= 0) throw new FiscalFoundationError("INVALID_METADATA", "La constante debe ser positiva.")
}

export function validateFiscalRegistry2026(registry: FiscalRegistry): void {
  if (registry.exercise !== 2026 || !registry.version.trim() || registry.supportedDates.from !== "2026-01-01" || registry.supportedDates.through !== "2026-12-31") {
    throw new FiscalFoundationError("INVALID_METADATA", "El paquete debe declarar su cobertura del ejercicio 2026.")
  }
  for (const periodicity of ["weekly", "fortnightly", "monthly"] as const) {
    const sets = registry.isrTariffs.filter(set => set.key === periodicity)
    validateParameterTimeline(sets, registry.supportedDates)
    for (const set of sets) {
      if (set.kind !== "isr-tariff" || set.data.periodicity !== periodicity || set.data.exercise !== 2026) {
        throw new FiscalFoundationError("INCOMPATIBLE_PARAMETERS", "La tarifa no corresponde a su periodo y ejercicio.")
      }
      validateIsrTariff(set.data)
    }
  }
  if (registry.isrTariffs.some(set => !["weekly", "fortnightly", "monthly"].includes(set.key))) {
    throw new FiscalFoundationError("INCOMPATIBLE_PARAMETERS", "Hay una periodicidad no declarada en el paquete.")
  }
  const groups = [
    [registry.uma, "uma", "daily-monthly-annual"],
    [registry.minimumWages, "minimum-wages", "official-zones"],
    [registry.subsidy, "employment-subsidy", "2026-decree"],
    [registry.imssConstants, "imss-constants", "ordinary-regime"],
    [registry.contractualDivisors, "contractual-divisors", "LSS-29-II"],
    [registry.laborBenefitMinima, "labor-benefit-minima", "LFT-annual-benefits"],
  ] as const
  for (const [sets, kind, key] of groups) {
    validateParameterTimeline(sets as readonly FiscalParameterSet<unknown>[], registry.supportedDates)
    if (sets.some(set => set.kind !== kind || set.key !== key)) {
      throw new FiscalFoundationError("INCOMPATIBLE_PARAMETERS", "El tipo de conjunto no corresponde a su registro.")
    }
  }
  for (const set of registry.uma) {
    for (const value of [set.data.daily, set.data.monthly, set.data.annual]) moneyText(value, "positive")
    if (set.data.unit !== "MXN" || ![2025, 2026].includes(set.data.valueYear)) {
      throw new FiscalFoundationError("INVALID_METADATA", "La UMA declara una unidad o año incompatible.")
    }
  }
  for (const set of registry.minimumWages) {
    for (const zone of [set.data.general, set.data.northernBorder]) {
      moneyText(zone.daily, "positive")
      moneyText(zone.publishedMonthlyReference, "positive")
    }
    if (!set.data.territorialDefinitionReference || set.data.monthlyExpressionReference !== "daily-times-365-divided-by-12") {
      throw new FiscalFoundationError("INVALID_METADATA", "Falta la definición de zonas o expresión mensual.")
    }
  }
  for (const set of registry.subsidy) {
    positiveDecimal(set.data.rateProportion)
    positiveDecimal(set.data.submonthlyDivisor)
    moneyText(set.data.monthlyIncomeLimit, "positive")
    if (compareDecimals(set.data.rateProportion, "1") > 0 || set.data.monthlyQuotaDefinition !== "official-uma-monthly-times-rate" || !set.data.formulaText) {
      throw new FiscalFoundationError("INVALID_METADATA", "El subsidio debe conservar su definición porcentual.")
    }
    const uma = selectByEffectiveDate(registry.uma, set.effectiveFrom, registry.supportedDates)
    if (uma.data.valueYear !== set.data.umaMonthlyValueYear) {
      throw new FiscalFoundationError("INCOMPATIBLE_PARAMETERS", "El porcentaje del subsidio no corresponde al año de UMA indicado.")
    }
  }
  for (const set of registry.imssConstants) {
    positiveDecimal(set.data.sbcCeilingUmaDailyMultiple)
    positiveDecimal(set.data.excessThresholdUmaDailyMultiple)
    if (compareDecimals(set.data.excessThresholdUmaDailyMultiple, set.data.sbcCeilingUmaDailyMultiple) >= 0 || set.data.minimumSbcReference !== "area-minimum-daily-wage" || set.data.workerAbsorptionReference !== "LSS-36") {
      throw new FiscalFoundationError("INVALID_METADATA", "Los límites o referencias de IMSS son incompatibles.")
    }
    for (const branch of ["pensioner-medical", "cash-benefits", "disability-life", "unemployment-old-age", "excess-medical"] as const) {
      positiveDecimal(set.data.workerRates[branch])
      if (compareDecimals(set.data.workerRates[branch], "1") > 0 || set.data.baseReferences[branch] !== (branch === "excess-medical" ? "sbc-excess-over-threshold" : "sbc")) {
        throw new FiscalFoundationError("INVALID_METADATA", "La tasa o referencia del ramo no es válida.")
      }
    }
  }
  for (const set of registry.contractualDivisors) Object.values(set.data).forEach(positiveDecimal)
  for (const set of registry.laborBenefitMinima) {
    for (const value of [set.data.annualBonusDays, set.data.firstAnnualVacationDays, set.data.vacationPremiumPercent]) positiveDecimal(value)
    if (set.data.vacationSeniorityReference !== "LFT-76-not-inferred") {
      throw new FiscalFoundationError("INVALID_METADATA", "El mínimo vacacional no puede inferir antigüedad no declarada.")
    }
  }
}

/** Returns verified data, not payroll figures, eligibility or deductions. */
export function selectFiscalParameters2026(effectiveDate: string, periodicity: PayrollPeriodicity, registry: FiscalRegistry = FISCAL_PARAMETERS_2026) {
  validateFiscalRegistry2026(registry)
  const coverage = registry.supportedDates
  const uma = selectByEffectiveDate(registry.uma, effectiveDate, coverage)
  const subsidy = selectByEffectiveDate(registry.subsidy, effectiveDate, coverage)
  if (uma.data.valueYear !== subsidy.data.umaMonthlyValueYear) {
    throw new FiscalFoundationError("INCOMPATIBLE_PARAMETERS", "Los conjuntos elegidos no usan el mismo año de UMA.")
  }
  return Object.freeze({
    packageVersion: registry.version,
    isrTariff: selectByEffectiveDate(registry.isrTariffs.filter(set => set.key === periodicity), effectiveDate, coverage),
    uma,
    minimumWages: selectByEffectiveDate(registry.minimumWages, effectiveDate, coverage),
    subsidy,
    imssConstants: selectByEffectiveDate(registry.imssConstants, effectiveDate, coverage),
    contractualDivisors: selectByEffectiveDate(registry.contractualDivisors, effectiveDate, coverage),
    laborBenefitMinima: selectByEffectiveDate(registry.laborBenefitMinima, effectiveDate, coverage),
  })
}

/** Data bridge only. Integration does not depend on ISR, UMA or IMSS datasets. */
export function standardIntegrationContext2026(registry: FiscalRegistry = FISCAL_PARAMETERS_2026): StandardIntegrationContext {
  return Object.freeze({
    fiscalPackageVersion: registry.version,
    supportedDates: registry.supportedDates,
    contractualDivisors: registry.contractualDivisors,
    laborBenefitMinima: registry.laborBenefitMinima,
  })
}

/** Data bridge for SBC only. Worker quota constants are not executed here. */
export function standardSbcContext2026(registry: FiscalRegistry = FISCAL_PARAMETERS_2026): StandardSbcContext {
  return Object.freeze({
    ...standardIntegrationContext2026(registry),
    uma: registry.uma,
    minimumWages: registry.minimumWages,
    imssConstants: registry.imssConstants,
  })
}

/** Data bridge for ISR by tariff only; no subsidy, IMSS or final withholding selection. */
export function standardIsrTariffContext2026(registry: FiscalRegistry = FISCAL_PARAMETERS_2026): StandardIsrTariffContext {
  return Object.freeze({
    fiscalPackageVersion: registry.version, exercise: registry.exercise,
    supportedDates: registry.supportedDates, isrTariffs: registry.isrTariffs,
  })
}

/** Subsidy estimate data only; does not infer monthly history, employers or final withholding. */
export function standardEmploymentSubsidyContext2026(registry: FiscalRegistry = FISCAL_PARAMETERS_2026): StandardEmploymentSubsidyContext {
  return Object.freeze({
    ...standardIsrTariffContext2026(registry), uma: registry.uma, subsidy: registry.subsidy,
    subsidyRulesSources: Object.freeze([FISCAL_SOURCES.subsidyRetainedRules]),
  })
}

/** Shared data context only; no fiscal calculation, repeated parameter selection or monthly facts. */
export function standardGrossToNetContext2026(registry: FiscalRegistry = FISCAL_PARAMETERS_2026): StandardGrossToNetContext {
  return Object.freeze({
    ...standardSbcContext2026(registry), ...standardEmploymentSubsidyContext2026(registry),
    retentionRuleSources: Object.freeze([FISCAL_SOURCES.isrMinimumWithholding]),
  })
}
