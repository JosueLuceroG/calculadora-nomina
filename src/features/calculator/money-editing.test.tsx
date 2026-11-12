import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { canonicalMoneyDraft, formatMoneyDraft, isUnambiguousMoneyPaste, mapMoneySelection, MoneyEditHistory, type MoneyEditSnapshot } from "./money-editing"
import { createInitialForm, supportedCaptureProfile, type CaptureForm } from "./form"
import { validateCapture } from "./validation"
import { createFiscalAdapter } from "./fiscal-adapter"
import { createCalculationController } from "./calculation-controller"
import { CaptureSection } from "./components/capture-section"

describe("5B.3: representación exacta, sin aritmética monetaria", () => {
  it.each([
    ["3500", "3,500"], ["15000", "15,000"], ["15000.50", "15,000.50"],
    ["1234567.89", "1,234,567.89"], ["0.50", "0.50"], ["15000.00", "15,000.00"],
    ["123456789012345678901234567890.01", "123,456,789,012,345,678,901,234,567,890.01"],
    ["00015000.50", "00,015,000.50"], ["", ""], ["0", "0"], ["0.", "0."],
    ["1500.", "1,500."], ["1500.5", "1,500.5"], [".", "."],
    ["15000.500", "15,000.500"], ["-15000", "-15000"], ["1e3", "1e3"],
    ["1,50", "1,50"], ["1.000,50", "1.000,50"], ["$15000", "$15000"],
  ])("%s se muestra como %s sin perder caracteres", (canonical, visual) => {
    expect(formatMoneyDraft(canonical)).toBe(visual)
    expect(canonicalMoneyDraft(visual)).toBe(canonical)
  })
  it.each(["1,50", "1.000,50", "12,34,567", ",500", "1500,000", "15,000 MXN"])("no elimina comas ambiguas de %s", text => {
    expect(canonicalMoneyDraft(text)).toBe(text)
    expect(isUnambiguousMoneyPaste(text)).toBe(false)
  })
  it.each([
    ["15,000.50", "15000.50", "15,000.50"],
    ["1,234,567.89", "1234567.89", "1,234,567.89"],
    ["0.50", "0.50", "0.50"], ["15000", "15000", "15,000"],
    ["15,000.500", "15000.500", "15,000.500"],
  ])("pegado inequívoco %s conserva texto y precisión", (text, canonical, formatted) => {
    expect(isUnambiguousMoneyPaste(text)).toBe(true)
    expect(canonicalMoneyDraft(text)).toBe(canonical)
    expect(formatMoneyDraft(canonical)).toBe(formatted)
  })
  it("escritura progresiva conserva punto y ceros finales", () => {
    expect(["1", "15", "150", "1500", "15000", "15000.", "15000.5", "15000.50"].map(formatMoneyDraft))
      .toEqual(["1", "15", "150", "1,500", "15,000", "15,000.", "15,000.5", "15,000.50"])
  })
  it.each([
    ["3500", "3,500", 4, 4, 5, 5],
    ["913,500", "913,500", 1, 1, 1, 1],
    ["3,4500", "34,500", 3, 3, 2, 2],
    [",500", "500", 0, 0, 0, 0],
    ["3,00", "300", 2, 2, 1, 1],
    ["12345.00", "12,345.00", 1, 5, 1, 6],
    ["1,234", "1,234", 1, 2, 1, 2],
  ] as const)("remapea selección %s → %s", (raw, formatted, start, end, nextStart, nextEnd) => {
    expect(mapMoneySelection(raw, formatted, { start, end, direction: "backward" })).toEqual({ start: nextStart, end: nextEnd, direction: "backward" })
  })
  it.each(["", "0", "0.", "1500.", "15000.500", "-15000", "1e3", "1,50", "1.000,50", "$15000"])("el validador existente sigue rechazando %s sin sustituirlo", amount => {
    const canonical = canonicalMoneyDraft(amount)
    expect(validateCapture({ ...createInitialForm(), amount: canonical }).amount).toBeTruthy()
    expect(canonical).toBe(amount)
  })
  it("SSR comparte el campo premium, MXN y prestaciones sin máscara", () => {
    const html = renderToStaticMarkup(<CaptureSection form={{ ...createInitialForm(), amount: "15000.50", bonusDays: "1500", vacationPremium: "25.00" }} onFormChange={() => {}} onValidated={() => {}} />)
    expect(html).toContain('value="15,000.50"')
    expect(html).toContain('value="1500"')
    expect(html).toContain('value="25.00"')
    expect(html).toContain('>MXN</span>')
    expect(html).toContain('id="salary"')
  })
  it("el error visual reutiliza el validador sin pedir retirar las comas automáticas", () => {
    const form = { ...createInitialForm(), amount: "15000.500" }
    const errors = validateCapture(form)
    const html = renderToStaticMarkup(<CaptureSection form={form} externalErrors={errors} onFormChange={() => {}} onValidated={() => {}} />)
    expect(html).toContain("máximo dos decimales.")
    expect(html).not.toContain("sin separadores de miles")
    expect(html).toContain('aria-describedby="salary-error"')
    expect(html).toContain('value="15,000.500"')
    expect(errors.amount).toContain("sin separadores de miles")
  })
})

