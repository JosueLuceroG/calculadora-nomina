import Decimal from "decimal.js"
import { describe, expect, it } from "vitest"
import csv from "../../tests/fixtures/employment-subsidy.expected.csv?raw"
import { FISCAL_PARAMETERS_2026, standardEmploymentSubsidyContext2026 } from "../../infrastructure/fiscal/2026"
import type { EmploymentSubsidyParameters, PayrollPeriodicity, UmaValues } from "./contracts"
import { calculateStandardEstimatedIsrByTariff } from "./isr-tariff"
import { DECIMAL_POLICY } from "./money"
import { STANDARD_CONVENTIONS } from "./simulation-conventions"
import { calculateStandardEstimatedEmploymentSubsidy, STANDARD_EMPLOYMENT_SUBSIDY_POLICY } from "./employment-subsidy"
import type { StandardEmploymentSubsidyContext, StandardEmploymentSubsidyInput, StandardEstimatedEmploymentSubsidyResult } from "./employment-subsidy-contracts"

const context = standardEmploymentSubsidyContext2026()
const Ref = Decimal.clone({ precision: 100, rounding: Decimal.ROUND_HALF_UP })
const samples = csv.split(/\r?\n/).filter(line => line && !line.startsWith("#")).slice(1).map(line => {
  const [periodicity, date, base, monthlyReference, eligible, monthlyQuota, periodQuota, subsidy, isr, applicable, provisional, excess] = line.split(",")
  return { periodicity: periodicity as PayrollPeriodicity, date, base, monthlyReference, eligible: eligible === "true", monthlyQuota, periodQuota, subsidy, isr, applicable, provisional, excess }
})
function rational(value: string) { const [n, d = "1"] = value.split("/"); return new Ref(n).div(d) }
function near(actual: string, expected: string) {
  const reference = rational(expected)
  expect(new Ref(actual).minus(reference).abs().lte(Ref.max(reference.abs(), 1).times("1e-47"))).toBe(true)
}
function input(overrides: Partial<StandardEmploymentSubsidyInput> = {}): StandardEmploymentSubsidyInput {
  return { profileId: STANDARD_CONVENTIONS.id, grossPeriodSalary: "9451.20", periodicity: "monthly", referenceDate: "2026-02-01", ...overrides }
}
function successful(request: unknown = input(), ctx = context) {
  const result = calculateStandardEstimatedEmploymentSubsidy(request, ctx)
  expect(result.status).toBe("estimated")
  if (result.status !== "estimated") throw new Error(JSON.stringify(result.issues))
  return result
}
function failed(result: StandardEstimatedEmploymentSubsidyResult, field = "parameters", status = "not-determinable") {
  expect(result.status).toBe(status)
  expect(result.data).toBeNull()
  expect(Object.values(result.amounts)).toEqual([null, null, null, null, null, null])
  expect(result.issues.some(issue => issue.field === field)).toBe(true)
  return result
}
function subsidyContext(patch: Partial<EmploymentSubsidyParameters>) {
  return { ...context, subsidy: context.subsidy.map(set => ({ ...set, data: { ...set.data, ...patch } })) }
}
function umaContext(patch: Partial<UmaValues>) {
  return { ...context, uma: context.uma.map(set => ({ ...set, data: { ...set.data, ...patch } })) }
}

