import Decimal from "decimal.js"
import { afterEach, describe, expect, it, vi } from "vitest"
import csv from "../../tests/fixtures/gross-to-net.expected.csv?raw"
import { standardGrossToNetContext2026 } from "../../infrastructure/fiscal/2026"
import type { MonetaryComponent, PayrollPeriodicity } from "./contracts"
import * as imssOperations from "./worker-imss"
import * as subsidyOperations from "./employment-subsidy"
import * as integrationOperations from "./salary-integration"
import * as sbcOperations from "./sbc"
import * as isrOperations from "./isr-tariff"
import { civilDate } from "./civil-date"
import { decimalText, moneyText } from "./money"
import { STANDARD_CONVENTIONS } from "./simulation-conventions"
import { calculateStandardEstimatedGrossToNet, STANDARD_GROSS_TO_NET_POLICY, STANDARD_ISR_WITHHOLDING_POLICY } from "./gross-to-net"
import type { MinimumWageMonthlyScenario, StandardEstimatedGrossToNetInput, StandardEstimatedGrossToNetResult, StandardGrossToNetContext } from "./gross-to-net-contracts"

const context = standardGrossToNetContext2026()
const Ref = Decimal.clone({ precision: 100, rounding: Decimal.ROUND_HALF_UP })
const nullable = (value: string) => value === "NULL" ? null : value
const samples = csv.split(/\r?\n/).filter(line => line && !line.startsWith("#")).slice(1).map(line => {
  const [date, periodicity, gross, includeImss, scenario, status, sbc, tariff, subsidy, potential, provisional, withheld, imssCalculated, imssDeducted, imssAbsorbed, imssExcluded, applied, displaced, excess, totalNotApplied, net] = line.split(",")
  return { date, periodicity: periodicity as PayrollPeriodicity, gross, includeImss: includeImss === "true", scenario, status, sbc, tariff, subsidy, potential, provisional, withheld: nullable(withheld), imssCalculated: nullable(imssCalculated), imssDeducted: nullable(imssDeducted), imssAbsorbed: nullable(imssAbsorbed), imssExcluded: nullable(imssExcluded), applied: nullable(applied), displaced: nullable(displaced), excess, totalNotApplied: nullable(totalNotApplied), net: nullable(net) }
})
function minimum(referenceMonth = "2026-02"): MinimumWageMonthlyScenario {
  return { kind: "only-general-minimum-assumed-for-reference-month", referenceMonth, noOtherSalaryPayments: true, acknowledgement: "explicit-standard-simulation-assumption-not-payroll-verification" }
}
function input(overrides: Partial<StandardEstimatedGrossToNetInput> = {}): StandardEstimatedGrossToNetInput {
  return { profileId: STANDARD_CONVENTIONS.id, grossPeriodSalary: "15000.00", periodicity: "monthly", referenceDate: "2026-02-01", benefits: { annualBonusDays: "15", annualVacationDays: "12", vacationPremiumPercent: "25" }, area: "general-zone", includeWorkerImss: true, minimumWageMonthlyScenario: { kind: "unconfirmed" }, ...overrides }
}
function successful(request: unknown = input(), ctx = context) {
  const result = calculateStandardEstimatedGrossToNet(request, ctx)
  expect(result.status).toBe("estimated")
  if (result.status !== "estimated") throw new Error(JSON.stringify(result.issues))
  return result
}
function blocked(result: StandardEstimatedGrossToNetResult, status = "not-determinable", code?: string) {
  expect(result.status).toBe(status)
  expect(result.complete).toBe(false)
  expect(result.net.amount).toBeNull()
  expect(result.reconciliationVerified).toBe(false)
  if (code) expect(result.issues.some(issue => issue.code === code)).toBe(true)
  return result
}
function amount(component: MonetaryComponent): string {
  if (component.amount === null) throw new Error(`Componente desconocido: ${component.reason}`)
  return component.amount
}
function reports(request = input(), ctx = context) {
  const { minimumWageMonthlyScenario: _scenario, ...imssInput } = request
  const imss = imssOperations.calculateStandardEstimatedWorkerImss(imssInput, ctx)
  const subsidy = subsidyOperations.calculateStandardEstimatedEmploymentSubsidy({ profileId: request.profileId, grossPeriodSalary: request.grossPeriodSalary, periodicity: request.periodicity, referenceDate: request.referenceDate }, ctx)
  if (imss.status !== "estimated" || subsidy.status !== "estimated") throw new Error("Reportes de prueba no determinados")
  return { imss, subsidy }
}
afterEach(() => vi.restoreAllMocks())

