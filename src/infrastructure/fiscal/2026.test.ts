import { describe, expect, it } from "vitest"
import expectedCsv from "../../tests/fixtures/isr-2026.expected.csv?raw"
import type { FiscalRegistry, IsrTariff, PayrollPeriodicity } from "../../domain/payroll/contracts"
import { FiscalFoundationError } from "../../domain/payroll/errors"
import { validateIsrTariff } from "../../domain/payroll/parameters"
import { STANDARD_CONVENTIONS } from "../../domain/payroll/simulation-conventions"
import { FISCAL_PARAMETERS_2026, selectFiscalParameters2026, validateFiscalRegistry2026 } from "./2026"

const oracle = expectedCsv.split(/\r?\n/).filter(line => line && !line.startsWith("#")).slice(1).map(line => {
  const [periodicity, lower, upper, fixedFee, ratePercent] = line.split(",")
  return { periodicity, row: { lower, upper: upper || null, fixedFee, ratePercent } }
})

describe("33 filas oficiales, cotejo independiente completo", () => {
  it("el oráculo DOF contiene exactamente las 33 filas", () => {
    expect(oracle).toHaveLength(33)
    expect(FISCAL_PARAMETERS_2026.isrTariffs.reduce((total, set) => total + set.data.rows.length, 0)).toBe(33)
  })

  it.each(["weekly", "fortnightly", "monthly"] as const)("%s coincide en LI, LS, cuota y tasa con DOF", periodicity => {
    const set = selectFiscalParameters2026("2026-10-13", periodicity).isrTariff
    const expected = oracle.filter(item => item.periodicity === periodicity).map(item => item.row)
    expect(expected).toHaveLength(11)
    expect(set.data.rows).toEqual(expected)
    expect(() => validateIsrTariff(set.data)).not.toThrow()
    expect(set.sources.map(source => source.authority)).toEqual(["SAT", "DOF"])
    expect(set.validationScope).toBe("source-data-only")
  })

  it("detecta huecos, solapamientos, tasas inválidas y tramo abierto prematuro", () => {
    const original = FISCAL_PARAMETERS_2026.isrTariffs[0].data
    for (const patch of [
      { lower: "194.48" }, { lower: "194.46" }, { upper: null }, { ratePercent: "0" },
    ]) {
      const altered: IsrTariff = { ...original, rows: original.rows.map((row, index) => index === 1 ? { ...row, ...patch } : row) }
      expect(() => validateIsrTariff(altered)).toThrow(FiscalFoundationError)
    }
    expect(() => validateIsrTariff({ ...original, rows: original.rows.slice(1) })).toThrow()
    expect(() => validateIsrTariff({ ...original, rows: original.rows.map((row, index) => index === 10 ? { ...row, upper: "999999.99" } : row) })).toThrow()
  })
})

describe("datos y vigencias 2026", () => {
  it("incorpora referencias mínimas anuales sin inferir vacaciones por antigüedad", () => {
    const set = selectFiscalParameters2026("2026-10-13", "monthly").laborBenefitMinima
    expect(set.data).toEqual({ annualBonusDays: "15", firstAnnualVacationDays: "12", vacationPremiumPercent: "25", vacationSeniorityReference: "LFT-76-not-inferred" })
    expect(set.sources[0].currentTextAsOf).toBe("2026-05-14")
    expect(set.sources[0].locator).toContain("87")
    expect(set.validationScope).toBe("source-data-only")
  })
  it.each([
    ["2026-01-01", "113.14", "3439.46", "41273.52", "0.1559", 2025],
    ["2026-01-31", "113.14", "3439.46", "41273.52", "0.1559", 2025],
    ["2026-02-01", "117.31", "3566.22", "42794.64", "0.1502", 2026],
    ["2026-12-31", "117.31", "3566.22", "42794.64", "0.1502", 2026],
  ] as const)("selecciona datos oficiales en %s", (date, daily, monthly, annual, proportion, valueYear) => {
    const selected = selectFiscalParameters2026(date, "monthly")
    expect(selected.uma.data).toEqual({ daily, monthly, annual, valueYear, unit: "MXN" })
    expect(selected.subsidy.data).toMatchObject({ rateProportion: proportion, umaMonthlyValueYear: valueYear, monthlyIncomeLimit: "11492.66", submonthlyDivisor: "30.4", monthlyQuotaDefinition: "official-uma-monthly-times-rate" })
  })

  it("incluye ambos mínimos y no confunde expresión mensual con divisor salarial", () => {
    const selected = selectFiscalParameters2026("2026-01-01", "weekly")
    expect(selected.minimumWages.data.general).toEqual({ daily: "315.04", publishedMonthlyReference: "9582.47" })
    expect(selected.minimumWages.data.northernBorder).toEqual({ daily: "440.87", publishedMonthlyReference: "13409.80" })
    expect(selected.minimumWages.data.monthlyExpressionReference).toBe("daily-times-365-divided-by-12")
    expect(selected.contractualDivisors.data).toEqual({ weekly: "7", fortnightly: "15", monthly: "30" })
  })

  it("incorpora constantes obreras, sin ejecutar cuotas ni absorción", () => {
    const data = selectFiscalParameters2026("2026-10-13", "monthly").imssConstants.data
    expect(data.workerRates).toEqual({
      "pensioner-medical": "0.00375", "cash-benefits": "0.0025", "disability-life": "0.00625",
      "unemployment-old-age": "0.01125", "excess-medical": "0.004",
    })
    expect(data.sbcCeilingUmaDailyMultiple).toBe("25")
    expect(data.excessThresholdUmaDailyMultiple).toBe("3")
    expect(data.workerAbsorptionReference).toBe("LSS-36")
  })

  it("no convierte los considerandos en cantidad fija de subsidio", () => {
    const text = JSON.stringify(FISCAL_PARAMETERS_2026.subsidy)
    expect(text).not.toContain("536.22")
    expect(text).not.toContain("monthlyQuotaAmount")
    expect(FISCAL_PARAMETERS_2026.subsidy[0].data.formulaText).toContain("15.59%")
    expect(FISCAL_PARAMETERS_2026.subsidy[1].data.formulaText).toContain("15.02%")
  })

  it("no selecciona otro ejercicio o periodicidad automáticamente", () => {
    expect(() => selectFiscalParameters2026("2025-12-31", "monthly")).toThrow()
    expect(() => selectFiscalParameters2026("2027-01-01", "monthly")).toThrow()
    expect(() => selectFiscalParameters2026("2026-01-01", "daily" as PayrollPeriodicity)).toThrow()
  })

  it("el paquete es inmutable y las convenciones no se mezclan con datos normativos", () => {
    expect(Object.isFrozen(FISCAL_PARAMETERS_2026)).toBe(true)
    expect(Object.isFrozen(FISCAL_PARAMETERS_2026.isrTariffs[0].data.rows[0])).toBe(true)
    expect(Object.isFrozen(FISCAL_PARAMETERS_2026.uma[0].sources[0])).toBe(true)
    expect(STANDARD_CONVENTIONS.nature).toBe("simulation-convention")
    expect(STANDARD_CONVENTIONS.activation).toBe("not-activated")
    expect(STANDARD_CONVENTIONS.suaEquivalence).toBe("not-validated")
    expect(JSON.stringify(FISCAL_PARAMETERS_2026)).not.toContain("referenceCotizedDays")
  })
})

