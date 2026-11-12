import Decimal from "decimal.js"
import { describe, expect, it } from "vitest"
import oracle from "../../tests/fixtures/salary-integration.expected.json"
import { FISCAL_PARAMETERS_2026, standardIntegrationContext2026 } from "../../infrastructure/fiscal/2026"
import { DECIMAL_POLICY, decimalText, multiplyDecimals, presentMoney } from "./money"
import { STANDARD_CONVENTIONS } from "./simulation-conventions"
import { calculateContractualDailySalary, calculateFixedIntegrationFactor, calculateStandardSalaryIntegration, calculateTheoreticalSdi } from "./salary-integration"
import { normalizeStandardIntegration } from "./standard-profile-validation"
import type { StandardIntegrationContext, StandardIntegrationInput, StandardSalaryIntegrationResult } from "./standard-integration-contracts"

const context = standardIntegrationContext2026()
const ReferenceDecimal = Decimal.clone({ precision: 100, rounding: Decimal.ROUND_HALF_UP })

function input(overrides: Partial<StandardIntegrationInput> = {}): StandardIntegrationInput {
  return {
    profileId: STANDARD_CONVENTIONS.id, grossPeriodSalary: "15000.00", periodicity: "monthly", referenceDate: "2026-10-13",
    benefits: { annualBonusDays: "15", annualVacationDays: "12", vacationPremiumPercent: "25" }, ...overrides,
  }
}
function successful(request: unknown, ctx = context) {
  const result = calculateStandardSalaryIntegration(request, ctx)
  expect(result.status).toBe("estimated")
  if (result.status !== "estimated") throw new Error(JSON.stringify(result.issues))
  return result
}
function expectIssue(result: StandardSalaryIntegrationResult, field: string, kind: string) {
  expect(result.status).not.toBe("estimated")
  expect(result.data).toBeNull()
  expect(result.issues.some(item => item.field === field && item.kind === kind)).toBe(true)
}
function nearIndependentReference(actual: string, reference: string) {
  const expected = new ReferenceDecimal(reference)
  // Three guard digits accommodate the documented finite arithmetic sequence.
  // Oracles are rational reference results at 80 digits, not engine-generated.
  const tolerance = ReferenceDecimal.max(expected.abs(), "1").times("0.00000000000000000000000000000000000000000000001")
  expect(new ReferenceDecimal(actual).minus(expected).abs().lte(tolerance)).toBe(true)
}