describe("subsidio estándar: 68 oráculos racionales independientes", () => {
  it.each(samples)("$date / $periodicity / $base: subsidio $subsidy e ISR provisional $provisional", sample => {
    const request = input({ referenceDate: sample.date, periodicity: sample.periodicity, grossPeriodSalary: sample.base })
    const result = successful(request)
    near(result.data.monthlyReferenceIncome.value, sample.monthlyReference)
    expect(result.data.monthlySubsidyTheoretical).toEqual({ value: sample.monthlyQuota, exact: true, precision: 50 })
    near(result.data.periodSubsidyUncapped.value, sample.periodQuota)
    near(result.data.periodSubsidyTheoretical.value, sample.periodQuota)
    expect(result.data.monthlyMaximumApplied).toBe(false)
    expect(result.data.periodSubsidyTheoretical.exact).toBe(sample.periodicity === "monthly")
    near(result.data.periodSubsidyBeforeRounding.value, sample.eligible ? sample.periodQuota : "0")
    expect(result.data.eligibility.eligibleEstimate).toBe(sample.eligible)
    const reference = rational(sample.monthlyReference)
    expect(result.data.eligibility.relation).toBe(reference.lt("11492.66") ? "below-limit" : reference.eq("11492.66") ? "at-limit" : "above-limit")
    expect(result.data.eligibility.reason).toBe(sample.eligible ? "within-monthly-reference-limit" : "above-monthly-reference-limit")
    expect(result.amounts).toEqual({ isrByTariff: sample.isr, subsidyDetermined: sample.subsidy, subsidyPotentiallyApplicable: sample.applicable, isrAfterSubsidyProvisional: sample.provisional, excessNotDelivered: sample.excess, cashDelivered: "0.00" })
    expect(result.data.referenceDays).toBe({ weekly: "7", fortnightly: "15", monthly: "30" }[sample.periodicity])
    expect(new Ref(result.amounts.isrAfterSubsidyProvisional).plus(result.amounts.subsidyPotentiallyApplicable).toFixed(2)).toBe(sample.isr)
    expect(new Ref(result.amounts.excessNotDelivered).plus(result.amounts.subsidyPotentiallyApplicable).toFixed(2)).toBe(sample.subsidy)
    expect(new Ref(result.amounts.subsidyPotentiallyApplicable).lte(sample.isr)).toBe(true)
    expect(result.data.excessCarryForwardAllowed).toBe(false)
    expect(result.data.finalWithholding).toEqual({ status: "not-calculated", amount: null })
    expect(result.data.minimumWageWithholdingException.status).toBe("not-evaluated")
    expect(result.data.reconciliationVerified).toBe(true)
    expect(result.data.isrResult).toEqual(calculateStandardEstimatedIsrByTariff(request, context))
  })

  it("el oráculo incluye ISR menor, igual y mayor al subsidio en ambos meses y tres periodos", () => {
    expect(samples).toHaveLength(68)
    for (const date of ["2026-01-31", "2026-02-01"]) {
      for (const period of ["weekly", "fortnightly", "monthly"]) {
        const group = samples.filter(sample => sample.date === date && sample.periodicity === period && sample.eligible)
        expect(group.some(sample => new Ref(sample.isr).lt(sample.subsidy))).toBe(true)
        expect(group.some(sample => new Ref(sample.isr).eq(sample.subsidy))).toBe(true)
        expect(group.some(sample => new Ref(sample.isr).gt(sample.subsidy))).toBe(true)
      }
    }
  })
  it.each(["2026-01-01", "2026-01-31", "2026-02-01", "2026-12-31"])("cuota por producto exacto, UMA mensual oficial y porcentaje en %s", referenceDate => {
    const result = successful(input({ referenceDate }))
    const january = referenceDate < "2026-02-01"
    expect(result.data.umaMonthly).toBe(january ? "3439.46" : "3566.22")
    expect(result.data.umaValueYear).toBe(january ? 2025 : 2026)
    expect(result.data.subsidyRateProportion).toBe(january ? "0.1559" : "0.1502")
    expect(result.data.monthlySubsidyTheoretical.value).toBe(january ? "536.211814" : "535.646244")
    expect(result.amounts.subsidyDetermined).toBe(january ? "536.21" : "535.65")
    expect(result.amounts.subsidyDetermined).not.toBe("536.22")
  })
  it.each(["11492.65", "11492.66", "11492.67"])("frontera mensual %s sin redondeo de elegibilidad", grossPeriodSalary => {
    const result = successful(input({ grossPeriodSalary }))
    expect(result.data.eligibility.eligibleEstimate).toBe(grossPeriodSalary !== "11492.67")
    expect(result.amounts.subsidyDetermined).toBe(grossPeriodSalary === "11492.67" ? "0.00" : "535.65")
  })
  it("la referencia semanal mostrada en el límite sigue debajo internamente", () => {
    const result = successful(input({ periodicity: "weekly", grossPeriodSalary: "2681.62" }))
    expect(new Ref(result.data.monthlyReferenceIncome.value).toFixed(2)).toBe("11492.66")
    expect(result.data.monthlyReferenceIncome.exact).toBe(false)
    expect(result.data.eligibility.relation).toBe("below-limit")
    expect(result.data.eligibility.incomeNumerator.value).toBe("80448.6")
    expect(result.data.eligibility.limitNumerator.value).toBe("80448.62")
    expect(result.data.eligibility.comparisonBasis).toBe("exact-cross-products-without-monthly-income-rounding")
  })
  it("mensual usa cuota completa, no ×30/30.4 ni UMA diaria ×30.4", () => {
    const result = successful()
    expect(result.data.periodSubsidyTheoretical.value).toBe("535.646244")
    expect(result.amounts.subsidyDetermined).toBe("535.65")
    expect(new Ref("117.31").times("30.4").times("0.1502").eq(result.data.monthlySubsidyTheoretical.value)).toBe(false)
  })
  it("prorratea cuota mensual interna sin redondear mensual o diario", () => {
    // Synthetic data distinguish premature rounding, not official replacement parameters.
    const ctx = { ...subsidyContext({ rateProportion: "0.53222" }), uma: umaContext({ monthly: "100.00" }).uma }
    const result = successful(input({ periodicity: "weekly", grossPeriodSalary: "1000.00" }), ctx)
    expect(result.data.monthlySubsidyTheoretical.value).toBe("53.222")
    expect(result.amounts.subsidyDetermined).toBe("12.26")
    expect(new Ref("53.22").times(7).div("30.4").toFixed(2)).toBe("12.25")
    expect(new Ref("53.222").div("30.4").toFixed(2)).toBe("1.75")
  })
  it("medio centavo y límite mensual por pago conservan conciliación", () => {
    const ctx = { ...subsidyContext({ rateProportion: "0.12345" }), uma: umaContext({ monthly: "100.00" }).uma }
    const tie = successful(input({ grossPeriodSalary: "1000.00" }), ctx)
    expect(tie.data.periodSubsidyBeforeRounding.value).toBe("12.345")
    expect(tie.amounts.subsidyDetermined).toBe("12.35")
    const capped = successful(input({ periodicity: "weekly", grossPeriodSalary: "1000.00" }), { ...ctx, subsidy: ctx.subsidy.map(set => ({ ...set, data: { ...set.data, submonthlyDivisor: "1" } })) })
    expect(capped.data.monthlyMaximumApplied).toBe(true)
    expect(capped.data.periodSubsidyUncapped.value).toBe("86.415")
    expect(capped.data.periodSubsidyTheoretical.value).toBe("12.345")
    expect(capped.amounts.subsidyDetermined).toBe("12.35")
  })
})