describe("bruto a neto: 86 referencias independientes", () => {
  it.each(samples)("$date / $periodicity / $gross / IMSS $includeImss / $scenario", sample => {
    const result = calculateStandardEstimatedGrossToNet(input({ grossPeriodSalary: sample.gross, periodicity: sample.periodicity, referenceDate: sample.date, includeWorkerImss: sample.includeImss, minimumWageMonthlyScenario: sample.scenario === "minimum" ? minimum(sample.date.slice(0, 7)) : { kind: "unconfirmed" } }), context)
    expect(result.status).toBe(sample.status)
    expect(result.gross).toMatchObject({ status: "valid", amount: sample.gross })
    expect(result.sbc?.status).toBe("estimated")
    if (result.sbc?.status !== "estimated") throw new Error("SBC diagnóstico ausente")
    expect(result.sbc.data.sbc.estimatedSbc).toBe(sample.sbc)
    expect(result.integration.data?.applicableSbc).toBeNull()
    expect(result.integration.data?.factor.value).toMatch(/^1\.049315068/)
    expect(result.isr.accordingToTariff.amount).toBe(sample.tariff)
    expect(result.isr.afterSubsidyProvisional.amount).toBe(sample.provisional)
    expect(result.subsidy.determined.amount).toBe(sample.subsidy)
    expect(result.subsidy.potentiallyApplicable.amount).toBe(sample.potential)
    expect(result.isr.withheld.amount).toBe(sample.withheld)
    expect(result.imss.calculated.amount).toBe(sample.imssCalculated)
    expect(result.imss.deducted.amount).toBe(sample.imssDeducted)
    expect(result.imss.absorbedByEmployer.amount).toBe(sample.imssAbsorbed)
    expect(result.imss.excludedBySimulation.amount).toBe(sample.imssExcluded)
    expect(result.subsidy.applied.amount).toBe(sample.applied)
    expect(result.subsidy.notAppliedDueToNoWithholding.amount).toBe(sample.displaced)
    expect(result.subsidy.excessOverTariffIsrNotDelivered.amount).toBe(sample.excess)
    expect(result.subsidy.totalNotApplied.amount).toBe(sample.totalNotApplied)
    expect(result.net.amount).toBe(sample.net)
    if (result.status === "estimated") {
      expect(result.complete).toBe(true)
      expect(result.reconciliationVerified).toBe(true)
      expect(new Ref(result.net.amount).plus(amount(result.isr.withheld)).plus(amount(result.imss.deducted)).toFixed(2)).toBe(sample.gross)
      expect(new Ref(amount(result.imss.deducted)).plus(amount(result.imss.absorbedByEmployer)).plus(amount(result.imss.excludedBySimulation)).toFixed(2)).toBe(sample.imssCalculated)
      expect(new Ref(amount(result.subsidy.applied)).plus(amount(result.subsidy.notAppliedDueToNoWithholding)).plus(amount(result.subsidy.excessOverTariffIsrNotDelivered)).toFixed(2)).toBe(sample.subsidy)
      expect(result.subsidy.cashDelivered.amount).toBe("0.00")
      expect(result.retention.kind).toBe(sample.scenario === "minimum" ? "conditional-no-withholding-LISR-96" : "ordinary-above-minimum")
    } else blocked(result, sample.status)
  })
  it("incluye exactamente el fixture esperado y los cuatro casos obligatorios", () => {
    expect(samples).toHaveLength(86)
    for (const [periodicity, grossPeriodSalary, includeWorkerImss, withheld, deducted, net] of [
      ["monthly", "15000.00", true, "1402.82", "394.54", "13202.64"],
      ["monthly", "15000.00", false, "1402.82", "0.00", "13597.18"],
      ["weekly", "3500.00", true, "331.27", "92.06", "3076.67"],
      ["fortnightly", "7500.00", true, "709.86", "197.27", "6592.87"],
    ] as const) {
      const result = successful(input({ periodicity, grossPeriodSalary, includeWorkerImss }))
      expect(result.isr.withheld.amount).toBe(withheld)
      expect(result.imss.deducted.amount).toBe(deducted)
      expect(result.net.amount).toBe(net)
    }
  })
})