describe("historial local de edición", () => {
  const state = (text: string, start = text.length, end = start): MoneyEditSnapshot => ({ text, start, end, direction: "none" })
  it("restaura texto, selección y dirección; rehacer no recalcula ni redondea", () => {
    const history = new MoneyEditHistory()
    const before = { ...state("15,000.50", 0, 2), direction: "backward" as const }
    const after = state("25,000.50", 1)
    history.record(before, after)
    expect(history.undo(after)).toEqual(before)
    expect(history.redo(before)).toEqual(after)
  })
  it("una edición nueva invalida rehacer; clear inicia una pila vacía", () => {
    const history = new MoneyEditHistory()
    history.record(state(""), state("1"))
    history.undo(state("1"))
    history.record(state(""), state("2"))
    expect(history.redo(state("2"))).toBeUndefined()
    history.clear()
    expect(history.undo(state("2"))).toBeUndefined()
  })
})

describe("máscara → captura canónica → motores reales", () => {
  function capture(visual: string): { form: CaptureForm; area: "general-zone" } {
    return { form: { ...createInitialForm(), mode: "gross-to-net" as const, amount: canonicalMoneyDraft(visual), period: "monthly" as const, effectiveDate: "2026-02-01" }, area: supportedCaptureProfile.area }
  }
  it.each([
    ["15,000", "monthly", true, "15000.00", "13202.64"],
    ["15,000.00", "monthly", false, "15000.00", "13597.18"],
    ["3,500", "weekly", true, "3500.00", "3076.67"],
  ] as const)("%s %s IMSS %s no cambia un centavo", (visual, period, includeImss, input, net) => {
    const request = capture(visual)
    request.form.period = period
    request.form.includeImss = includeImss
    const real = createFiscalAdapter()
    const direct = vi.fn(real.direct)
    const controller = createCalculationController({ ...real, direct })
    controller.submit(request)
    expect(direct.mock.calls[0][0].input.grossPeriodSalary).toBe(input)
    expect(controller.getState().snapshot?.form.amount).toBe(visual.replaceAll(",", ""))
    expect(controller.getState().outcome?.presentation.values.netSalary).toBe(net)
    controller.dispose()
  })
  it("15000.50 llega exactamente, preserva ceros de captura y no admite agrupadores en el adaptador", () => {
    const request = capture("00,015,000.50")
    const adapter = createFiscalAdapter()
    const result = adapter.prepare(request)
    if (!result.ok || result.prepared.mode !== "gross-to-net") throw new Error("Preparación fallida")
    expect(result.prepared.input.grossPeriodSalary).toBe("15000.50")
    expect(result.prepared.snapshot.form.amount).toBe("00015000.50")
    expect(adapter.prepare({ ...request, form: { ...request.form, amount: "15,000.50" } }).ok).toBe(false)
  })
  it("inverso real recibe 13202.64 y verifica 15000.00", async () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(0)
    const real = createFiscalAdapter()
    const inverse = vi.fn(real.inverse)
    const controller = createCalculationController({ ...real, inverse })
    try {
      const request = capture("13,202.64")
      const result = await controller.submit({ ...request, form: { ...request.form, mode: "net-to-gross" } }).completion
      expect(inverse.mock.calls[0][0].input.targetNet).toBe("13202.64")
      expect(result.outcome?.presentation.values.grossSalary).toBe("15000.00")
      expect(result.outcome?.presentation.values.netSalary).toBe("13202.64")
    } finally { clock.mockRestore(); controller.dispose() }
  }, 20000)
})