describe("validaciones y estados del subsidio", () => {
  it.each([undefined, null, [], "9451.20"])("rechaza captura %j", request => { failed(calculateStandardEstimatedEmploymentSubsidy(request, context), "request") })
  it.each(["", "-0.01", "1e4", "9,000", "0.001", 9451.2])("hereda rechazo de importe %j", grossPeriodSalary => {
    failed(calculateStandardEstimatedEmploymentSubsidy({ ...input(), grossPeriodSalary }, context), "grossPeriodSalary")
  })
  it.each(["2025-12-31", "2027-01-01"])("no aproxima ejercicio de fecha %s", referenceDate => { failed(calculateStandardEstimatedEmploymentSubsidy(input({ referenceDate }), context), "referenceDate", "not-supported") })
  it("rechaza fecha inválida, calendario e historial adicional sin inferir contexto", () => {
    failed(calculateStandardEstimatedEmploymentSubsidy(input({ referenceDate: "2026-02-29" }), context), "referenceDate")
    failed(calculateStandardEstimatedEmploymentSubsidy(input({ profileId: "calendar-context" }), context), "profileId", "not-supported")
    for (const extra of [{ monthlyIncome: "10000" }, { priorSubsidy: "0" }, { includeWorkerImss: false }, { net: "10000" }, { employerCount: 1 }, { paymentDate: "2026-02-15" }]) {
      failed(calculateStandardEstimatedEmploymentSubsidy({ ...input(), ...extra }, context), "request", "not-supported")
    }
  })
  it.each(["daily", "annual", "constructor"])("rechaza periodo %s", periodicity => { failed(calculateStandardEstimatedEmploymentSubsidy({ ...input(), periodicity }, context), "periodicity", "not-supported") })
  it.each(["uma", "subsidy", "isrTariffs"] as const)("serie ausente %s es desconocida, no cero", key => {
    for (const grossPeriodSalary of ["9451.20", "15000.00", "0.00"]) {
      const result = failed(calculateStandardEstimatedEmploymentSubsidy(input({ grossPeriodSalary }), { ...context, [key]: [] }))
      expect(result.diagnosticIsr !== null).toBe(key !== "isrTariffs")
    }
  })
  it.each(["uma", "subsidy", "isrTariffs"] as const)("rechaza parámetros no verificados %s", key => {
    for (const validation of ["pending-review", "rejected"] as const) {
      const ctx = { ...context, [key]: context[key].map(set => ({ ...set, validation })) }
      failed(calculateStandardEstimatedEmploymentSubsidy(input(), ctx))
    }
  })
  it("rechaza cuerpos, metadatos y fuentes incompletos", () => {
    failed(calculateStandardEstimatedEmploymentSubsidy(input(), undefined as unknown as StandardEmploymentSubsidyContext))
    for (const key of ["uma", "subsidy"] as const) {
      for (const patch of [{ data: null }, { id: undefined }, { version: undefined }, { key: undefined }, { sources: undefined }, { sources: [] }, { sources: [null] }]) {
        const ctx = { ...context, [key]: context[key].map(set => ({ ...set, ...patch })) } as unknown as StandardEmploymentSubsidyContext
        failed(calculateStandardEstimatedEmploymentSubsidy(input(), ctx))
      }
    }
    for (const subsidyRulesSources of [undefined, [], [null], [{ ...context.subsidyRulesSources[0], url: "https://example.com" }]]) {
      failed(calculateStandardEstimatedEmploymentSubsidy(input(), { ...context, subsidyRulesSources } as unknown as StandardEmploymentSubsidyContext))
    }
  })
  it("rechaza incompatibilidad de UMA, definición, porcentaje, divisor y límite", () => {
    for (const patch of [{ unit: "USD" }, { valueYear: 2027 }, { valueYear: 2025 }, { monthly: "0" }, { monthly: "3566.221" }, { monthly: undefined }]) {
      failed(calculateStandardEstimatedEmploymentSubsidy(input(), umaContext(patch as Partial<UmaValues>)))
    }
    const patches = [
      { monthlyQuotaDefinition: "fixed-amount" }, { formulaText: "" }, { umaMonthlyValueYear: 2025 },
      { rateProportion: undefined }, { rateProportion: "0" }, { rateProportion: "-0.1" }, { rateProportion: "1.01" },
      { submonthlyDivisor: undefined }, { submonthlyDivisor: "0" }, { submonthlyDivisor: "-30.4" },
      { monthlyIncomeLimit: undefined }, { monthlyIncomeLimit: "0" }, { monthlyIncomeLimit: "11492.661" },
    ]
    for (const patch of patches) failed(calculateStandardEstimatedEmploymentSubsidy(input(), subsidyContext(patch as Partial<EmploymentSubsidyParameters>)))
  })
  it("rechaza familias incorrectas, huecos y solapamientos de vigencia", () => {
    for (const key of ["uma", "subsidy"] as const) {
      const badKind = { ...context, [key]: context[key].map(set => ({ ...set, kind: "imss-constants" })) } as StandardEmploymentSubsidyContext
      failed(calculateStandardEstimatedEmploymentSubsidy(input(), badKind))
      for (const effectiveThrough of ["2026-01-30", "2026-02-01"]) {
        const ctx = { ...context, [key]: context[key].map((set, i) => i === 0 ? { ...set, effectiveThrough } : set) }
        failed(calculateStandardEstimatedEmploymentSubsidy(input(), ctx))
      }
    }
  })
  it("no aproxima una fecha fuera de cobertura y rechaza precisión insuficiente", () => {
    failed(calculateStandardEstimatedEmploymentSubsidy(input(), { ...context, supportedDates: { from: "2026-03-01", through: "2026-12-31" } }), "parameters", "not-supported")
    const result = failed(calculateStandardEstimatedEmploymentSubsidy(input(), subsidyContext({ rateProportion: "0.12345678901234567890123456789012345678901234567891" })))
    expect(result.issues.some(issue => issue.kind === "technical-range")).toBe(true)
  })
  it("no elegibilidad es cero determinado con motivo; no soportado es nulo", () => {
    const above = successful(input({ grossPeriodSalary: "15000.00" }))
    expect(above.data.eligibility.reason).toBe("above-monthly-reference-limit")
    expect(above.amounts.subsidyDetermined).toBe("0.00")
    expect(above.data.monthlySubsidyTheoretical.value).toBe("535.646244")
    expect(above.amounts.isrAfterSubsidyProvisional).toBe("1402.82")
    failed(calculateStandardEstimatedEmploymentSubsidy(input({ profileId: "calendar-context" }), context), "profileId", "not-supported")
  })
})

