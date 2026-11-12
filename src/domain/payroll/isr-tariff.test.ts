import Decimal from "decimal.js"
import { describe, expect, it } from "vitest"
import calculationCsv from "../../tests/fixtures/isr-calculation.expected.csv?raw"
import tableCsv from "../../tests/fixtures/isr-2026.expected.csv?raw"
import { FISCAL_PARAMETERS_2026, standardIsrTariffContext2026 } from "../../infrastructure/fiscal/2026"
import type { FiscalParameterSet, IsrTariff, IsrTariffRow, PayrollPeriodicity } from "./contracts"
import { DECIMAL_POLICY } from "./money"
import { STANDARD_CONVENTIONS } from "./simulation-conventions"
import { calculateStandardEstimatedIsrByTariff, STANDARD_ISR_TARIFF_POLICY } from "./isr-tariff"
import type { StandardEstimatedIsrByTariffResult, StandardIsrTariffContext, StandardIsrTariffInput } from "./isr-tariff-contracts"

const context = standardIsrTariffContext2026()
const ReferenceDecimal = Decimal.clone({ precision: 100, rounding: Decimal.ROUND_HALF_UP })
const periods = ["weekly", "fortnightly", "monthly"] as const
function csvLines(text: string) { return text.split(/\r?\n/).filter(line => line && !line.startsWith("#")).slice(1) }
const tables = csvLines(tableCsv).map(line => {
  const [periodicity, lower, upper, fixedFee, ratePercent] = line.split(",")
  return { periodicity, lower, upper: upper || null, fixedFee, ratePercent }
})
const samples = csvLines(calculationCsv).map(line => {
  const [periodicity, base, bracket, excess, taxOnExcess, raw, expected] = line.split(",")
  return { periodicity: periodicity as PayrollPeriodicity, base, bracket: Number(bracket), excess, taxOnExcess, raw, expected }
})
function input(overrides: Partial<StandardIsrTariffInput> = {}): StandardIsrTariffInput {
  return { profileId: STANDARD_CONVENTIONS.id, grossPeriodSalary: "15000.00", periodicity: "monthly", referenceDate: "2026-02-01", ...overrides }
}
function successful(request: unknown = input(), ctx = context) {
  const result = calculateStandardEstimatedIsrByTariff(request, ctx)
  expect(result.status).toBe("estimated")
  if (result.status !== "estimated") throw new Error(JSON.stringify(result.issues))
  return result
}
function failed(result: StandardEstimatedIsrByTariffResult, field: string, status = "not-determinable") {
  expect(result.status).toBe(status)
  expect(result.data).toBeNull()
  expect(result.isrByTariff).toBeNull()
  expect(result.issues.some(item => item.field === field)).toBe(true)
  return result
}
function withTariff(change: (set: FiscalParameterSet<IsrTariff>) => FiscalParameterSet<IsrTariff>): StandardIsrTariffContext {
  return { ...context, isrTariffs: context.isrTariffs.map(set => set.key === "monthly" ? change(set) : set) }
}
function withRow(patch: Partial<IsrTariffRow>, index = 4) {
  return withTariff(set => ({ ...set, data: { ...set.data, rows: set.data.rows.map((row, i) => i === index ? { ...row, ...patch } : row) } }))
}

