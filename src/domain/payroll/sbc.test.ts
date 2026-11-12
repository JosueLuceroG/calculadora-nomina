import Decimal from "decimal.js"
import { describe, expect, it } from "vitest"
import oracle from "../../tests/fixtures/sbc.expected.json"
import { FISCAL_PARAMETERS_2026, standardIntegrationContext2026, standardSbcContext2026 } from "../../infrastructure/fiscal/2026"
import { calculateStandardSalaryIntegration } from "./salary-integration"
import { applyEstimatedSbcBounds, calculateStandardEstimatedSbc, STANDARD_SBC_POLICY } from "./sbc"
import { addDecimals, compareDecimals, DECIMAL_POLICY } from "./money"
import { STANDARD_CONVENTIONS } from "./simulation-conventions"
import type { StandardEstimatedSbcResult, StandardSbcContext, StandardSbcInput } from "./sbc-contracts"

const context = standardSbcContext2026()
const ReferenceDecimal = Decimal.clone({ precision: 100 })
function input(overrides: Partial<StandardSbcInput> = {}): StandardSbcInput {
  return {
    profileId: STANDARD_CONVENTIONS.id, area: "general-zone", grossPeriodSalary: "15000.00",
    periodicity: "monthly", referenceDate: "2026-02-01",
    benefits: { annualBonusDays: "15", annualVacationDays: "12", vacationPremiumPercent: "25" }, ...overrides,
  }
}
function successful(request: unknown, ctx = context) {
  const result = calculateStandardEstimatedSbc(request, ctx)
  expect(result.status).toBe("estimated")
  if (result.status !== "estimated") throw new Error(JSON.stringify(result.issues))
  return result
}
function expectFailure(result: StandardEstimatedSbcResult, field: string, kind?: string) {
  expect(result.status).not.toBe("estimated")
  expect(result.data).toBeNull()
  expect(result.issues.some(item => item.field === field && (!kind || item.kind === kind))).toBe(true)
}
function quantity(value: string) { return addDecimals(value, "0") }

