import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { createInitialForm, type CaptureForm } from "../form"
import { CaptureSummary } from "./capture-summary"

function capturedForm(overrides: Partial<CaptureForm> = {}): CaptureForm {
  return { ...createInitialForm(), amount: "15000.00", period: "monthly", effectiveDate: "2026-10-12", ...overrides }
}

describe("barra de captura, sin resultados fiscales", () => {
  it.each([
    ["net-to-gross", "Neto deseado capturado"],
    ["gross-to-net", "Bruto ofrecido capturado"],
  ] as const)("identifica el importe como entrada en %s", (mode, label) => {
    const html = renderToStaticMarkup(<CaptureSummary form={capturedForm({ mode })} onEdit={() => {}} />)
    expect(html).toContain(label)
    expect(html).toContain("$ 15,000.00")
    expect(html).toContain("Captura conservada")
    expect(html).toContain("Editar datos")
    expect(html).not.toContain("Salario bruto requerido")
    expect(html).not.toContain('data-result-state=')
  })

  it("preserva fecha civil y prestaciones sin convertirlas ni redondearlas", () => {
    const form = capturedForm({ effectiveDate: "2024-02-29", bonusDays: "15.5", vacationDays: "12", vacationPremium: "25.50" })
    const html = renderToStaticMarkup(<CaptureSummary form={form} onEdit={() => {}} />)
    expect(html).toContain("2024-02-29")
    expect(html).toContain("15.5 días")
    expect(html).toContain("25.50%")
    expect(form.vacationPremium).toBe("25.50")
  })

  it("no reemplaza prestaciones omitidas por cero ni aplica cuotas IMSS", () => {
    const html = renderToStaticMarkup(<CaptureSummary form={capturedForm({ includeImss: false, bonusDays: "", vacationDays: "", vacationPremium: "" })} onEdit={() => {}} />)
    expect(html).toContain("Incluir IMSS</dt><dd>No</dd>")
    expect(html.match(/sin capturar/g)).toHaveLength(3)
    expect(html).not.toContain("Cuota obrera")
  })
})
