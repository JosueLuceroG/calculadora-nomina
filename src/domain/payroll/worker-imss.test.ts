import Decimal from "decimal.js"
import { describe, expect, it } from "vitest"
import oracle from "../../tests/fixtures/worker-imss.expected.json"
import { FISCAL_PARAMETERS_2026, standardSbcContext2026 } from "../../infrastructure/fiscal/2026"
import type { ImssBranch, ImssConstants, PayrollPeriodicity } from "./contracts"
import { DECIMAL_POLICY } from "./money"
import { calculateStandardEstimatedSbc } from "./sbc"
import { STANDARD_CONVENTIONS } from "./simulation-conventions"
import { calculateStandardEstimatedWorkerImss, STANDARD_WORKER_IMSS_POLICY } from "./worker-imss"
import type { StandardEstimatedWorkerImssResult, StandardWorkerImssContext, StandardWorkerImssInput, WorkerImssAmounts } from "./worker-imss-contracts"

const context = standardSbcContext2026()
const ReferenceDecimal = Decimal.clone({ precision: 100, rounding: Decimal.ROUND_HALF_UP })
const branches = oracle.branchOrder as ImssBranch[]
function input(overrides: Partial<StandardWorkerImssInput> = {}): StandardWorkerImssInput {
  return {
    profileId: STANDARD_CONVENTIONS.id, area: "general-zone", grossPeriodSalary: "15000.00",
    periodicity: "monthly", referenceDate: "2026-02-01", benefits: { ...oracle.benefitProfiles.standard },
    includeWorkerImss: true, ...overrides,
  }
}
function successful(request: unknown = input(), ctx = context) {
  const result = calculateStandardEstimatedWorkerImss(request, ctx)
  expect(result.status).toBe("estimated")
  if (result.status !== "estimated") throw new Error(JSON.stringify(result.issues))
  return result
}
function failed(result: StandardEstimatedWorkerImssResult, field: string, status = "not-determinable") {
  expect(result.status).toBe(status)
  expect(result.data).toBeNull()
  expect(result.byBranch).toBeNull()
  expect(result.quotas).toEqual({ calculated: null, deducted: null, absorbedByEmployer: null, excludedBySimulation: null })
  expect(result.issues.some(item => item.field === field)).toBe(true)
  return result
}
function withConstants(overrides: Partial<ImssConstants>): StandardWorkerImssContext {
  return { ...context, imssConstants: context.imssConstants.map(set => ({ ...set, data: { ...set.data, ...overrides } })) }
}
function reconcile(quotas: WorkerImssAmounts) {
  // Independent decimal constructor, not the arithmetic implementation under test.
  expect(new ReferenceDecimal(quotas.deducted).plus(quotas.absorbedByEmployer).plus(quotas.excludedBySimulation).toFixed(2)).toBe(quotas.calculated)
}