describe("integración teórica: oráculos independientes", () => {
  it.each(oracle.cases)("$id: diario, FI y SDI sin redondeo a centavos intermedio", sample => {
    const request = { ...input(), ...sample }
    // The oracle's id/expected are not part of the production input contract.
    const result = successful(input({ grossPeriodSalary: request.grossPeriodSalary, periodicity: request.periodicity as StandardIntegrationInput["periodicity"], benefits: request.benefits }))
    nearIndependentReference(result.data.dailySalary.internal.value, sample.expected.daily)
    nearIndependentReference(result.data.factor.value, sample.expected.factor)
    nearIndependentReference(result.data.theoreticalSdi.internal.value, sample.expected.sdi)
    expect(result.data.dailySalary.presentation.amount).toBe(sample.expected.dailyShown)
    expect(result.data.theoreticalSdi.presentation.amount).toBe(sample.expected.sdiShown)
    expect(result.data.applicableSbc).toBeNull()
    expect(result.data.sbcStatus).toBe("not-calculated")
    expect(result.data.precisionPolicy).toBe(DECIMAL_POLICY.id)
  })

  it("normaliza 25% a 0.25 y no cuenta de nuevo los días de vacaciones", () => {
    const result = successful(input())
    expect(result.data.normalized.benefits.vacationPremiumProportion).toMatchObject({ value: "0.25", exact: true })
    expect(result.data.equivalentAnnualBenefitDays).toMatchObject({ value: "18", exact: true })
    expect(result.data.factor.value).toMatch(/^1\.04931506849315068493/)
    expect(result.data.factor.exact).toBe(false)
  })

  it("usar el diario mostrado produciría otro centavo; el módulo usa el interno", () => {
    const result = successful(input({ periodicity: "weekly", grossPeriodSalary: "1234.56" }))
    expect(result.data.dailySalary.presentation.amount).toBe("176.37")
    expect(result.data.theoreticalSdi.presentation.amount).toBe("185.06")
    const wronglyRounded = presentMoney(multiplyDecimals("176.37", result.data.factor.value).value)
    expect(wronglyRounded.amount).toBe("185.07")
    expect(result.data.dailySalary.internal.exact).toBe(false)
    expect(result.data.theoreticalSdi.internal.exact).toBe(false)
  })

  it("separa un resultado finito exacto de cantidades periódicas limitadas por precisión", () => {
    const result = successful(input({ periodicity: "weekly", grossPeriodSalary: "3500", benefits: { annualBonusDays: "73", annualVacationDays: "0", vacationPremiumPercent: "25" } }))
    expect(result.data.factor).toMatchObject({ value: "1.2", exact: true })
    expect(result.data.theoreticalSdi.internal).toMatchObject({ value: "600", exact: true })
    expect(result.data.theoreticalSdi.presentation.rounded).toBe(false)
    expect(result.warnings.map(item => item.code)).toEqual(["VACATIONS_BELOW_FIRST_ANNUAL_MINIMUM"])
  })

  it("no aplica pisos de salario ni tope de 25 UMA, ni consulta IVA/ISR/IMSS", () => {
    const withoutOtherData = { ...FISCAL_PARAMETERS_2026, uma: [], minimumWages: [], imssConstants: [], isrTariffs: [], subsidy: [] }
    const ctx = standardIntegrationContext2026(withoutOtherData)
    expect(successful(input({ grossPeriodSalary: "0.01" }), ctx).data.dailySalary.presentation.amount).toBe("0.00")
    expect(successful(input({ grossPeriodSalary: "300000.00" }), ctx).data.theoreticalSdi.presentation.amount).toBe("10493.15")
  })

  it("no modifica la configuración global de Decimal ni la captura original", () => {
    const request = Object.freeze(input({ benefits: Object.freeze(input().benefits) }))
    const saved = JSON.stringify(request)
    const precision = Decimal.precision
    const rounding = Decimal.rounding
    try {
      Decimal.set({ precision: 4, rounding: Decimal.ROUND_DOWN })
      const result = successful(request)
      expect(result.data.theoreticalSdi.presentation.amount).toBe("524.66")
      expect(Decimal.precision).toBe(4)
      expect(Decimal.rounding).toBe(Decimal.ROUND_DOWN)
    } finally { Decimal.set({ precision, rounding }) }
    expect(JSON.stringify(request)).toBe(saved)
  })
})

