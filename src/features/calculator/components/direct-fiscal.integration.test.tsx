import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { createCalculationController } from "../calculation-controller"
import { createFiscalAdapter } from "../fiscal-adapter"
import { createInitialForm, type CaptureForm } from "../form"
import { standardGrossToNetContext2026 } from "../../../infrastructure/fiscal/2026"
import { CaptureSection } from "./capture-section"
import { ResultsSection } from "./results-section"

function capture(patch: Partial<CaptureForm> = {}) {
  return { form: { ...createInitialForm(), mode: "gross-to-net" as const, amount: "15000.00", period: "monthly" as const, effectiveDate: "2026-02-01", bonusDays: "15", vacationDays: "12", vacationPremium: "25", ...patch }, area: "general-zone" as const }
}
function renderReal(patch: Partial<CaptureForm> = {}) {
  const controller = createCalculationController()
  const c = capture(patch)
  controller.submit(c)
  const state = controller.getState()
  const presentation = state.outcome?.presentation
  if (!presentation) throw new Error("Reporte no recibido")
  const html = renderToStaticMarkup(<ResultsSection mode={c.form.mode} period={c.form.period} presentation={presentation} requestId={state.requestId} />)
  controller.dispose()
  return { html, presentation }
}

describe("React + adaptador/controlador + motor directo real", () => {
  it.each([
    ["monthly", "15000.00", true, "$ 1,402.82", "$ 394.54", "$ 13,202.64"],
    ["monthly", "15000.00", false, "$ 1,402.82", "$ 0.00", "$ 13,597.18"],
    ["weekly", "3500.00", true, "$ 331.27", "$ 92.06", "$ 3,076.67"],
    ["fortnightly", "7500.00", true, "$ 709.86", "$ 197.27", "$ 6,592.87"],
  ] as const)("caso real %s, %s, IMSS %s", (period, amount, includeImss, isr, imss, net) => {
    const { html } = renderReal({ period, amount, includeImss })
    expect(html).toContain('data-result-state="estimated"')
    expect(html).toContain(`class="primary-amount" aria-label="${net} MXN"`)
    expect(html).toContain(isr)
    expect(html).toContain(imss)
    expect(html).toContain("Estimación estándar 2026")
    expect(html).toContain("SBC estimado (no registrado)")
    expect(html).toContain("No aplica · perfil fijo")
    expect(html).not.toContain("DEMO")
    expect(html).not.toContain("Valores ficticios")
  })
  it("mínimo se mantiene bloqueado hasta confirmar expresamente y después usa importes reales", () => {
    const controller = createCalculationController()
    controller.submit(capture({ amount: "9451.20" }))
    let state = controller.getState()
    let presentation = state.outcome?.presentation
    if (!presentation) throw new Error("Falta reporte")
    const onConfirm = vi.fn()
    const html = renderToStaticMarkup(<ResultsSection mode="gross-to-net" presentation={presentation} requestId={state.requestId} onConfirmMinimum={onConfirm} />)
    expect(html).toContain('data-result-state="blocked"')
    expect(html).toContain('class="primary-amount" aria-label="Sin resultado"')
    expect(html).toContain('id="minimum-month-ack"')
    expect(html).not.toMatch(/id="minimum-month-ack"[^>]*checked=""/)
    expect(html).toContain("hipótesis de simulación")
    expect(onConfirm).not.toHaveBeenCalled()
    controller.confirmMinimum(state.requestId, { kind: "only-general-minimum-assumed-for-reference-month", referenceMonth: "2026-02", noOtherSalaryPayments: true, acknowledgement: "explicit-standard-simulation-assumption-not-payroll-verification" })
    state = controller.getState(); presentation = state.outcome?.presentation
    const confirmed = renderToStaticMarkup(<ResultsSection mode="gross-to-net" presentation={presentation} requestId={state.requestId} />)
    expect(confirmed).toContain('class="primary-amount" aria-label="$ 9,451.20 MXN"')
    expect(confirmed).toContain('data-subsidy="determined">$ 535.65')
    expect(confirmed).toContain('data-subsidy="applied">$ 0.00')
    expect(confirmed).not.toContain('id="minimum-month-ack"')
    controller.dispose()
  })
  it("salario inferior no se presenta como neto cero ni muestra check de éxito", () => {
    const { html, presentation } = renderReal({ amount: "9451.19" })
    expect(presentation.values.netSalary).toBeNull()
    expect(html).toContain("salario contractual inferior al mínimo")
    expect(html).toContain('aria-describedby="result-message"')
    expect(html).not.toContain("lucide-check")
    expect(html).toContain('class="primary-amount" aria-label="Sin resultado"')
  })
  it("parámetros ausentes no rellenan desconocidos con cero", () => {
    const controller = createCalculationController(createFiscalAdapter({ ...standardGrossToNetContext2026(), subsidy: [] }))
    controller.submit(capture())
    const presentation = controller.getState().outcome?.presentation
    const html = renderToStaticMarkup(<ResultsSection mode="gross-to-net" presentation={presentation} />)
    expect(html).toContain('data-result-state="blocked"')
    expect(html).toContain("Faltan datos")
    expect(presentation?.values.netSalary).toBeNull()
    expect(presentation?.subsidy.determined).toBeNull()
    controller.dispose()
  })
  it("el modo inverso no presenta un reporte directo anterior aunque se le suministre", () => {
    const { presentation } = renderReal()
    const html = renderToStaticMarkup(<ResultsSection mode="net-to-gross" presentation={presentation} />)
    expect(html).toContain("Sin resultados calculados.")
    expect(html.match(/aria-label="Sin resultado"/g)).toHaveLength(4)
    expect(html).not.toContain("13,202.64")
    expect(html).not.toContain('data-subsidy="determined"')
  })
  it("captura con plantilla editable y perfil general fijo, sin opciones ficticias", () => {
    const html = renderToStaticMarkup(<CaptureSection form={createInitialForm()} onFormChange={() => {}} onValidated={() => {}} />)
    expect(html).toContain('id="state"')
    expect(html).toContain('data-salary-area="general-zone"')
    expect(html).not.toContain("Zona salarial: ")
    expect(html).not.toContain('id="worker-type"')
    expect(html).not.toContain("Opciones avanzadas")
    expect(html).toContain("Plantilla editable; no acredita las prestaciones de cada trabajador.")
    expect(html).toContain('id="bonus-days"')
    expect(html).toContain('id="vacation-days"')
    const expanded = renderToStaticMarkup(<CaptureSection form={createInitialForm()} externalErrors={{ effectiveDate: "Fecha requerida" }} onFormChange={() => {}} onValidated={() => {}} />)
    expect(expanded).toContain("Zona salarial: ")
    expect(expanded).toContain("General</strong>")
  })
  it("un error inesperado borra presentación monetaria y conserva Editar como salida de la vista", () => {
    const { presentation } = renderReal()
    const html = renderToStaticMarkup(<ResultsSection mode="gross-to-net" presentation={presentation} error="No se pudo completar el cálculo." />)
    expect(html).toContain('data-result-state="error"')
    expect(html.match(/aria-label="Sin resultado"/g)).toHaveLength(4)
    expect(html).not.toContain("13,202.64")
  })
})