describe("ISR por tarifa: 165 oráculos independientes", () => {
  it.each(samples)("$periodicity / $base: tramo $bracket, ISR $expected", sample => {
    const result = successful(input({ grossPeriodSalary: sample.base, periodicity: sample.periodicity }))
    expect(result.data.taxableIncome).toBe(sample.base)
    expect(result.isrByTariff).toBe(sample.expected)
    expect(result.data.isrBeforeRounding).toEqual({ value: sample.raw, exact: true, precision: 50 })
    expect(result.data.rounding).toMatchObject({ before: sample.raw, after: sample.expected, mode: "half-up", decimals: 2 })
    expect(result.data.rounding.changed).toBe(!new ReferenceDecimal(sample.raw).eq(sample.expected))
    if (sample.bracket === 0) {
      expect(result.data.selectedBracket).toBeNull()
      expect(result.data.bracketSelection).toBe("zero-base-no-bracket")
      expect(result.warnings.some(warning => warning.code === "ZERO_BASE_WITHOUT_TARIFF_BRACKET")).toBe(true)
    } else {
      const expectedRow = tables.filter(row => row.periodicity === sample.periodicity)[sample.bracket - 1]
      const bracket = result.data.selectedBracket
      expect(bracket).not.toBeNull()
      expect(bracket?.number).toBe(sample.bracket)
      expect(bracket?.lower).toBe(expectedRow.lower)
      expect(bracket?.upper).toBe(expectedRow.upper)
      expect(bracket?.fixedFee).toBe(expectedRow.fixedFee)
      expect(new ReferenceDecimal(bracket!.ratePercent).eq(expectedRow.ratePercent)).toBe(true)
      expect(new ReferenceDecimal(bracket!.rateProportion.value).eq(new ReferenceDecimal(expectedRow.ratePercent).div(100))).toBe(true)
      expect(bracket?.excessOverLower).toEqual({ value: sample.excess, exact: true, precision: 50 })
      expect(bracket?.taxOnExcess).toEqual({ value: sample.taxOnExcess, exact: true, precision: 50 })
      expect(result.data.bracketSelection).toBe("inclusive-cent-grid")
    }
    expect(result.data.subsidy).toEqual({ status: "not-evaluated", amount: null })
    expect(result.data.minimumWageWithholdingException.status).toBe("not-evaluated")
    expect(result.data.finalWithholding).toEqual({ status: "not-calculated", amount: null })
  })

  it.each(periods)("el oráculo cubre once tramos y cada límite ± un centavo en %s", periodicity => {
    expect(samples).toHaveLength(165)
    const rows = tables.filter(row => row.periodicity === periodicity)
    const cases = samples.filter(sample => sample.periodicity === periodicity)
    expect(rows).toHaveLength(11)
    expect(new Set(cases.filter(sample => sample.bracket > 0).map(sample => sample.bracket)).size).toBe(11)
    for (const row of rows) {
      for (const boundary of [row.lower, row.upper]) {
        if (boundary === null) continue
        for (const delta of ["-0.01", "0", "0.01"]) {
          const base = new ReferenceDecimal(boundary).plus(delta).toFixed(2)
          expect(cases.some(sample => sample.base === base), `${periodicity}: ${boundary} + ${delta}`).toBe(true)
        }
      }
    }
  })

  it("respeta la discontinuidad quincenal 6216.15 → 6216.16 y las cuotas oficiales", () => {
    const before = successful(input({ periodicity: "fortnightly", grossPeriodSalary: "6216.15" }))
    const after = successful(input({ periodicity: "fortnightly", grossPeriodSalary: "6216.16" }))
    expect(before.data.selectedBracket).toMatchObject({ number: 3, fixedFee: "207.75", ratePercent: "10.88", upper: "6216.15" })
    expect(before.data.isrBeforeRounding.value).toBe("499.224112")
    expect(before.isrByTariff).toBe("499.22")
    expect(after.data.selectedBracket).toMatchObject({ number: 4, fixedFee: "499.20", ratePercent: "16", lower: "6216.16" })
    expect(after.data.selectedBracket?.excessOverLower.value).toBe("0")
    expect(after.isrByTariff).toBe("499.20")
    expect(new ReferenceDecimal(after.isrByTariff).lt(before.isrByTariff)).toBe(true)
  })

  it.each([
    ["weekly", "12834.24", "2407.905", "2407.91"],
    ["fortnightly", "27501.76", "5159.745", "5159.75"],
    ["monthly", "17539.90", "1858.175", "1858.18"],
  ] as const)("medio centavo exacto %s: %s → %s → %s", (periodicity, grossPeriodSalary, raw, amount) => {
    const result = successful(input({ periodicity, grossPeriodSalary }))
    expect(result.data.isrBeforeRounding.value).toBe(raw)
    expect(result.isrByTariff).toBe(amount)
  })

  it.each(periods)("base cero verifica la tarifa y no inventa tramo, subsidio ni exención (%s)", periodicity => {
    const result = successful(input({ periodicity, grossPeriodSalary: "0.00" }))
    expect(result.isrByTariff).toBe("0.00")
    expect(result.data.tariff.data.rows[0].lower).toBe("0.01")
    expect(result.data.selectedBracket).toBeNull()
    failed(calculateStandardEstimatedIsrByTariff(input({ periodicity, grossPeriodSalary: "0.00" }), { ...context, isrTariffs: [] }), "parameters")
  })
})