describe("composición única, retención y semántica del subsidio", () => {
  it("llama una vez a cada operación principal y una vez a sus operaciones anidadas", () => {
    const spies = [
      vi.spyOn(imssOperations, "calculateStandardEstimatedWorkerImss"),
      vi.spyOn(subsidyOperations, "calculateStandardEstimatedEmploymentSubsidy"),
      vi.spyOn(integrationOperations, "calculateStandardSalaryIntegration"),
      vi.spyOn(sbcOperations, "calculateStandardEstimatedSbc"),
      vi.spyOn(isrOperations, "calculateStandardEstimatedIsrByTariff"),
    ]
    expect(successful().net.amount).toBe("13202.64")
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1)
  })
  it("mantiene intactos los reportes originales y completa solo la nueva capa", () => {
    const request = input({ grossPeriodSalary: "9451.20", minimumWageMonthlyScenario: minimum() })
    const previous = reports(request)
    const result = successful(request)
    expect(result.modules.workerImss).toEqual(previous.imss)
    expect(result.modules.employmentSubsidy).toEqual(previous.subsidy)
    expect(result.isr.afterSubsidyProvisional.amount).toBe("133.66")
    expect(result.isr.withheld.amount).toBe("0.00")
    expect(result.modules.employmentSubsidy?.data?.finalWithholding.amount).toBeNull()
    expect(result.subsidy.potentiallyApplicable.amount).toBe("535.65")
    expect(result.subsidy.applied.amount).toBe("0.00")
    expect(result.subsidy.notAppliedDueToNoWithholding.amount).toBe("535.65")
    expect(result.subsidy.excessOverTariffIsrNotDelivered.amount).toBe("0.00")
    expect(result.isr.beforeSubsidyAfterExceptions.amount).toBe("0.00")
    expect(result.retention.factualMonthlyVerification).toBe("not-performed")
  })
  it("la partición distingue exceso previo y aplicación desplazada sin doble conteo", () => {
    // Synthetic quota 1000: verifies exclusive categories, not an official subsidy.
    const ctx = { ...context, uma: context.uma.map(set => ({ ...set, data: { ...set.data, monthly: "1000.00" } })), subsidy: context.subsidy.map(set => ({ ...set, data: { ...set.data, rateProportion: "1" } })) }
    const conditional = successful(input({ grossPeriodSalary: "9451.20", minimumWageMonthlyScenario: minimum() }), ctx)
    expect(conditional.subsidy.determined.amount).toBe("1000.00")
    expect(conditional.subsidy.potentiallyApplicable.amount).toBe("669.31")
    expect(conditional.subsidy.applied.amount).toBe("0.00")
    expect(conditional.subsidy.notAppliedDueToNoWithholding.amount).toBe("669.31")
    expect(conditional.subsidy.excessOverTariffIsrNotDelivered.amount).toBe("330.69")
    expect(conditional.subsidy.totalNotApplied.amount).toBe("1000.00")
    const ordinary = successful(input({ grossPeriodSalary: "9451.21" }), ctx)
    expect(ordinary.isr.withheld.amount).toBe("0.00")
    expect(ordinary.subsidy.applied.amount).toBe("669.31")
    expect(ordinary.subsidy.notAppliedDueToNoWithholding.amount).toBe("0.00")
    expect(ordinary.subsidy.excessOverTariffIsrNotDelivered.amount).toBe("330.69")
    expect(ordinary.net.amount).toBe("9215.68")
  })
  it("sin confirmación no convierte ISR provisional en retención del mínimo", () => {
    const result = blocked(calculateStandardEstimatedGrossToNet(input({ grossPeriodSalary: "9451.20" }), context), "not-determinable", "MONTHLY_MINIMUM_CONFIRMATION_REQUIRED")
    expect(result.retention.kind).toBe("unconfirmed-minimum-month")
    expect(result.isr.afterSubsidyProvisional.amount).toBe("133.66")
    expect(result.isr.withheld.amount).toBeNull()
    expect(result.subsidy.applied.amount).toBeNull()
    expect(result.subsidy.notAppliedDueToNoWithholding.amount).toBeNull()
    expect(result.imss.deducted.amount).toBe("0.00")
    expect(result.imss.absorbedByEmployer.amount).toBe("235.53")
  })
  it("conserva diagnóstico parcial de subsidio sin producir neto bajo mínimo", () => {
    const result = blocked(calculateStandardEstimatedGrossToNet(input({ grossPeriodSalary: "4000.00", includeWorkerImss: false }), context), "not-supported")
    expect(result.subsidy.determined.amount).toBe("535.65")
    expect(result.subsidy.potentiallyApplicable.amount).toBe("218.17")
    expect(result.subsidy.excessOverTariffIsrNotDelivered.amount).toBe("317.48")
    expect(result.isr.withheld.amount).toBeNull()
    expect(result.imss.deducted.amount).toBeNull()
  })
})

