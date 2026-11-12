import { describe, expect, it } from "vitest"
import { createInitialForm, type CaptureForm } from "./form"
import { isValidCivilDate, validateCapture, validateFiscalCapture } from "./validation"

function validForm(overrides: Partial<CaptureForm> = {}): CaptureForm {
  return { ...createInitialForm(), amount: "15000.00", period: "weekly", effectiveDate: "2026-10-12", ...overrides }
}

describe("validación de captura, sin reglas fiscales", () => {
  it("identifica los campos obligatorios, sin inventar prestaciones", () => {
    expect(Object.keys(validateCapture(createInitialForm())).sort()).toEqual(["amount", "effectiveDate", "period"])
  })

  it.each(["0", "0.00", "000.00", "-1", "1.234", "1.", ".5", "1,000.00", "1,50", "1e3", "Infinity", "abc", " 1 "])("rechaza importe inválido %s al validar", amount => {
    expect(validateCapture(validForm({ amount })).amount).toBeDefined()
  })

  it.each(["0.01", "1", "1.2", "0001.00", "9007199254740993123456789.99"])("acepta importe positivo exacto %s sin convertirlo a Number", amount => {
    const form = validForm({ amount })
    expect(validateCapture(form)).toEqual({})
    expect(form.amount).toBe(amount)
  })

  it.each(["weekly", "fortnightly", "monthly"] as const)("acepta periodicidad %s sin reglas de días", period => {
    expect(validateCapture(validForm({ period }))).toEqual({})
  })

  it("rechaza una periodicidad no disponible", () => {
    expect(validateCapture(validForm({ period: "other" as CaptureForm["period"] })).period).toBeDefined()
  })

  it("no impone topes fiscales, precisión fiscal ni prestaciones obligatorias", () => {
    expect(validateCapture(validForm({ bonusDays: "9999.125", vacationDays: "0", vacationPremium: "150.123456" }))).toEqual({})
  })

  it.each(["bonusDays", "vacationDays", "vacationPremium"] as const)("rechaza formato incompleto o negativo en %s", field => {
    for (const value of ["-1", "1.", ".", "abc", "25%", "1,5"]) {
      expect(validateCapture(validForm({ [field]: value }))[field]).toBeDefined()
    }
  })

  it("IMSS y modo no producen ni modifican valores calculados", () => {
    expect(validateCapture(validForm({ mode: "gross-to-net", includeImss: false }))).toEqual({})
  })
})

describe("captura fiscal visual: requisitos explícitos sin alterar el formato base", () => {
  it.each(["gross-to-net", "net-to-gross"] as const)("%s exige prestaciones y zona, incluso sin IMSS", mode => {
    for (const includeImss of [true, false]) {
      const errors = validateFiscalCapture(validForm({ mode, includeImss, bonusDays: "", vacationDays: "", vacationPremium: "" }), "")
      expect(Object.keys(errors).sort()).toEqual(["area", "bonusDays", "vacationDays", "vacationPremium"])
    }
  })
  it("permite ceros y valores inferiores declarados, sin sustituir prestaciones", () => {
    const form = validForm({ mode: "gross-to-net", bonusDays: "0", vacationDays: "0", vacationPremium: "0" })
    expect(validateFiscalCapture(form, "general-zone")).toEqual({})
    expect(form.bonusDays).toBe("0")
  })
  it("no habilita otra zona y exige los mismos datos explícitos en el inverso", () => {
    expect(validateFiscalCapture(validForm({ mode: "gross-to-net" }), "northern-border-zone").area).toBeDefined()
    expect(Object.keys(validateFiscalCapture(validForm({ mode: "net-to-gross", bonusDays: "", vacationDays: "", vacationPremium: "" }), "")).sort()).toEqual(["area", "bonusDays", "vacationDays", "vacationPremium"])
  })
})

describe("fecha civil", () => {
  it.each(["2024-02-29", "2000-02-29", "2026-12-31", "0001-01-01"])("acepta %s", date => {
    expect(isValidCivilDate(date)).toBe(true)
  })

  it.each(["", "2026-02-29", "2100-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-01-00", "0000-01-01", "2026-1-1", "12/10/2026", "2026-10-12T00:00:00Z"])("rechaza %s", date => {
    expect(isValidCivilDate(date)).toBe(false)
    expect(validateCapture(validForm({ effectiveDate: date })).effectiveDate).toBeDefined()
  })
})