describe("validación y normalización de captura laboral", () => {
  it("normaliza sin completar valores ni inventar cotización, y conserva fuentes", () => {
    const request = input({ grossPeriodSalary: "00015000.00", benefits: { annualBonusDays: "015.50", annualVacationDays: "14", vacationPremiumPercent: "25.50" } })
    const result = normalizeStandardIntegration(request, context)
    expect(result.status).toBe("valid")
    if (result.status !== "valid") throw new Error("Captura inválida")
    expect(result.data.grossPeriodSalary).toBe("15000.00")
    expect(result.data.benefits.annualBonusDays).toBe("15.5")
    expect(result.data.benefits.vacationPremiumProportion.value).toBe("0.255")
    expect(result.data.contractualDivisor).toBe("30")
    expect(result.data.actualCotizedDays).toBeNull()
    expect(result.data.parameterSetIds).toEqual(["mx-contractual-divisors", "mx-labor-benefit-minima-2026"])
    expect(result.data.sources.some(source => source.url.endsWith("LFT.pdf"))).toBe(true)
    expect(Object.isFrozen(result.data.benefits)).toBe(true)
    expect(request.benefits.vacationPremiumPercent).toBe("25.50")
  })

  it.each([undefined, null, {}, { profileId: STANDARD_CONVENTIONS.id }])("los datos ausentes no generan SDI ni valores predeterminados (%j)", request => {
    const result = calculateStandardSalaryIntegration(request, context)
    expect(result.status).toBe("not-determinable")
    expect(result.data).toBeNull()
    expect(result.issues.some(item => item.kind === "missing-data")).toBe(true)
  })

  it.each(["annualBonusDays", "annualVacationDays", "vacationPremiumPercent"] as const)("rechaza prestación ausente %s", field => {
    const benefits = { ...input().benefits, [field]: "" }
    expectIssue(calculateStandardSalaryIntegration(input({ benefits }), context), `benefits.${field}`, "missing-data")
  })

  it.each(["25.", ".25", "25%", "2e1", "NaN", " 25 ", "+25", "25,5"])("distingue prima inválida %s de ausencia", value => {
    expectIssue(calculateStandardSalaryIntegration(input({ benefits: { ...input().benefits, vacationPremiumPercent: value } }), context), "benefits.vacationPremiumPercent", "invalid-format")
  })

  it.each(["annualBonusDays", "annualVacationDays", "vacationPremiumPercent"] as const)("distingue prestación negativa %s", field => {
    expectIssue(calculateStandardSalaryIntegration(input({ benefits: { ...input().benefits, [field]: "-1" } }), context), `benefits.${field}`, "invalid-value")
  })

  it.each(["annualBonusDays", "annualVacationDays"] as const)("no interpreta texto ni cantidades incompletas en %s", field => {
    for (const value of ["abc", "12.", "1,5"]) expectIssue(calculateStandardSalaryIntegration(input({ benefits: { ...input().benefits, [field]: value } }), context), `benefits.${field}`, "invalid-format")
  })

  it.each(["0", "-1.00", "-0.00"])("salario %s no es bruto positivo", grossPeriodSalary => {
    expectIssue(calculateStandardSalaryIntegration(input({ grossPeriodSalary }), context), "grossPeriodSalary", "invalid-value")
  })

  it.each(["1.234", "1e5", "1,000.00", "100."])("salario %s es un error de formato", grossPeriodSalary => {
    expectIssue(calculateStandardSalaryIntegration(input({ grossPeriodSalary }), context), "grossPeriodSalary", "invalid-format")
  })

  it("no acepta importes monetarios Number ni fuera del rango técnico", () => {
    expectIssue(calculateStandardSalaryIntegration({ ...input(), grossPeriodSalary: 15000 }, context), "grossPeriodSalary", "invalid-format")
    expectIssue(calculateStandardSalaryIntegration(input({ grossPeriodSalary: "100000000000000000000" }), context), "grossPeriodSalary", "technical-range")
  })

  it("conserva prestaciones inferiores declaradas y avisa sin imponer mínimos", () => {
    const request = input({ benefits: { annualBonusDays: "10", annualVacationDays: "6", vacationPremiumPercent: "20" } })
    const result = successful(request)
    expect(result.warnings.map(item => item.code)).toEqual(["BONUS_BELOW_LEGAL_MINIMUM", "VACATIONS_BELOW_FIRST_ANNUAL_MINIMUM", "PREMIUM_BELOW_LEGAL_MINIMUM"])
    expect(result.data.normalized.benefits.annualBonusDays).toBe("10")
    expect(result.data.equivalentAnnualBenefitDays.value).toBe("11.2")
    expect(result.warnings[1].sourceReference).toBe("LFT-76")
    expect(result.warnings[1].message).toContain("primer derecho anual")
    expect(Object.isFrozen(result.warnings[0])).toBe(true)
  })

  it("cero explícito no se confunde con dato ausente", () => {
    const result = successful(input({ benefits: { annualBonusDays: "0", annualVacationDays: "0", vacationPremiumPercent: "0" } }))
    expect(result.warnings).toHaveLength(3)
    expect(result.data.factor).toMatchObject({ value: "1", exact: true })
    expect(result.data.theoreticalSdi.presentation.amount).toBe("500.00")
  })

  it.each(["daily", "catorcenal", "annual"])("no soporta periodicidad %s", periodicity => {
    const result = calculateStandardSalaryIntegration({ ...input(), periodicity }, context)
    expect(result.status).toBe("not-supported")
    expectIssue(result, "periodicity", "unsupported-scenario")
  })

  it.each(["calendar-context", "variable", "standard-estimate-2026-v2"])("no aproxima perfil %s al estándar", profileId => {
    const result = calculateStandardSalaryIntegration(input({ profileId }), context)
    expect(result.status).toBe("not-supported")
    expectIssue(result, "profileId", "unsupported-scenario")
  })

  it("no obtiene bruto desde neto ni incorpora variables", () => {
    for (const extra of [{ operation: "net-to-gross" }, { netPeriodSalary: "15000" }, { bonusPayments: "100" }, { actualCotizedDays: "31" }]) {
      expectIssue(calculateStandardSalaryIntegration({ ...input(), ...extra }, context), "request", "unsupported-scenario")
    }
    expectIssue(calculateStandardSalaryIntegration(input({ benefits: { ...input().benefits, commission: "100" } as StandardIntegrationInput["benefits"] }), context), "benefits", "unsupported-scenario")
  })

  it("no infiere antigüedad ni acepta que se fuerce una valoración no declarada", () => {
    const result = calculateStandardSalaryIntegration(input({ benefits: { ...input().benefits, seniorityAssessment: "inferred" } as unknown as StandardIntegrationInput["benefits"] }), context)
    expectIssue(result, "benefits", "unsupported-scenario")
  })

  it("fecha inválida es distinta de fecha o perfil no soportado", () => {
    expectIssue(calculateStandardSalaryIntegration(input({ referenceDate: "2026-02-29" }), context), "referenceDate", "invalid-format")
    expectIssue(calculateStandardSalaryIntegration(input({ referenceDate: "2027-01-01" }), context), "referenceDate", "unsupported-scenario")
    expectIssue(calculateStandardSalaryIntegration(input({ referenceDate: "" }), context), "referenceDate", "missing-data")
  })
})