describe("declaraciones, validación y bloqueos", () => {
  it.each([undefined, null, [], "15000.00"])("rechaza captura inválida %j", request => { blocked(calculateStandardEstimatedGrossToNet(request, context)) })
  it.each([undefined, null, false, "unconfirmed", {}])("declaración explícita obligatoria %j", minimumWageMonthlyScenario => {
    const result = blocked(calculateStandardEstimatedGrossToNet({ ...input(), minimumWageMonthlyScenario }, context))
    expect(result.issues.some(issue => issue.field === "minimumWageMonthlyScenario")).toBe(true)
  })
  it.each(["2026-00", "2026-13", "2026-2", "2026-02-01", "", undefined])("rechaza mes civil %j", referenceMonth => {
    blocked(calculateStandardEstimatedGrossToNet({ ...input({ grossPeriodSalary: "9451.20" }), minimumWageMonthlyScenario: { ...minimum(), referenceMonth } }, context), "not-determinable", "INVALID_REFERENCE_MONTH")
  })
  it("rechaza declaración de otro mes y evita inferir equivalencia por 28/30/31 días", () => {
    blocked(calculateStandardEstimatedGrossToNet(input({ grossPeriodSalary: "9451.20", minimumWageMonthlyScenario: minimum("2026-01") }), context), "not-determinable", "MONTHLY_MINIMUM_MONTH_MISMATCH")
    for (const referenceDate of ["2026-01-31", "2026-02-28", "2026-04-30"]) {
      blocked(calculateStandardEstimatedGrossToNet(input({ grossPeriodSalary: "9451.20", referenceDate }), context))
    }
  })
  it.each(["9451.19", "9451.21", "15000.00"])("la afirmación de mínimo no fuerza salario %s", grossPeriodSalary => {
    blocked(calculateStandardEstimatedGrossToNet(input({ grossPeriodSalary, minimumWageMonthlyScenario: minimum() }), context), "not-supported", "MONTHLY_MINIMUM_SALARY_MISMATCH")
  })
  it("rechaza afirmación incompleta, percepciones adicionales y otras modalidades", () => {
    for (const patch of [{ noOtherSalaryPayments: undefined }, { acknowledgement: undefined }, { acknowledgement: "yes" }]) {
      blocked(calculateStandardEstimatedGrossToNet({ ...input({ grossPeriodSalary: "9451.20" }), minimumWageMonthlyScenario: { ...minimum(), ...patch } }, context), "not-determinable", "INCOMPLETE_MONTHLY_MINIMUM_ASSUMPTION")
    }
    blocked(calculateStandardEstimatedGrossToNet({ ...input(), minimumWageMonthlyScenario: { ...minimum(), noOtherSalaryPayments: false } }, context), "not-supported")
    for (const declaration of [{ kind: "monthly-payments-outside-standard-profile" }, { kind: "unknown" }, { kind: "unconfirmed", income: "10000" }, { ...minimum(), actualPaidDays: "28" }]) {
      blocked(calculateStandardEstimatedGrossToNet({ ...input(), minimumWageMonthlyScenario: declaration }, context), "not-supported")
    }
  })
  it.each(["", "-1", "0.001", "1e4", 15000])("delega validación de bruto %j", grossPeriodSalary => {
    blocked(calculateStandardEstimatedGrossToNet({ ...input(), grossPeriodSalary }, context))
  })
  it("no admite neto objetivo, calendario ni zona fuera del perfil", () => {
    for (const extra of [{ operation: "net-to-gross" }, { net: "10000" }, { actualMonthlyIncome: "0" }, { interval: {} }]) {
      blocked(calculateStandardEstimatedGrossToNet({ ...input(), ...extra }, context), "not-supported")
    }
    blocked(calculateStandardEstimatedGrossToNet(input({ profileId: "calendar-context" }), context), "not-supported")
    blocked(calculateStandardEstimatedGrossToNet(input({ area: "northern-border-zone", minimumWageMonthlyScenario: minimum() }), context), "not-supported")
  })
  it.each([true, false])("prestaciones ausentes bloquean aun con IMSS %s", includeWorkerImss => {
    for (const benefits of [undefined, {}, { annualBonusDays: "15", annualVacationDays: "12" }, { annualBonusDays: "-1", annualVacationDays: "12", vacationPremiumPercent: "25" }]) {
      const result = blocked(calculateStandardEstimatedGrossToNet({ ...input({ includeWorkerImss }), benefits }, context))
      expect(result.isr.accordingToTariff.amount).toBe("1402.82")
      expect(result.modules.employmentSubsidy?.status).toBe("estimated")
      expect(result.imss.deducted.amount).toBeNull()
    }
  })
  it.each(["2025-12-31", "2027-01-01"])("rechaza fecha sin cobertura %s", referenceDate => { blocked(calculateStandardEstimatedGrossToNet(input({ referenceDate }), context), "not-supported") })
  it.each(["uma", "minimumWages", "imssConstants", "contractualDivisors", "laborBenefitMinima", "isrTariffs", "subsidy", "subsidyRulesSources", "retentionRuleSources"] as const)("parámetro ausente %s no se reemplaza por cero", key => {
    const result = blocked(calculateStandardEstimatedGrossToNet(input({ includeWorkerImss: false }), { ...context, [key]: [] }))
    expect(result.isr.withheld.amount).toBeNull()
    if (["isrTariffs", "subsidy"].includes(key)) expect(result.sbc?.status).toBe("estimated")
  })
  it.each(["uma", "minimumWages", "imssConstants", "isrTariffs", "subsidy"] as const)("rechaza conjuntos no verificados %s", key => {
    for (const validation of ["pending-review", "rejected"] as const) {
      blocked(calculateStandardEstimatedGrossToNet(input(), { ...context, [key]: context[key].map(set => ({ ...set, validation })) }))
    }
  })
  it("rechaza fuente de retención incompleta y conserva diagnósticos", () => {
    for (const retentionRuleSources of [undefined, [null], [{ ...context.retentionRuleSources[0], document: undefined }], [{ ...context.retentionRuleSources[0], url: "https://example.com" }]]) {
      const result = blocked(calculateStandardEstimatedGrossToNet(input(), { ...context, retentionRuleSources } as unknown as StandardGrossToNetContext))
      expect(result.modules.workerImss?.status).toBe("estimated")
      expect(result.modules.employmentSubsidy?.status).toBe("estimated")
    }
    blocked(calculateStandardEstimatedGrossToNet(input(), undefined as unknown as StandardGrossToNetContext))
  })
})