describe("rechazo de paquetes incompletos o no validados", () => {
  it("rechaza una tarifa ausente aun cuando otra pueda cubrir la fecha", () => {
    const registry: FiscalRegistry = { ...FISCAL_PARAMETERS_2026, isrTariffs: FISCAL_PARAMETERS_2026.isrTariffs.filter(set => set.key !== "weekly") }
    expect(() => selectFiscalParameters2026("2026-10-13", "monthly", registry)).toThrow()
  })

  it.each(["pending-review", "rejected"] as const)("rechaza parámetros %s", validation => {
    const registry: FiscalRegistry = { ...FISCAL_PARAMETERS_2026, uma: FISCAL_PARAMETERS_2026.uma.map(set => ({ ...set, validation })) }
    expect(() => validateFiscalRegistry2026(registry)).toThrow()
  })

  it("detecta hueco y solapamiento de UMA", () => {
    for (const through of ["2026-01-30", "2026-02-01"]) {
      const registry: FiscalRegistry = { ...FISCAL_PARAMETERS_2026, uma: FISCAL_PARAMETERS_2026.uma.map((set, index) => index === 0 ? { ...set, effectiveThrough: through } : set) }
      expect(() => selectFiscalParameters2026("2026-01-15", "monthly", registry)).toThrow()
    }
  })

  it("detecta referencia a UMA equivocada en enero sin calcular el subsidio", () => {
    const registry: FiscalRegistry = { ...FISCAL_PARAMETERS_2026, subsidy: FISCAL_PARAMETERS_2026.subsidy.map((set, index) => index === 0 ? { ...set, data: { ...set.data, umaMonthlyValueYear: 2026 } } : set) }
    expect(() => validateFiscalRegistry2026(registry)).toThrow()
  })

  it("comprueba compatibilidad en la fecha solicitada, no solo al inicio de un conjunto", () => {
    const [january, february] = FISCAL_PARAMETERS_2026.uma
    const registry: FiscalRegistry = { ...FISCAL_PARAMETERS_2026, uma: [
      january,
      { ...february, effectiveThrough: "2026-06-30" },
      { ...february, id: "synthetic-incompatible-uma", effectiveFrom: "2026-07-01", data: { ...february.data, valueYear: 2025 } },
    ] }
    expect(() => selectFiscalParameters2026("2026-07-01", "monthly", registry)).toThrow()
  })

  it("no acepta otra familia de parámetros ni unidades monetarias inconsistentes", () => {
    const wrongKind: FiscalRegistry = { ...FISCAL_PARAMETERS_2026, minimumWages: FISCAL_PARAMETERS_2026.minimumWages.map(set => ({ ...set, kind: "uma" })) }
    expect(() => validateFiscalRegistry2026(wrongKind)).toThrow()
    const invalidUma: FiscalRegistry = { ...FISCAL_PARAMETERS_2026, uma: FISCAL_PARAMETERS_2026.uma.map(set => ({ ...set, data: { ...set.data, daily: "0" } })) }
    expect(() => validateFiscalRegistry2026(invalidUma)).toThrow()
  })
})