describe("SBC estándar: oráculos racionales independientes", () => {
  it.each(oracle.cases)("$id: valor estimado, ajuste y condición contractual", sample => {
    const result = successful(input({ grossPeriodSalary: sample.grossPeriodSalary, referenceDate: sample.referenceDate, benefits: sample.benefits }))
    const { integration, sbc, limits, contractualMinimumCheck } = result.data
    expect(sbc.estimatedSbc).toBe(sample.expected.sbc)
    expect(limits.lower).toBe(sample.expected.lower)
    expect(limits.upper).toBe(sample.expected.upper)
    expect(sbc.relation).toBe(sample.expected.relation)
    expect(sbc.limitApplied).toBe(sample.expected.limitApplied)
    expect(sbc.rounding.changed).toBe(sample.expected.roundingChanged)
    expect(contractualMinimumCheck.relation).toBe(sample.expected.contractRelation)
    const expectedRaw = new ReferenceDecimal(sample.expected.sdi)
    const tolerance = ReferenceDecimal.max(expectedRaw.abs(), "1").times("1e-47")
    expect(new ReferenceDecimal(integration.theoreticalSdi.internal.value).minus(expectedRaw).abs().lte(tolerance)).toBe(true)
    expect(compareDecimals(sbc.estimatedSbc, limits.lower)).not.toBe(-1)
    expect(compareDecimals(sbc.estimatedSbc, limits.upper)).not.toBe(1)
    expect(contractualMinimumCheck.declaredGrossUnchanged).toBe(sample.grossPeriodSalary)
    expect(result.warnings.some(warning => warning.code === "CONTRACTUAL_DAILY_SALARY_BELOW_GENERAL_MINIMUM")).toBe(sample.expected.contractRelation === "below-general-minimum")
  })

  it("conserva la integración del Hito 2D.1 y no sustituye el SDI por la base limitada", () => {
    const request = input({ grossPeriodSalary: "300000.00" })
    const { area: _area, ...integrationInput } = request
    const original = calculateStandardSalaryIntegration(integrationInput, standardIntegrationContext2026())
    const result = successful(request)
    expect(result.data.integration).toEqual(original.data)
    expect(result.data.integration.theoreticalSdi.presentation.amount).toBe("10493.15")
    expect(result.data.sbc.estimatedSbc).toBe("2932.75")
    expect(result.data.integration.applicableSbc).toBeNull()
    expect(result.data.sbcNature).toBe("estimated-not-registered")
  })

  it("distingue salario bajo el mínimo de necesidad de piso en SBC", () => {
    const floorCase = successful(input({ grossPeriodSalary: "9000.00" }))
    expect(floorCase.data.integration.dailySalary.internal.value).toBe("300")
    expect(floorCase.data.sbc.limitApplied).toBe("lower")
    expect(floorCase.data.sbc.limitReason).toBe("minimum-daily-wage-floor")
    const noFloorCase = successful(input({ grossPeriodSalary: "9150.00" }))
    expect(noFloorCase.data.integration.dailySalary.internal.value).toBe("305")
    expect(noFloorCase.data.sbc.limitApplied).toBe("none")
    expect(noFloorCase.data.sbc.estimatedSbc).toBe("320.04")
    for (const result of [floorCase, noFloorCase]) {
      expect(result.data.contractualMinimumCheck.relation).toBe("below-general-minimum")
      expect(result.data.contractualMinimumCheck.contractSalaryModified).toBe(false)
      expect(result.warnings.some(warning => warning.code === "CONTRACTUAL_DAILY_SALARY_BELOW_GENERAL_MINIMUM")).toBe(true)
    }
  })

  it("compara el contrato con el diario interno, no con 315.04 mostrado", () => {
    const result = successful(input({ grossPeriodSalary: "9451.19" }))
    expect(result.data.integration.dailySalary.presentation.amount).toBe("315.04")
    expect(result.data.contractualMinimumCheck.relation).toBe("below-general-minimum")
    expect(result.data.sbc.estimatedSbc).toBe("330.58")
    expect(result.data.sbc.limitApplied).toBe("none")
  })

  it.each([
    ["2026-01-01", "113.14", 2025, "2828.50"],
    ["2026-01-31", "113.14", 2025, "2828.50"],
    ["2026-02-01", "117.31", 2026, "2932.75"],
    ["2026-12-31", "117.31", 2026, "2932.75"],
  ] as const)("tope vigente en %s procede del paquete, no del año de fecha por sí solo", (date, daily, valueYear, upper) => {
    const result = successful(input({ referenceDate: date, grossPeriodSalary: "300000.00" }))
    expect(result.data.limits).toMatchObject({ umaDaily: daily, umaValueYear: valueYear, upper, ceilingUmaDailyMultiple: "25", ceilingProductExact: true })
    expect(result.data.sbc.estimatedSbc).toBe(upper)
    expect(result.data.referenceDate).toBe(date)
  })

  it("tolera cantidades pequeñas o grandes sin corregir el bruto ni recortar la integración", () => {
    expect(successful(input({ grossPeriodSalary: "0.01" })).data.sbc.estimatedSbc).toBe("315.04")
    const large = successful(input({ grossPeriodSalary: "99999999999999999999.99" }))
    expect(large.data.sbc.estimatedSbc).toBe("2932.75")
    expect(large.data.integration.normalized.grossPeriodSalary).toBe("99999999999999999999.99")
    expect(compareDecimals(large.data.integration.theoreticalSdi.internal.value, "2932.75")).toBe(1)
  })
})