describe("IMSS obrero: oráculos racionales independientes", () => {
  it.each(oracle.cases)("$id: cinco ramos, precisión, vigencia y distribución", sample => {
    for (const includeWorkerImss of [true, false]) {
      const request = input({
        grossPeriodSalary: sample.grossPeriodSalary, periodicity: sample.periodicity as PayrollPeriodicity,
        referenceDate: sample.referenceDate, includeWorkerImss,
        benefits: oracle.benefitProfiles[sample.benefitProfile as keyof typeof oracle.benefitProfiles],
      })
      const result = successful(request)
      const { expected } = sample
      expect(result.data.estimatedSbc).toBe(expected.sbc)
      expect(result.data.umaDaily).toBe(expected.uma)
      expect(new ReferenceDecimal(result.data.thresholdDaily.value).eq(expected.threshold)).toBe(true)
      expect(new ReferenceDecimal(result.data.excessDaily.value).eq(expected.excess)).toBe(true)
      expect(result.data.thresholdRelation).toBe(expected.thresholdRelation)
      expect(result.data.referenceCotizedDays).toBe(expected.days)
      expect(result.data.contractualMinimumCheck.relation).toBe(expected.contractRelation)
      expect(result.data.sbcResult.data.sbc.limitApplied).toBe(expected.limitApplied)
      expect(result.quotas.calculated).toBe(expected.total)
      const allocatedTo = expected.contractRelation === "at-general-minimum" ? "absorbedByEmployer" : includeWorkerImss ? "deducted" : "excludedBySimulation"
      expect(result.quotas[allocatedTo]).toBe(expected.total)
      for (const key of ["deducted", "absorbedByEmployer", "excludedBySimulation"] as const) {
        if (key !== allocatedTo) expect(result.quotas[key]).toBe("0.00")
      }
      expect(Object.keys(result.byBranch)).toEqual(branches)
      branches.forEach((branch, index) => {
        const detail = result.byBranch[branch]
        expect(detail.workerRate).toBe(oracle.rates[index])
        expect(detail.baseReference).toBe(branch === "excess-medical" ? "sbc-excess-over-threshold" : "sbc")
        expect(new ReferenceDecimal(detail.dailyBase).eq(branch === "excess-medical" ? expected.excess : expected.sbc)).toBe(true)
        expect(detail.periodQuota).toEqual({ value: expected.periodQuotas[index], exact: true, precision: 50 })
        expect(detail.dailyQuota.exact).toBe(true)
        expect(new ReferenceDecimal(detail.dailyQuota.value).eq(new ReferenceDecimal(expected.periodQuotas[index]).div(expected.days))).toBe(true)
        expect(detail.quotas.calculated).toBe(expected.amounts[index])
        expect(detail.quotas[allocatedTo]).toBe(expected.amounts[index])
        expect(detail.rounding).toMatchObject({ mode: "half-up", decimals: 2, before: expected.periodQuotas[index], after: expected.amounts[index] })
        reconcile(detail.quotas)
      })
      for (const key of ["calculated", "deducted", "absorbedByEmployer", "excludedBySimulation"] as const) {
        const sum = Object.values(result.byBranch).reduce((total, branch) => total.plus(branch.quotas[key]), new ReferenceDecimal(0))
        expect(sum.toFixed(2)).toBe(result.quotas[key])
      }
      reconcile(result.quotas)
      expect(result.data.reconciliationVerified).toBe(true)
    }
  })

  it("el caso obligatorio determina 394.54; otros órdenes de redondeo difieren", () => {
    const result = successful()
    expect(result.quotas).toEqual({ calculated: "394.54", deducted: "394.54", absorbedByEmployer: "0.00", excludedBySimulation: "0.00" })
    const details = Object.values(result.byBranch)
    const roundTotal = details.reduce((total, branch) => total.plus(branch.periodQuota.value), new ReferenceDecimal(0)).toFixed(2)
    const roundDaily = details.reduce((total, branch) => total.plus(new ReferenceDecimal(branch.dailyQuota.value).toFixed(2)), new ReferenceDecimal(0)).times(30).toFixed(2)
    expect(roundTotal).toBe("394.55")
    expect(roundDaily).toBe("394.50")
    expect(result.byBranch["pensioner-medical"].dailyQuota.value).toBe("1.967475")
    expect(result.byBranch["excess-medical"].dailyQuota.value).toBe("0.69092")
  })

  it("consume la integración y el SBC existentes sin modificar su contrato", () => {
    const request = input({ grossPeriodSalary: "300000.00" })
    const { includeWorkerImss: _switch, ...sbcInput } = request
    const previous = calculateStandardEstimatedSbc(sbcInput, context)
    const result = successful(request)
    expect(result.data.sbcResult).toEqual(previous)
    expect(result.data.sbcResult.data.integration.applicableSbc).toBeNull()
    expect(result.data.sbcResult.data.integration.theoreticalSdi.presentation.amount).toBe("10493.15")
    expect(result.data.estimatedSbc).toBe("2932.75")
  })

  it("conserva las advertencias de prestaciones declaradas, sin corregirlas", () => {
    const result = successful(input({ grossPeriodSalary: "12012.00", benefits: oracle.benefitProfiles.zero }))
    expect(result.warnings.map(warning => warning.code)).toEqual(["BONUS_BELOW_LEGAL_MINIMUM", "VACATIONS_BELOW_FIRST_ANNUAL_MINIMUM", "PREMIUM_BELOW_LEGAL_MINIMUM"])
    expect(result.data.sbcResult.data.integration.factor.value).toBe("1")
    expect(result.quotas.calculated).toBe("291.12")
  })
})