describe("parámetros y funciones puras del módulo", () => {
  it("usa los divisores versionados 7/15/30 y rechaza otro divisor", () => {
    expect(calculateContractualDailySalary("3500", "7")).toMatchObject({ value: "500", exact: true })
    expect(calculateContractualDailySalary("7500", "15").value).toBe("500")
    expect(calculateContractualDailySalary("15000", "30").value).toBe("500")
    expect(() => calculateContractualDailySalary("15000", "30.4")).toThrow()
    expect(() => calculateContractualDailySalary("0", "30")).toThrow()
  })

  it("no devuelve calculados con mínimos pendientes ni parámetros ausentes", () => {
    const ctx: StandardIntegrationContext = { ...context, laborBenefitMinima: context.laborBenefitMinima.map(set => ({ ...set, validation: "pending-review" })) }
    expectIssue(calculateStandardSalaryIntegration(input(), ctx), "parameters", "parameter-data")
    expectIssue(calculateStandardSalaryIntegration(input(), { ...context, contractualDivisors: [] }), "parameters", "parameter-data")
    expectIssue(calculateStandardSalaryIntegration(input(), undefined as unknown as StandardIntegrationContext), "parameters", "missing-data")
  })

  it("detecta divisor ajeno al contrato y cobertura incorrecta", () => {
    const ctx: StandardIntegrationContext = { ...context, contractualDivisors: context.contractualDivisors.map(set => ({ ...set, data: { ...set.data, monthly: "31" } })) }
    expectIssue(calculateStandardSalaryIntegration(input(), ctx), "parameters", "parameter-data")
    const missingEnd: StandardIntegrationContext = { ...context, laborBenefitMinima: context.laborBenefitMinima.map(set => ({ ...set, effectiveThrough: "2026-06-30" })) }
    expectIssue(calculateStandardSalaryIntegration(input(), missingEnd), "parameters", "parameter-data")
  })

  it("rechaza rangos técnicos de cálculo sin recortar el SDI", () => {
    const result = calculateStandardSalaryIntegration(input({ benefits: { annualBonusDays: "99999999999999999999", annualVacationDays: "99999999999999999999", vacationPremiumPercent: "99999999999999999999" } }), context)
    expectIssue(result, "calculation", "technical-range")
  })

  it("las funciones no admiten factor/diario inválidos ni fingida precisión", () => {
    expect(calculateFixedIntegrationFactor("0", "0", "0")).toMatchObject({ value: "1", exact: true })
    expect(() => calculateFixedIntegrationFactor("-1", "12", "25")).toThrow()
    const factor = calculateFixedIntegrationFactor("15", "12", "25")
    expect(() => calculateTheoreticalSdi({ value: decimalText("0"), exact: true, precision: 50 }, factor)).toThrow()
    expect(() => calculateTheoreticalSdi({ value: decimalText("500"), exact: true, precision: 2 }, factor)).toThrow()
    expect(() => calculateTheoreticalSdi({ value: decimalText("500"), exact: true, precision: 50 }, { value: decimalText("0.5"), exact: true, precision: 50 })).toThrow()
  })
})