describe("trazabilidad y aislamiento de contexto real", () => {
  it("fuentes retenidas y versiones conviven sin alterar los parámetros previos", () => {
    const result = successful()
    expect(result.data.fiscalPackageVersion).toBe("mx-fiscal-2026-source-v3")
    expect(result.data.parameterSetIds).toEqual(["mx-isr-2026-monthly", "mx-uma-2026", "mx-employment-subsidy-february-2026"])
    expect(result.data.parameterSetVersions).toHaveLength(3)
    expect(result.data.sources.some(source => source.url.endsWith("5725287") && source.locator.includes("segundo párrafo"))).toBe(true)
    expect(result.data.sources.some(source => source.url.endsWith("5777649"))).toBe(true)
    expect(result.data.policyVersion).toBe(STANDARD_EMPLOYMENT_SUBSIDY_POLICY.id)
    expect(result.data.precisionPolicy).toBe(DECIMAL_POLICY.id)
    expect(result.data.conventionVersion).toBe(STANDARD_CONVENTIONS.id)
    expect(result.data.monthlyReconciliation).toBe("not-simulated")
    expect(result.data.actualMonthlyContext).toEqual({ income: null, priorSubsidyApplied: null, priorIsrWithheld: null, otherPayments: null, employerElection: "not-evaluated" })
    expect(result.warnings.some(warning => warning.code === "EMPLOYMENT_SUBSIDY_NOT_EVALUATED")).toBe(false)
    expect(result.warnings.some(warning => warning.code === "EMPLOYER_ELECTION_NOT_EVALUATED")).toBe(true)
    expect(result.data.isrResult.data.subsidy.amount).toBeNull()
  })
  it("lee tasas, límites, divisor y UMA mensual desde el contexto", () => {
    const changed = successful(input(), { ...subsidyContext({ rateProportion: "0.2" }), uma: umaContext({ monthly: "1000.00" }).uma })
    expect(changed.amounts.subsidyDetermined).toBe("200.00")
    expect(changed.amounts.isrAfterSubsidyProvisional).toBe("469.31")
    const weekly = successful(input({ grossPeriodSalary: "1000.00", periodicity: "weekly" }), subsidyContext({ submonthlyDivisor: "30" }))
    expect(weekly.amounts.subsidyDetermined).toBe("124.98")
    expect(successful(input(), subsidyContext({ monthlyIncomeLimit: "9000.00" })).amounts.subsidyDetermined).toBe("0.00")
  })
  it("no requiere IMSS, mínimos o prestaciones ni muta entradas o configuración global", () => {
    const registry = { ...FISCAL_PARAMETERS_2026, imssConstants: [], minimumWages: [], contractualDivisors: [], laborBenefitMinima: [] }
    const ctx = structuredClone(standardEmploymentSubsidyContext2026(registry))
    const request = Object.freeze(input())
    const beforeContext = JSON.stringify(ctx)
    const beforeInput = JSON.stringify(request)
    const precision = Decimal.precision
    const rounding = Decimal.rounding
    try {
      Decimal.set({ precision: 3, rounding: Decimal.ROUND_DOWN })
      const result = successful(request, ctx)
      expect(result.amounts.subsidyDetermined).toBe("535.65")
      expect(result.amounts.isrAfterSubsidyProvisional).toBe("133.66")
      expect(Decimal.precision).toBe(3)
      expect(Decimal.rounding).toBe(Decimal.ROUND_DOWN)
      for (const value of [result, result.data, result.amounts, result.data.parameters, result.data.parameters.uma.data, result.data.parameters.subsidy.data, result.data.eligibility, result.data.rounding, result.data.actualMonthlyContext, result.data.sources[0]]) expect(Object.isFrozen(value)).toBe(true)
      expect(Object.isFrozen(ctx.uma[0])).toBe(false)
    } finally { Decimal.set({ precision, rounding }) }
    expect(JSON.stringify(ctx)).toBe(beforeContext)
    expect(JSON.stringify(request)).toBe(beforeInput)
  })
})