describe("coherencia entre reportes y conciliación", () => {
  it.each(["package", "date", "period", "zone", "switch", "sbc", "minimum", "uma", "versions", "missing-id", "precision", "convention"])("rechaza reporte IMSS incoherente: %s", variant => {
    const { imss } = reports()
    const d = imss.data
    const patches = {
      package: { fiscalPackageVersion: "other-package" }, date: { referenceDate: civilDate("2026-03-01") }, period: { periodicity: "weekly" as const },
      zone: { area: "northern-border-zone" as "general-zone" }, switch: { includeWorkerImss: false }, sbc: { estimatedSbc: moneyText("500") },
      minimum: { contractualMinimumCheck: { ...d.contractualMinimumCheck, comparedValue: decimalText("501") } }, uma: { umaDaily: moneyText("117.30") },
      versions: { parameterSetVersions: d.parameterSetVersions.map(entry => entry.id === "mx-uma-2026" ? { ...entry, version: "other-version" } : entry) },
      "missing-id": { parameterSetIds: d.parameterSetIds.filter(id => id !== "mx-uma-2026") }, precision: { precisionPolicy: "decimal-3" }, convention: { conventionVersion: "other-convention" },
    }
    vi.spyOn(imssOperations, "calculateStandardEstimatedWorkerImss").mockReturnValue({ ...imss, data: { ...d, ...patches[variant as keyof typeof patches] } })
    blocked(calculateStandardEstimatedGrossToNet(input(), context), "not-determinable", "INCOMPATIBLE_PARAMETERS")
  })
  it.each(["gross", "profile", "isr", "parameter-version", "uma"])("rechaza reporte de subsidio incoherente: %s", variant => {
    const { subsidy } = reports()
    const d = subsidy.data
    const original = d.isrResult
    const patches = {
      gross: { isrResult: { ...original, data: { ...original.data, taxableIncome: moneyText("15000.01") } } },
      profile: { isrResult: { ...original, data: { ...original.data, profileId: "other-profile" } } },
      isr: { isrResult: { ...original, isrByTariff: moneyText("1402.83") } },
      "parameter-version": { parameters: { ...d.parameters, uma: { ...d.parameters.uma, version: "other-version" } } },
      uma: { parameters: { ...d.parameters, uma: { ...d.parameters.uma, data: { ...d.parameters.uma.data, daily: "117.30" } } } },
    }
    vi.spyOn(subsidyOperations, "calculateStandardEstimatedEmploymentSubsidy").mockReturnValue({ ...subsidy, data: { ...d, ...patches[variant as keyof typeof patches] } })
    blocked(calculateStandardEstimatedGrossToNet(input(), context), "not-determinable", "INCOMPATIBLE_PARAMETERS")
  })
  it("no ajusta un neto negativo ni compensa errores alterando importes", () => {
    const ctx = { ...context, isrTariffs: context.isrTariffs.map(set => set.key === "monthly" ? { ...set, data: { ...set.data, rows: set.data.rows.map((row, i) => i === 4 ? { ...row, fixedFee: "20000.00" } : row) } } : set) }
    const result = blocked(calculateStandardEstimatedGrossToNet(input(), ctx), "not-determinable", "INCOMPATIBLE_PARAMETERS")
    expect(result.issues.some(issue => issue.stages.includes("net"))).toBe(true)
    expect(result.net.amount).toBeNull()
  })
})