describe("orden de límites y redondeo", () => {
  it.each([
    ["315.039", "315.04", "lower", false],
    ["315.04", "315.04", "none", false],
    ["315.041", "315.04", "none", true],
    ["524.665", "524.67", "none", true],
    ["2828.499", "2828.50", "none", true],
    ["2828.50", "2828.50", "none", false],
    ["2828.501", "2828.50", "upper", false],
  ])("SDI interno %s: limitar antes de determinar centavos", (raw, expected, adjustment, changed) => {
    const result = applyEstimatedSbcBounds(quantity(raw), "315.04", "2828.50")
    expect(result.estimatedSbc).toBe(expected)
    expect(result.limitApplied).toBe(adjustment)
    expect(result.rounding.changed).toBe(changed)
    expect(result.rounding.verifiedWithinLimits).toBe(true)
    expect(result.internalSdi.value).toBe(quantity(raw).value)
  })

  it("no inventa un redondeo de límites fuera de la rejilla de centavos", () => {
    expect(() => applyEstimatedSbcBounds(quantity("500"), "315.041", "2828.50")).toThrow()
    expect(() => applyEstimatedSbcBounds(quantity("500"), "315.04", "2828.501")).toThrow()
    expect(() => applyEstimatedSbcBounds(quantity("500"), "500.00", "315.04")).toThrow()
    expect(() => applyEstimatedSbcBounds(quantity("0"), "315.04", "2828.50")).toThrow()
    expect(() => applyEstimatedSbcBounds({ ...quantity("500"), precision: 2 }, "315.04", "2828.50")).toThrow()
  })

  it("traza delta y redondeo como motivos separados", () => {
    const floor = applyEstimatedSbcBounds(quantity("300"), "315.04", "2828.50")
    expect(floor.limitDifference).toMatchObject({ value: "15.04", exact: true })
    const capped = applyEstimatedSbcBounds(quantity("3000"), "315.04", "2828.50")
    expect(capped.limitDifference.value).toBe("-171.5")
    const rounded = applyEstimatedSbcBounds(quantity("524.665"), "315.04", "2828.50")
    expect(rounded.limitDifference.value).toBe("0")
    expect(rounded.rounding.before).toBe("524.665")
    expect(rounded.rounding.after).toBe("524.67")
  })
})