describe("mínimo contractual, absorción y exclusión", () => {
  it.each([true, false])("distingue 9451.19/20/21 con SBC coincidente e interruptor %s", includeWorkerImss => {
    const below = failed(calculateStandardEstimatedWorkerImss(input({ grossPeriodSalary: "9451.19", includeWorkerImss }), context), "grossPeriodSalary", "not-supported")
    expect(below.diagnosticSbc?.data.sbc.estimatedSbc).toBe("330.58")
    expect(below.diagnosticSbc?.data.integration.dailySalary.presentation.amount).toBe("315.04")
    expect(below.diagnosticSbc?.data.contractualMinimumCheck.relation).toBe("below-general-minimum")
    expect(below.warnings.some(warning => warning.code === "CONTRACTUAL_DAILY_SALARY_BELOW_GENERAL_MINIMUM")).toBe(true)
    const at = successful(input({ grossPeriodSalary: "9451.20", includeWorkerImss }))
    expect(at.data.sbcResult.data.integration.dailySalary.internal.value).toBe("315.04")
    expect(at.data.allocation).toBe("absorbed-under-LSS-36")
    expect(at.quotas).toEqual({ calculated: "235.53", deducted: "0.00", absorbedByEmployer: "235.53", excludedBySimulation: "0.00" })
    const above = successful(input({ grossPeriodSalary: "9451.21", includeWorkerImss }))
    expect(above.data.estimatedSbc).toBe("330.58")
    expect(above.data.contractualMinimumCheck.relation).toBe("above-general-minimum")
    expect(above.quotas).toEqual({ calculated: "235.53", deducted: includeWorkerImss ? "235.53" : "0.00", absorbedByEmployer: "0.00", excludedBySimulation: includeWorkerImss ? "0.00" : "235.53" })
  })

  it.each(["9000.00", "9150.00", "0.01"])("bloquea %s aunque SBC tenga piso o supere el mínimo", grossPeriodSalary => {
    for (const includeWorkerImss of [true, false]) {
      const result = failed(calculateStandardEstimatedWorkerImss(input({ grossPeriodSalary, includeWorkerImss }), context), "grossPeriodSalary", "not-supported")
      expect(result.diagnosticSbc).not.toBeNull()
      expect(result.diagnosticSbc?.data.contractualMinimumCheck.declaredGrossUnchanged).toBe(grossPeriodSalary)
      expect(result.diagnosticSbc?.data.contractualMinimumCheck.contractSalaryModified).toBe(false)
    }
  })

  it("SBC igual al piso no implica absorción si el contrato está por encima", () => {
    const result = successful(input({ grossPeriodSalary: "9451.21", benefits: oracle.benefitProfiles.zero }))
    expect(result.data.estimatedSbc).toBe("315.04")
    expect(result.data.allocation).toBe("deducted")
    expect(result.quotas.absorbedByEmployer).toBe("0.00")
    expect(result.quotas.deducted).not.toBe("0.00")
  })

  it("IMSS excluido conserva los cinco ramos teóricos y no inventa absorción", () => {
    const included = successful()
    const excluded = successful(input({ includeWorkerImss: false }))
    expect(excluded.quotas).toEqual({ calculated: "394.54", deducted: "0.00", absorbedByEmployer: "0.00", excludedBySimulation: "394.54" })
    for (const branch of branches) {
      expect(excluded.byBranch[branch].periodQuota).toEqual(included.byBranch[branch].periodQuota)
      expect(excluded.byBranch[branch].quotas.excludedBySimulation).toBe(included.byBranch[branch].quotas.calculated)
    }
  })

  it("cero determinado conserva el excedente positivo y difiere de importe nulo", () => {
    const result = successful(input({ grossPeriodSalary: "10558.20", benefits: oracle.benefitProfiles.zero }))
    expect(result.data.thresholdRelation).toBe("above-threshold")
    expect(result.data.excessDaily.value).toBe("0.01")
    expect(result.byBranch["excess-medical"].periodQuota.value).toBe("0.0012")
    expect(result.byBranch["excess-medical"].quotas.calculated).toBe("0.00")
    expect(result.byBranch["excess-medical"].rounding.changed).toBe(true)
  })
})

