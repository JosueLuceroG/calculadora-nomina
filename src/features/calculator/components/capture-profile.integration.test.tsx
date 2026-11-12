import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { createInitialForm, initialBenefits, supportedCaptureProfile, type CaptureForm } from "../form"
import { createFiscalAdapter } from "../fiscal-adapter"
import { createCalculationController } from "../calculation-controller"
import { validateFiscalCapture } from "../validation"
import { CaptureSection } from "./capture-section"

function capture(patch: Partial<CaptureForm> = {}) {
  return { form: { ...createInitialForm(), mode: "gross-to-net" as const, amount: "15000.00", period: "monthly" as const, effectiveDate: "2026-02-01", ...patch }, area: supportedCaptureProfile.area }
}
function run(patch: Partial<CaptureForm> = {}) {
  const controller = createCalculationController()
  const request = capture(patch)
  controller.submit(request)
  const state = controller.getState()
  controller.dispose()
  return { state, request }
}

describe("5B.2: plantilla explícita + controlador/adaptador + motores reales", () => {
  it("cada formulario nuevo contiene 15/12/25 y no comparte una captura mutable", () => {
    const first = createInitialForm()
    expect(first).toMatchObject({ ...initialBenefits, amount: "", includeImss: true })
    first.bonusDays = "30"
    first.vacationDays = ""
    first.includeImss = false
    expect(createInitialForm()).toMatchObject({ bonusDays: "15", vacationDays: "12", vacationPremium: "25", includeImss: true })
    expect(supportedCaptureProfile).toEqual({ area: "general-zone", areaLabel: "General" })
  })
  it.each([
    ["bonusDays", "18", "1.0575"],
    ["vacationDays", "14", "1.0507"],
    ["vacationPremium", "35", "1.0526"],
  ] as const)("modificar %s se transmite y cambia la integración real", (field, value, factor) => {
    const { state } = run({ [field]: value })
    expect(state.outcome?.presentation.values.integrationFactor).toBe(factor)
    expect(state.snapshot?.form[field]).toBe(value)
    expect(state.phase).toBe("result")
  })
  it.each(["bonusDays", "vacationDays", "vacationPremium"] as const)("borrar %s bloquea también con IMSS No, sin restaurar defaults", field => {
    for (const includeImss of [true, false]) {
      const real = createFiscalAdapter()
      const direct = vi.fn(real.direct)
      const controller = createCalculationController({ ...real, direct })
      const request = capture({ [field]: "", includeImss })
      expect(controller.submit(request).accepted).toBe(false)
      expect(controller.getState().captureIssues).toContainEqual(expect.objectContaining({ field, code: "REQUIRED_BENEFIT" }))
      expect(controller.getState().snapshot?.form[field]).toBe("")
      expect(request.form[field]).toBe("")
      expect(direct).not.toHaveBeenCalled()
      controller.dispose()
    }
  })
  it.each([
    ["monthly", "15000.00", true, "13202.64"],
    ["monthly", "15000.00", false, "13597.18"],
    ["weekly", "3500.00", true, "3076.67"],
  ] as const)("%s %s, IMSS %s: plantilla real produce neto %s", (period, amount, includeImss, net) => {
    const request = capture({ period, amount, includeImss })
    const adapter = createFiscalAdapter()
    const prepared = adapter.prepare(request)
    if (!prepared.ok || prepared.prepared.mode !== "gross-to-net") throw new Error("No se preparó")
    expect(prepared.prepared.input).toMatchObject({ area: "general-zone", includeWorkerImss: includeImss, benefits: { annualBonusDays: "15", annualVacationDays: "12", vacationPremiumPercent: "25" } })
    const { state } = run({ period, amount, includeImss })
    expect(state.outcome?.presentation.values.netSalary).toBe(net)
  })
  it("inverso real con plantilla conserva candidato mensual 15000.00", async () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(0)
    const controller = createCalculationController()
    try {
      const result = await controller.submit(capture({ mode: "net-to-gross", amount: "13202.64" })).completion
      expect(result.outcome?.presentation.inverse?.alternatives.map(c => c.gross)).toContain("15000.00")
      expect(result.outcome?.presentation.values.netSalary).toBe("13202.64")
    } finally { clock.mockRestore(); controller.dispose() }
  }, 20000)
  it("editar conserva textos personalizados y no calcula hasta el envío explícito", () => {
    const real = createFiscalAdapter()
    const direct = vi.fn(real.direct)
    const controller = createCalculationController({ ...real, direct })
    const request = capture({ amount: "00015000.50", bonusDays: "18.50", vacationDays: "20.25", vacationPremium: "30.50", includeImss: false })
    controller.submit(request)
    expect(direct).toHaveBeenCalledTimes(1)
    controller.edit(request)
    expect(direct).toHaveBeenCalledTimes(1)
    expect(controller.getState().phase).toBe("idle")
    expect(controller.getState().outcome).toBeNull()
    expect(controller.getState().snapshot?.form).toEqual(request.form)
    expect(request.form).toMatchObject({ bonusDays: "18.50", vacationDays: "20.25", vacationPremium: "30.50", amount: "00015000.50", includeImss: false })
    controller.dispose()
  })
  it.each([true, false])("mínimo: absorción LSS 36 conserva prioridad con descuento %s", includeImss => {
    const controller = createCalculationController()
    controller.submit(capture({ amount: "9451.20", includeImss }))
    const first = controller.getState()
    expect(first.outcome?.presentation.confirmation?.referenceMonth).toBe("2026-02")
    controller.confirmMinimum(first.requestId, { kind: "only-general-minimum-assumed-for-reference-month", referenceMonth: "2026-02", noOtherSalaryPayments: true, acknowledgement: "explicit-standard-simulation-assumption-not-payroll-verification" })
    const result = controller.getState().outcome
    if (result?.kind !== "direct") throw new Error("Falta directo")
    expect(result.report.imss.deducted.amount).toBe("0.00")
    expect(result.report.imss.absorbedByEmployer.amount).toBe("235.53")
    expect(result.report.imss.excludedBySimulation.amount).toBe("0.00")
    expect(result.report.net.amount).toBe("9451.20")
    controller.dispose()
  })
  it("desactivar IMSS no regulariza un contrato bajo mínimo", () => {
    const { state } = run({ amount: "9451.19", includeImss: false })
    expect(state.outcome?.presentation.fiscalStatus).toBe("not-supported")
    expect(state.outcome?.presentation.values.netSalary).toBeNull()
  })
  it("frontera fiscal sigue exigiendo zona explícita y motor rechaza norte", () => {
    const adapter = createFiscalAdapter()
    const request = capture()
    expect(adapter.prepare({ ...request, area: "" }).ok).toBe(false)
    const north = adapter.prepare({ ...request, area: "northern-border-zone" })
    if (!north.ok || north.prepared.mode !== "gross-to-net") throw new Error("Falta preparación norte")
    expect(north.prepared.input.area).toBe("northern-border-zone")
    expect(adapter.direct(north.prepared).report.status).toBe("not-supported")
  })
  it("captura presenta perfil fijo, radios accesibles y ayuda sin controles inertes", () => {
    const request = capture({ vacationDays: "" })
    const html = renderToStaticMarkup(<CaptureSection form={request.form} onFormChange={() => {}} onValidated={() => {}} externalErrors={validateFiscalCapture(request.form, request.area)} />)
    expect(html).toContain('data-salary-area="general-zone"')
    expect(html).not.toContain("Opciones avanzadas")
    expect(html).not.toContain('id="worker-type"')
    expect(html).not.toContain("Estímulo del campo")
    expect(html).not.toContain('<select id="state"')
    expect(html).toContain("¿Descontar IMSS al trabajador?")
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('id="imss-method"')
    expect(html).toContain('aria-describedby="vacation-days-error vacation-days-hint"')
    expect(html).toContain("referencia inicial")
  })
})