describe("trazabilidad, advertencias e inmutabilidad", () => {
  it("consolida siete conjuntos, políticas y fundamento sin certificar hechos mensuales", () => {
    const result = successful()
    expect(result.provenance.fiscalPackageVersion).toBe("mx-fiscal-2026-source-v3")
    expect(result.provenance.parameterSetIds).toHaveLength(7)
    expect(new Set(result.provenance.parameterSetIds).size).toBe(7)
    expect(result.provenance.policyVersions).toContainEqual({ component: "gross-to-net", version: STANDARD_GROSS_TO_NET_POLICY.id })
    expect(result.provenance.policyVersions).toContainEqual({ component: "withholding", version: STANDARD_ISR_WITHHOLDING_POLICY.id })
    expect(result.retention.sources.some(source => source.url.endsWith("LISR.pdf") && source.locator.includes("96"))).toBe(true)
    expect(result.provenance.actualMonthlyContextVerified).toBe(false)
    expect(result.provenance.actualWithholdingConfirmed).toBe(false)
    expect(result.provenance.fiscalCertification).toBe("not-certified")
    expect(result.status).not.toBe("valid")
  })
  it("conserva advertencias originales pero retira mensajes superados de la capa resuelta", () => {
    const result = successful(input({ grossPeriodSalary: "9451.20", minimumWageMonthlyScenario: minimum() }))
    expect(result.modules.employmentSubsidy?.warnings.some(warning => warning.code === "MINIMUM_WAGE_WITHHOLDING_EXCEPTION_NOT_EVALUATED")).toBe(true)
    expect(result.warnings.some(warning => warning.code === "MINIMUM_WAGE_WITHHOLDING_EXCEPTION_NOT_EVALUATED")).toBe(false)
    expect(result.warnings.some(warning => warning.code === "PROVISIONAL_ISR_AFTER_SUBSIDY")).toBe(false)
    expect(result.warnings.some(warning => warning.code === "MONTHLY_MINIMUM_CONDITION_ASSUMED")).toBe(true)
    expect(result.warnings.some(warning => warning.code === "MONTHLY_SUBSIDY_RECONCILIATION_NOT_SIMULATED")).toBe(true)
    expect(new Set(result.warnings.map(warning => `${warning.code}|${warning.field ?? ""}`)).size).toBe(result.warnings.length)
    const failed = blocked(calculateStandardEstimatedGrossToNet(input({ grossPeriodSalary: "9451.20" }), context))
    expect(failed.warnings.some(warning => warning.code === "MINIMUM_WAGE_WITHHOLDING_EXCEPTION_NOT_EVALUATED")).toBe(true)
  })
  it("entradas y parámetros inmutables; cálculo independiente de Decimal global", () => {
    const request = Object.freeze(input({ grossPeriodSalary: "00015000.00", benefits: Object.freeze(input().benefits), minimumWageMonthlyScenario: Object.freeze({ kind: "unconfirmed" as const }) }))
    const ctx = structuredClone(context)
    const before = JSON.stringify({ request, ctx })
    const precision = Decimal.precision
    const rounding = Decimal.rounding
    try {
      Decimal.set({ precision: 3, rounding: Decimal.ROUND_DOWN })
      const result = successful(request, ctx)
      expect(result.gross.amount).toBe("15000.00")
      expect(result.net.amount).toBe("13202.64")
      expect(Decimal.precision).toBe(3)
      expect(Decimal.rounding).toBe(Decimal.ROUND_DOWN)
      for (const value of [result, result.gross, result.net, result.isr, result.subsidy, result.imss, result.retention, result.retention.scenario, result.retention.sources[0], result.provenance, result.provenance.policyVersions[0], result.modules]) expect(Object.isFrozen(value)).toBe(true)
      expect(Object.isFrozen(ctx.uma[0])).toBe(false)
    } finally { Decimal.set({ precision, rounding }) }
    expect(JSON.stringify({ request, ctx })).toBe(before)
  })
})