describe("alcance, datos y vigencias de SBC", () => {
  it.each([undefined, null, "", "  "])("requiere zona explícita (%j)", area => {
    expectFailure(calculateStandardEstimatedSbc({ ...input(), area }, context), "area", "missing-data")
  })

  it.each(["northern-border-zone", "Baja California", "Chihuahua", "professional-zone", "GENERAL"])("no soporta ni infiere zona %s", area => {
    const result = calculateStandardEstimatedSbc({ ...input(), area }, context)
    expect(result.status).toBe("not-supported")
    expectFailure(result, "area", "unsupported-scenario")
  })

  it("no acepta estado para resolver municipios de ZLFN ni otras modalidades", () => {
    expectFailure(calculateStandardEstimatedSbc({ ...input(), state: "Baja California" }, context), "request", "unsupported-scenario")
    expectFailure(calculateStandardEstimatedSbc(input({ profileId: "calendar-context" }), context), "profileId", "unsupported-scenario")
    expectFailure(calculateStandardEstimatedSbc({ ...input(), operation: "net-to-gross" }, context), "request", "unsupported-scenario")
    expectFailure(calculateStandardEstimatedSbc({ ...input(), area: 1 }, context), "area", "invalid-format")
  })

  it("no sustituye prestaciones incompletas ni fechas inválidas o sin cobertura", () => {
    expectFailure(calculateStandardEstimatedSbc(input({ benefits: { ...input().benefits, annualBonusDays: "" } }), context), "benefits.annualBonusDays", "missing-data")
    expectFailure(calculateStandardEstimatedSbc(input({ referenceDate: "2026-02-29" }), context), "referenceDate", "invalid-format")
    for (const date of ["2025-12-31", "2027-01-01"]) {
      expectFailure(calculateStandardEstimatedSbc(input({ referenceDate: date }), context), "referenceDate", "unsupported-scenario")
    }
  })

  it.each(["uma", "minimumWages", "imssConstants"] as const)("rechaza serie ausente %s", key => {
    expectFailure(calculateStandardEstimatedSbc(input(), { ...context, [key]: [] }), "parameters")
  })

  it.each(["pending-review", "rejected"] as const)("rechaza fuente de límites %s", validation => {
    const ctx: StandardSbcContext = { ...context, uma: context.uma.map(set => ({ ...set, validation })) }
    expectFailure(calculateStandardEstimatedSbc(input(), ctx), "parameters", "parameter-data")
  })

  it("no aproxima un hueco o solapamiento de UMA ni una serie incompatible", () => {
    for (const through of ["2026-01-30", "2026-02-01"]) {
      const ctx: StandardSbcContext = { ...context, uma: context.uma.map((set, index) => index === 0 ? { ...set, effectiveThrough: through } : set) }
      expectFailure(calculateStandardEstimatedSbc(input({ referenceDate: "2026-01-15" }), ctx), "parameters", "parameter-data")
    }
    const ctx: StandardSbcContext = { ...context, minimumWages: context.minimumWages.map(set => ({ ...set, kind: "uma" })) }
    expectFailure(calculateStandardEstimatedSbc(input(), ctx), "parameters", "parameter-data")
  })

  it("rechaza límites inválidos y referencias monetarias incorrectas", () => {
    const invalidMultiplier: StandardSbcContext = { ...context, imssConstants: context.imssConstants.map(set => ({ ...set, data: { ...set.data, sbcCeilingUmaDailyMultiple: "0" } })) }
    expectFailure(calculateStandardEstimatedSbc(input(), invalidMultiplier), "parameters", "parameter-data")
    const invalidFloor: StandardSbcContext = { ...context, minimumWages: context.minimumWages.map(set => ({ ...set, data: { ...set.data, general: { ...set.data.general, daily: "315.041" } } })) }
    expectFailure(calculateStandardEstimatedSbc(input(), invalidFloor), "parameters", "parameter-data")
    const invalidUma: StandardSbcContext = { ...context, uma: context.uma.map(set => ({ ...set, data: { ...set.data, daily: "0" } })) }
    expectFailure(calculateStandardEstimatedSbc(input(), invalidUma), "parameters", "parameter-data")
    const invalidUmaYear: StandardSbcContext = { ...context, uma: context.uma.map(set => ({ ...set, data: { ...set.data, valueYear: 2028 } })) }
    expectFailure(calculateStandardEstimatedSbc(input(), invalidUmaYear), "parameters", "parameter-data")
  })

  it("obtiene el múltiplo desde el contexto versionado, sin un 25 duplicado en la fórmula", () => {
    // Synthetic context for dependency verification only; not a legal 2026 rate.
    const ctx: StandardSbcContext = { ...context, imssConstants: context.imssConstants.map(set => ({ ...set, data: { ...set.data, sbcCeilingUmaDailyMultiple: "20" } })) }
    const result = successful(input({ grossPeriodSalary: "300000.00" }), ctx)
    expect(result.data.limits.upper).toBe("2346.20")
    expect(result.data.limits.ceilingUmaDailyMultiple).toBe("20")
    expect(result.data.sbc.estimatedSbc).toBe("2346.20")
  })

  it("trazabilidad, estimación y ausencia de homologación están identificadas", () => {
    const result = successful(input())
    expect(result.data.parameterSetIds).toContain("mx-uma-2026")
    expect(result.data.parameterSetIds).toContain("mx-minimum-wages-2026")
    expect(result.data.parameterSetIds).toContain("mx-imss-worker-constants-2026")
    expect(result.data.sources.some(source => source.locator.includes("85"))).toBe(true)
    expect(result.data.sources.some(source => source.locator.includes("Transitorio Tercero"))).toBe(true)
    expect(result.data.policyVersion).toBe(STANDARD_SBC_POLICY.id)
    expect(result.data.precisionPolicy).toBe(DECIMAL_POLICY.id)
    expect(result.data.suaEquivalence).toBe("not-validated")
    expect(result.data.contpaqiEquivalence).toBe("not-validated")
    expect(Object.isFrozen(result.data.sbc.rounding)).toBe(true)
    expect(result.data).not.toHaveProperty("imss")
    expect(result.data).not.toHaveProperty("isr")
  })

  it("no modifica datos ni configuración global, y no exige series de ISR o subsidio", () => {
    const request = Object.freeze(input({ benefits: Object.freeze(input().benefits) }))
    const before = JSON.stringify(request)
    const withoutTax = { ...FISCAL_PARAMETERS_2026, isrTariffs: [], subsidy: [] }
    const precision = Decimal.precision
    const rounding = Decimal.rounding
    try {
      Decimal.set({ precision: 3, rounding: Decimal.ROUND_DOWN })
      const result = successful(request, standardSbcContext2026(withoutTax))
      expect(result.data.sbc.estimatedSbc).toBe("524.66")
      expect(Decimal.precision).toBe(3)
      expect(Decimal.rounding).toBe(Decimal.ROUND_DOWN)
    } finally { Decimal.set({ precision, rounding }) }
    expect(JSON.stringify(request)).toBe(before)
  })
})