describe("alcance, captura y paquetes ISR", () => {
  it.each([undefined, null, [], "15000", 15000])("rechaza captura inválida %j", request => {
    failed(calculateStandardEstimatedIsrByTariff(request, context), "request")
  })
  it.each([undefined, null, "", " ", -1, 15000, "-0.01", "-100", "1e4", "NaN", "Infinity", "15,000.00", "0.001", "6216.155", "100000000000000000000.00"])("rechaza importe inválido %j sin redondear captura", grossPeriodSalary => {
    failed(calculateStandardEstimatedIsrByTariff({ ...input(), grossPeriodSalary }, context), "grossPeriodSalary")
  })
  it.each([undefined, null, "", 7])("requiere periodicidad explícita %j", periodicity => {
    failed(calculateStandardEstimatedIsrByTariff({ ...input(), periodicity }, context), "periodicity")
  })
  it.each(["daily", "annual", "MONTHLY", "biweekly", "constructor", "__proto__"])("no sustituye periodicidad fuera de alcance %s", periodicity => {
    failed(calculateStandardEstimatedIsrByTariff({ ...input(), periodicity }, context), "periodicity", "not-supported")
  })
  it.each([undefined, null, "", 1])("exige perfil explícito %j", profileId => {
    failed(calculateStandardEstimatedIsrByTariff({ ...input(), profileId }, context), "profileId")
  })
  it.each(["calendar-context", "variable-salary", "mixed-income", "standard-estimate-2025-v1"])("rechaza perfil %s", profileId => {
    failed(calculateStandardEstimatedIsrByTariff(input({ profileId }), context), "profileId", "not-supported")
  })
  it.each([
    { includeWorkerImss: true }, { workerImss: "394.54" }, { exemptIncome: "100" }, { subsidy: "0" },
    { operation: "net-to-gross" }, { salaryNature: "variable" }, { benefits: {} }, { actualCotizedDays: "28" },
  ])("rechaza conceptos adicionales %j", extra => {
    failed(calculateStandardEstimatedIsrByTariff({ ...input(), ...extra }, context), "request", "not-supported")
  })
  it.each([undefined, null, "", "2026-02-29", "2026-13-01", "2026-02-01T00:00:00Z", 2026])("rechaza fecha inválida %j", referenceDate => {
    failed(calculateStandardEstimatedIsrByTariff({ ...input(), referenceDate }, context), "referenceDate")
  })
  it.each(["2025-12-31", "2027-01-01"])("no sustituye ejercicio de fecha %s", referenceDate => {
    failed(calculateStandardEstimatedIsrByTariff(input({ referenceDate }), context), "referenceDate", "not-supported")
  })
  it("rechaza fecha fuera de cobertura aun con base cero", () => {
    const ctx = { ...context, supportedDates: { from: "2026-03-01", through: "2026-12-31" } }
    for (const grossPeriodSalary of ["0.00", "15000.00"]) failed(calculateStandardEstimatedIsrByTariff(input({ grossPeriodSalary }), ctx), "parameters", "not-supported")
  })
  it.each([2025, 2027, undefined])("rechaza ejercicio de paquete %j", exercise => {
    failed(calculateStandardEstimatedIsrByTariff(input(), { ...context, exercise } as unknown as StandardIsrTariffContext), "parameters")
  })
  it("rechaza paquetes incompletos, coberturas inválidas y familias equivocadas", () => {
    const patches = [
      undefined, { ...context, fiscalPackageVersion: "" }, { ...context, fiscalPackageVersion: undefined },
      { ...context, supportedDates: undefined }, { ...context, isrTariffs: undefined }, { ...context, isrTariffs: [null] },
      { ...context, supportedDates: { from: "2026-12-31", through: "2026-01-01" } },
      { ...context, supportedDates: { from: "2025-01-01", through: "2026-12-31" } },
      { ...context, supportedDates: { from: "2026-01-01", through: "2027-12-31" } },
    ]
    for (const ctx of patches) failed(calculateStandardEstimatedIsrByTariff(input(), ctx as unknown as StandardIsrTariffContext), "parameters")
    failed(calculateStandardEstimatedIsrByTariff(input(), withTariff(set => ({ ...set, kind: "uma" }))), "parameters")
    failed(calculateStandardEstimatedIsrByTariff(input(), withTariff(set => ({ ...set, data: { ...set.data, exercise: 2025 } }))), "parameters")
    failed(calculateStandardEstimatedIsrByTariff(input(), withTariff(set => ({ ...set, data: { ...set.data, periodicity: "weekly" } }))), "parameters")
  })
  it.each(periods)("rechaza tarifa solicitada ausente %s aunque existan otras", periodicity => {
    const ctx = { ...context, isrTariffs: context.isrTariffs.filter(set => set.key !== periodicity) }
    failed(calculateStandardEstimatedIsrByTariff(input({ periodicity }), ctx), "parameters")
  })
  it.each(["pending-review", "rejected"] as const)("rechaza tarifa no verificada %s", validation => {
    failed(calculateStandardEstimatedIsrByTariff(input(), withTariff(set => ({ ...set, validation }))), "parameters")
  })
  it("rechaza metadatos, fuentes y filas incompletas", () => {
    const set = context.isrTariffs.find(item => item.key === "monthly")!
    const patches = [
      { id: undefined }, { key: undefined }, { version: undefined }, { version: "" }, { sources: undefined },
      { sources: [] }, { sources: [null] }, { sources: [{ ...set.sources[0], document: undefined }] },
      { sources: [{ ...set.sources[0], url: "https://example.com/tariff" }] }, { data: null },
      { data: { ...set.data, rows: undefined } }, { data: { ...set.data, rows: [null] } },
    ]
    for (const patch of patches) {
      const ctx = withTariff(current => ({ ...current, ...patch } as unknown as FiscalParameterSet<IsrTariff>))
      failed(calculateStandardEstimatedIsrByTariff(input(), ctx), "parameters")
    }
    for (const patch of [{ lower: undefined }, { upper: undefined }, { fixedFee: undefined }, { ratePercent: undefined }]) {
      failed(calculateStandardEstimatedIsrByTariff(input(), withRow(patch as unknown as IsrTariffRow)), "parameters")
    }
  })
  it("rechaza huecos, solapamientos y duplicados de vigencia", () => {
    failed(calculateStandardEstimatedIsrByTariff(input(), withTariff(set => ({ ...set, effectiveFrom: "2026-01-02" }))), "parameters")
    failed(calculateStandardEstimatedIsrByTariff(input(), withTariff(set => ({ ...set, effectiveThrough: "2026-12-30" }))), "parameters")
    const original = context.isrTariffs.find(set => set.key === "monthly")!
    const ctx = { ...context, isrTariffs: [...context.isrTariffs, { ...original, id: "duplicate-monthly", effectiveFrom: "2026-06-01" }] }
    failed(calculateStandardEstimatedIsrByTariff(input(), ctx), "parameters")
  })
  it.each([
    { lower: "14644.66" }, { lower: "14644.64" }, { upper: null }, { fixedFee: "-0.01" },
    { fixedFee: "1339.141" }, { ratePercent: "0" }, { ratePercent: "-1" }, { ratePercent: "100.01" },
  ])("rechaza filas incompatibles %j", patch => {
    failed(calculateStandardEstimatedIsrByTariff(input(), withRow(patch)), "parameters")
  })
  it("rechaza tarifa incompleta y tramo superior indebidamente cerrado", () => {
    failed(calculateStandardEstimatedIsrByTariff(input(), withTariff(set => ({ ...set, data: { ...set.data, rows: set.data.rows.slice(0, 10) } }))), "parameters")
    failed(calculateStandardEstimatedIsrByTariff(input(), withRow({ upper: "999999.99" }, 10)), "parameters")
  })
})