describe("validación del contrato y parámetros", () => {
  it.each([undefined, null, "", "false", 0, 1, {}, []])("exige booleano explícito (%j)", includeWorkerImss => {
    failed(calculateStandardEstimatedWorkerImss({ ...input(), includeWorkerImss }, context), "includeWorkerImss")
  })
  it.each([undefined, null, [], "15000.00"])("rechaza captura inválida %j", request => {
    failed(calculateStandardEstimatedWorkerImss(request, context), "request")
  })
  it("hereda captura estricta y no descarta conceptos fuera de alcance", () => {
    for (const extra of [{ operation: "net-to-gross" }, { actualCotizedDays: "28" }, { bonus: "100" }, { isr: "0" }]) {
      failed(calculateStandardEstimatedWorkerImss({ ...input(), ...extra }, context), "request", "not-supported")
    }
    failed(calculateStandardEstimatedWorkerImss(input({ area: "northern-border-zone" }), context), "area", "not-supported")
    failed(calculateStandardEstimatedWorkerImss(input({ profileId: "calendar-context" }), context), "profileId", "not-supported")
    failed(calculateStandardEstimatedWorkerImss(input({ benefits: { ...input().benefits, annualBonusDays: "" } }), context), "benefits.annualBonusDays")
  })
  it.each(["2025-12-31", "2027-01-01"])("rechaza fecha sin cobertura %s incluso con IMSS excluido", referenceDate => {
    failed(calculateStandardEstimatedWorkerImss(input({ referenceDate, includeWorkerImss: false }), context), "referenceDate", "not-supported")
  })
  it("rechaza fecha civil inválida y cobertura reducida sin aproximar", () => {
    failed(calculateStandardEstimatedWorkerImss(input({ referenceDate: "2026-02-29" }), context), "referenceDate")
    failed(calculateStandardEstimatedWorkerImss(input(), { ...context, supportedDates: { from: "2026-03-01", through: "2026-12-31" } }), "parameters", "not-supported")
  })
  it.each(["contractualDivisors", "laborBenefitMinima", "uma", "minimumWages", "imssConstants"] as const)("rechaza serie vacía %s", key => {
    failed(calculateStandardEstimatedWorkerImss(input(), { ...context, [key]: [] }), "parameters")
  })
  it.each(["uma", "minimumWages", "imssConstants"] as const)("rechaza series no verificadas %s con ambos interruptores", key => {
    for (const validation of ["pending-review", "rejected"] as const) {
      for (const includeWorkerImss of [true, false]) {
        const ctx = { ...context, [key]: context[key].map(set => ({ ...set, validation })) }
        failed(calculateStandardEstimatedWorkerImss(input({ includeWorkerImss }), ctx), "parameters")
      }
    }
  })
  it("rechaza contexto y cuerpos ausentes sin producir cuotas parciales", () => {
    failed(calculateStandardEstimatedWorkerImss(input(), undefined as unknown as StandardWorkerImssContext), "parameters")
    failed(calculateStandardEstimatedWorkerImss(input(), { ...context, imssConstants: undefined } as unknown as StandardWorkerImssContext), "parameters")
    for (const key of ["uma", "minimumWages", "imssConstants"] as const) {
      const ctx = { ...context, [key]: context[key].map(set => ({ ...set, data: null })) } as unknown as StandardWorkerImssContext
      failed(calculateStandardEstimatedWorkerImss(input(), ctx), "parameters")
    }
  })
  it("rechaza huecos, solapamientos y tipos de parámetros incompatibles", () => {
    for (const through of ["2026-01-30", "2026-02-01"]) {
      const ctx = { ...context, uma: context.uma.map((set, index) => index === 0 ? { ...set, effectiveThrough: through } : set) }
      failed(calculateStandardEstimatedWorkerImss(input(), ctx), "parameters")
    }
    const ctx: StandardWorkerImssContext = { ...context, imssConstants: context.imssConstants.map(set => ({ ...set, kind: "uma" })) }
    failed(calculateStandardEstimatedWorkerImss(input(), ctx), "parameters")
  })
  it("rechaza metadatos y fuentes incompletos con estado determinable de error", () => {
    const current = context.imssConstants[0]
    for (const patch of [
      { id: undefined }, { key: undefined }, { version: undefined }, { sources: undefined },
      { sources: [null] }, { sources: [{ ...current.sources[0], document: undefined }] },
      { sources: [{ ...current.sources[0], locator: undefined }] }, { sources: [] },
    ]) {
      const ctx = { ...context, imssConstants: [{ ...current, ...patch }] } as unknown as StandardWorkerImssContext
      failed(calculateStandardEstimatedWorkerImss(input({ includeWorkerImss: false }), ctx), "parameters")
    }
  })
  it.each(branches)("exige tasa y base del ramo %s aunque el interruptor esté desactivado", branch => {
    const rates = { ...context.imssConstants[0].data.workerRates }
    const bases = { ...context.imssConstants[0].data.baseReferences }
    delete (rates as Partial<typeof rates>)[branch]
    delete (bases as Partial<typeof bases>)[branch]
    for (const patch of [{ workerRates: rates }, { baseReferences: bases }]) {
      failed(calculateStandardEstimatedWorkerImss(input({ includeWorkerImss: false }), withConstants(patch)), "parameters")
    }
  })
  it.each(["0", "-0.001", "1.001", "1e-3", "", undefined, 0.00375])("rechaza tasa inválida %j", rate => {
    const rates = { ...context.imssConstants[0].data.workerRates, "pensioner-medical": rate } as ImssConstants["workerRates"]
    failed(calculateStandardEstimatedWorkerImss(input(), withConstants({ workerRates: rates })), "parameters")
  })
  it.each(["0", "-3", "25", "26", undefined])("rechaza umbral incompatible %j", multiple => {
    failed(calculateStandardEstimatedWorkerImss(input(), withConstants({ excessThresholdUmaDailyMultiple: multiple as string })), "parameters")
  })
  it("rechaza referencias incorrectas, tablas incompletas y ramos ajenos", () => {
    const current = context.imssConstants[0].data
    const patches: Partial<ImssConstants>[] = [
      { workerAbsorptionReference: "SBC-equals-minimum" as "LSS-36" },
      { baseReferences: { ...current.baseReferences, "excess-medical": "sbc" } },
      { workerRates: null as unknown as ImssConstants["workerRates"] },
      { baseReferences: null as unknown as ImssConstants["baseReferences"] },
      { workerRates: { ...current.workerRates, "risk-at-work": "0.01" } as ImssConstants["workerRates"] },
      { baseReferences: { ...current.baseReferences, "employer-retirement": "sbc" } as ImssConstants["baseReferences"] },
    ]
    for (const patch of patches) failed(calculateStandardEstimatedWorkerImss(input(), withConstants(patch)), "parameters")
  })
  it("no oculta pérdida de precisión interna o excedentes del rango técnico", () => {
    const rates = { ...context.imssConstants[0].data.workerRates, "pensioner-medical": "0.12345678901234567890123456789012345678901234567891" }
    const result = failed(calculateStandardEstimatedWorkerImss(input(), withConstants({ workerRates: rates })), "parameters")
    expect(result.issues.some(item => item.kind === "technical-range")).toBe(true)
    failed(calculateStandardEstimatedWorkerImss(input({ grossPeriodSalary: "100000000000000000000.00" }), context), "grossPeriodSalary")
  })
})

describe("dependencia de parámetros, trazabilidad y aislamiento", () => {
  it.each(branches)("lee la tasa de %s del contexto, sin duplicarla en la fórmula", branch => {
    // Synthetic data for dependency verification only; not a legal rate change.
    const rates = { ...context.imssConstants[0].data.workerRates, [branch]: "0.01" }
    const result = successful(input(), withConstants({ workerRates: rates }))
    expect(result.byBranch[branch].workerRate).toBe("0.01")
    expect(result.byBranch[branch].quotas.calculated).toBe(branch === "excess-medical" ? "51.82" : "157.40")
    for (const other of branches.filter(key => key !== branch)) {
      expect(result.byBranch[other].quotas.calculated).toBe(oracle.cases[0].expected.amounts[branches.indexOf(other)])
    }
    reconcile(result.quotas)
  })
  it("lee múltiplos de umbral y tope del paquete", () => {
    const threshold = successful(input(), withConstants({ excessThresholdUmaDailyMultiple: "4" }))
    expect(threshold.data.thresholdDaily.value).toBe("469.24")
    expect(threshold.byBranch["excess-medical"].quotas.calculated).toBe("6.65")
    expect(threshold.quotas.calculated).toBe("380.46")
    const ceiling = successful(input({ grossPeriodSalary: "300000.00" }), withConstants({ sbcCeilingUmaDailyMultiple: "20" }))
    expect(ceiling.data.estimatedSbc).toBe("2346.20")
    expect(ceiling.quotas.calculated).toBe("1910.98")
  })
  it("una cuota total determinada cero mantiene estado estimated y no se convierte en null", () => {
    // Positive synthetic rates exercise zero determination of every branch.
    const rates = Object.fromEntries(branches.map(branch => [branch, "0.0000001"])) as ImssConstants["workerRates"]
    for (const includeWorkerImss of [true, false]) {
      const result = successful(input({ includeWorkerImss }), withConstants({ workerRates: rates }))
      expect(result.quotas).toEqual({ calculated: "0.00", deducted: "0.00", absorbedByEmployer: "0.00", excludedBySimulation: "0.00" })
      for (const branch of Object.values(result.byBranch)) {
        expect(branch.periodQuota.value).not.toBe("0")
        expect(branch.quotas.calculated).toBe("0.00")
        reconcile(branch.quotas)
      }
    }
  })
  it.each(["2026-01-01", "2026-01-31", "2026-02-01", "2026-12-31"])("identifica fecha, fuentes, versiones y días estimados en %s", referenceDate => {
    const result = successful(input({ referenceDate }))
    expect(result.data.referenceDate).toBe(referenceDate)
    expect(result.data.fiscalPackageVersion).toBe("mx-fiscal-2026-source-v3")
    expect(result.data.parameterSetIds).toContain("mx-imss-worker-constants-2026")
    expect(result.data.parameterSetVersions).toHaveLength(5)
    expect(result.data.parameterSetVersions).toContainEqual({ id: context.imssConstants[0].id, version: context.imssConstants[0].version })
    expect(result.data.sources.some(source => source.locator.includes("36"))).toBe(true)
    expect(result.data.sources.some(source => source.locator.includes("Transitorio Tercero"))).toBe(true)
    expect(result.data.umaValueYear).toBe(referenceDate < "2026-02-01" ? 2025 : 2026)
    expect(result.data.daysNature).toBe("simulation-reference-not-actual-cotization")
    expect(result.data.actualCotizedDays).toBeNull()
    expect(result.data.temporalScope).toBe("effective-date-snapshot")
    expect(result.data.sbcNature).toBe("estimated-not-registered")
    expect(result.data.policyVersion).toBe(STANDARD_WORKER_IMSS_POLICY.id)
    expect(result.data.precisionPolicy).toBe(DECIMAL_POLICY.id)
    expect(result.data.conventionVersion).toBe(STANDARD_CONVENTIONS.id)
    expect(result.data.suaEquivalence).toBe("not-validated")
    expect(result.data.contpaqiEquivalence).toBe("not-validated")
    expect(result.data.assumptions.some(text => text.includes("no representa exención"))).toBe(true)
  })
  it("conserva entradas y parámetros, salida inmutable y Decimal global sin depender de ISR/subsidio", () => {
    const request = Object.freeze(input({ benefits: Object.freeze(input().benefits) }))
    const ctx = standardSbcContext2026({ ...FISCAL_PARAMETERS_2026, isrTariffs: [], subsidy: [] })
    const beforeRequest = JSON.stringify(request)
    const beforeContext = JSON.stringify(ctx)
    const precision = Decimal.precision
    const rounding = Decimal.rounding
    try {
      Decimal.set({ precision: 3, rounding: Decimal.ROUND_DOWN })
      const result = successful(request, ctx)
      expect(result.quotas.calculated).toBe("394.54")
      expect(Decimal.precision).toBe(3)
      expect(Decimal.rounding).toBe(Decimal.ROUND_DOWN)
      expect(Object.isFrozen(result)).toBe(true)
      expect(Object.isFrozen(result.data)).toBe(true)
      expect(Object.isFrozen(result.quotas)).toBe(true)
      expect(Object.isFrozen(result.byBranch)).toBe(true)
      expect(Object.isFrozen(result.data.parameterSetVersions[0])).toBe(true)
      expect(Object.isFrozen(result.data.sources[0])).toBe(true)
      expect(Object.isFrozen(result.data.assumptions)).toBe(true)
      for (const branch of Object.values(result.byBranch)) {
        expect(Object.isFrozen(branch)).toBe(true)
        expect(Object.isFrozen(branch.dailyQuota)).toBe(true)
        expect(Object.isFrozen(branch.periodQuota)).toBe(true)
        expect(Object.isFrozen(branch.rounding)).toBe(true)
        expect(Object.isFrozen(branch.quotas)).toBe(true)
      }
    } finally { Decimal.set({ precision, rounding }) }
    expect(JSON.stringify(request)).toBe(beforeRequest)
    expect(JSON.stringify(ctx)).toBe(beforeContext)
  })
})