describe("trazabilidad y separación de retención final", () => {
  it.each(periods)("conserva tarifa completa, fuentes y versiones en %s", periodicity => {
    const result = successful(input({ periodicity }))
    const set = context.isrTariffs.find(item => item.key === periodicity)!
    expect(result.data.tariff).toEqual(set)
    expect(result.data.tariff).not.toBe(set)
    expect(result.data.tariffSection).toBe({ weekly: "B.II", fortnightly: "B.IV", monthly: "B.V" }[periodicity])
    expect(result.data.sources).toEqual(set.sources)
    expect(result.data.parameterSetVersions).toEqual([{ id: set.id, version: set.version }])
    expect(result.data.fiscalPackageVersion).toBe("mx-fiscal-2026-source-v3")
    expect(result.data.policyVersion).toBe(STANDARD_ISR_TARIFF_POLICY.id)
    expect(result.data.precisionPolicy).toBe(DECIMAL_POLICY.id)
    expect(result.data.resultNature).toBe("isr-by-tariff-before-subsidy-not-final-withholding")
    expect(result.warnings.map(warning => warning.code)).toEqual(["EMPLOYMENT_SUBSIDY_NOT_EVALUATED", "MINIMUM_WAGE_WITHHOLDING_EXCEPTION_NOT_EVALUATED", "NOT_FINAL_ISR_WITHHOLDING"])
  })
  it.each(["2026-01-01", "2026-01-31", "2026-02-01", "2026-12-31"])("selecciona por vigencia en %s sin cambios por UMA", referenceDate => {
    const result = successful(input({ referenceDate }))
    expect(result.data.referenceDate).toBe(referenceDate)
    expect(result.isrByTariff).toBe("1402.82")
  })
  it("no resta IMSS del bruto ni evalúa salario mínimo o subsidio", () => {
    const registry = { ...FISCAL_PARAMETERS_2026, uma: [], minimumWages: [], subsidy: [], imssConstants: [], contractualDivisors: [], laborBenefitMinima: [] }
    const result = successful(input(), standardIsrTariffContext2026(registry))
    expect(result.data.taxableIncome).toBe("15000.00")
    expect(result.isrByTariff).toBe("1402.82")
    expect(result.data.taxableIncomeBasis).toBe("ordinary-period-gross-without-imss-deduction")
    const minimum = successful(input({ grossPeriodSalary: "9451.20" }))
    expect(minimum.isrByTariff).toBe("669.31")
    expect(minimum.data.minimumWageWithholdingException.status).toBe("not-evaluated")
  })
  it("la cuota fija y la tasa proceden de los parámetros, no de interpolación ni constantes duplicadas", () => {
    // Synthetic parameters verify data dependency only; not official replacement values.
    const changed = successful(input(), withRow({ fixedFee: "1500.00", ratePercent: "20" }))
    expect(changed.data.selectedBracket?.fixedFee).toBe("1500.00")
    expect(changed.data.isrBeforeRounding.value).toBe("1571.07")
    expect(changed.isrByTariff).toBe("1571.07")
  })
  it("solo necesita la serie de la tarifa solicitada", () => {
    const ctx = { ...context, isrTariffs: context.isrTariffs.filter(set => set.key === "monthly") }
    expect(successful(input(), ctx).isrByTariff).toBe("1402.82")
  })
  it("rechaza pérdida de precisión interna sin truncar el importe", () => {
    const ctx = withRow({ ratePercent: "17.123456789012345678901234567890123456789012345678" })
    const result = failed(calculateStandardEstimatedIsrByTariff(input(), ctx), "parameters")
    expect(result.issues.some(item => item.kind === "technical-range")).toBe(true)
  })
  it("conserva entradas, cadenas con centavos, salida congelada y Decimal global", () => {
    const request = Object.freeze(input({ grossPeriodSalary: "00015000.01" }))
    const ctx = structuredClone(context)
    const beforeRequest = JSON.stringify(request)
    const beforeContext = JSON.stringify(ctx)
    const precision = Decimal.precision
    const rounding = Decimal.rounding
    try {
      Decimal.set({ precision: 3, rounding: Decimal.ROUND_DOWN })
      const result = successful(request, ctx)
      expect(result.data.taxableIncome).toBe("15000.01")
      expect(result.data.isrBeforeRounding.value).toBe("1402.820512")
      expect(result.isrByTariff).toBe("1402.82")
      expect(Decimal.precision).toBe(3)
      expect(Decimal.rounding).toBe(Decimal.ROUND_DOWN)
      expect(Object.isFrozen(result)).toBe(true)
      expect(Object.isFrozen(result.data)).toBe(true)
      expect(Object.isFrozen(result.data.tariff.data.rows[0])).toBe(true)
      expect(Object.isFrozen(result.data.tariff.data.rows)).toBe(true)
      expect(Object.isFrozen(result.data.sources[0])).toBe(true)
      expect(Object.isFrozen(result.data.selectedBracket?.rateProportion)).toBe(true)
      expect(Object.isFrozen(result.data.selectedBracket)).toBe(true)
      expect(Object.isFrozen(result.data.isrBeforeRounding)).toBe(true)
      expect(Object.isFrozen(result.data.rounding)).toBe(true)
      expect(Object.isFrozen(ctx.isrTariffs[0])).toBe(false)
    } finally { Decimal.set({ precision, rounding }) }
    expect(JSON.stringify(request)).toBe(beforeRequest)
    expect(JSON.stringify(ctx)).toBe(beforeContext)
  })
})
