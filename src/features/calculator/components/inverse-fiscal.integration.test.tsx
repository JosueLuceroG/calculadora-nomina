import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { calculateStandardEstimatedNetToGross } from "../../../domain/payroll/net-to-gross"
import type { StandardNetToGrossInput } from "../../../domain/payroll/net-to-gross-contracts"
import { standardGrossToNetContext2026 } from "../../../infrastructure/fiscal/2026"
import { createCalculationController } from "../calculation-controller"
import { createFiscalAdapter, presentInverseFiscalResult, type FiscalPresentation, type MinimumDeclaration } from "../fiscal-adapter"
import { createInitialForm, type CaptureForm } from "../form"
import { ResultsSection } from "./results-section"

const declaration: MinimumDeclaration = { kind: "only-general-minimum-assumed-for-reference-month", referenceMonth: "2026-02", noOtherSalaryPayments: true, acknowledgement: "explicit-standard-simulation-assumption-not-payroll-verification" }
function capture(patch: Partial<CaptureForm> = {}) {
  return { form: { ...createInitialForm(), mode: "net-to-gross" as const, amount: "13202.64", period: "monthly" as const, effectiveDate: "2026-02-01", bonusDays: "15", vacationDays: "12", vacationPremium: "25", ...patch }, area: "general-zone" as const }
}
function render(presentation: FiscalPresentation) {
  return renderToStaticMarkup(<ResultsSection mode="net-to-gross" period="monthly" presentation={presentation} />)
}
async function scoped(patch: Partial<CaptureForm>, searchOptions: StandardNetToGrossInput["searchOptions"], scenario?: MinimumDeclaration) {
  const prepared = createFiscalAdapter().prepare(capture(patch), scenario)
  if (!prepared.ok || prepared.prepared.mode !== "net-to-gross") throw new Error("Captura inválida")
  const report = await calculateStandardEstimatedNetToGross({ ...prepared.prepared.input, searchOptions }, standardGrossToNetContext2026())
  const presentation = presentInverseFiscalResult(report, prepared.prepared.input.referenceDate)
  return { report, presentation, html: render(presentation) }
}

// Oráculos numéricos deterministas; los límites de tiempo reales tienen su suite propia.
beforeEach(() => vi.spyOn(performance, "now").mockReturnValue(0))
afterEach(() => vi.restoreAllMocks())

describe("React + controlador/adaptador + inverso real", () => {
  it.each([
    ["weekly", "3076.67", ["3499.99", "3500.00"]],
    ["monthly", "10500.00", ["11093.07", "11714.44"]],
    ["fortnightly", "6592.87", ["7500.00"]],
  ] as const)("%s: objetivo %s, cifras y alternativas del motor", async (period, amount, roots) => {
    const controller = createCalculationController()
    try {
      const job = controller.submit(capture({ amount, period }))
      expect(controller.getState().phase).toBe("calculating")
      const state = await job.completion
      const presentation = state.outcome!.presentation
      const html = render(presentation)
      expect(presentation.inverse?.alternatives.map(c => c.gross)).toEqual(roots)
      expect(presentation.values).toMatchObject({ grossSalary: roots[0], netSalary: amount })
      expect(html).toContain("Bruto mínimo demostrado")
      expect(html).toContain("Bruto mínimo demostrado en el dominio analizado")
      expect(html).toContain('data-inverse="difference">$ 0.00')
      expect(html).toContain('aria-label="Brutos exactos verificados"')
      expect(html).not.toMatch(/<details[^>]*open/)
      expect(html).not.toContain('id="minimum-month-ack"')
      expect(html).not.toContain("DEMO")
      if (roots.length > 1) expect(html).not.toContain("Unicidad de la coincidencia exacta demostrada")
    } finally { controller.dispose() }
  }, 20000)

  it("aproximación real conserva bruto, neto obtenido y diferencia negativa; ausencia solo en dominio", async () => {
    const { html, presentation } = await scoped({ period: "fortnightly", amount: "5557.04" }, { grossRange: { from: "6216.15", to: "6216.16" } })
    expect(presentation.inverse).toMatchObject({ match: "approximate", recommendedGross: "6216.15", obtainedNet: "5557.03", difference: "-0.01", noExactMatchProven: true })
    expect(html).toContain("Bruto aproximado")
    expect(html).toContain('data-inverse="target">$ 5,557.04')
    expect(html).toContain('data-inverse="obtained">$ 5,557.03')
    expect(html).toContain('data-inverse="difference">−$ 0.01')
    expect(html).toContain("Ausencia de coincidencia exacta demostrada únicamente dentro del dominio analizado")
    expect(html).not.toContain("Bruto mínimo en el dominio")
    expect(html).not.toContain("lucide-check")
  })
  it("diferencia positiva tampoco se sustituye por el objetivo", async () => {
    const { html, presentation } = await scoped({ amount: "13202.63" }, { grossRange: { from: "15000.00", to: "15000.00" } })
    expect(presentation.inverse?.difference).toBe("0.01")
    expect(html).toContain('data-inverse="difference">+$ 0.01')
    expect(html).toContain('data-inverse="obtained">$ 13,202.64')
  })
  it("búsqueda limitada retiene candidato verificado sin inferir unicidad", async () => {
    const { html, presentation } = await scoped({}, { grossRange: { from: "15000.00", to: "50000.00" }, maxEvaluations: 3 })
    expect(presentation.inverse).toMatchObject({ match: "exact", coverage: "limited", recommendedGross: "15000.00", uniquenessProven: false, stopReason: "evaluation-budget" })
    expect(html).toContain('data-result-state="limited"')
    expect(html).toContain("Búsqueda limitada")
    expect(html).toContain('class="primary-amount" aria-label="$ 15,000.00 MXN"')
    expect(html).toContain("no es una cancelación voluntaria")
    expect(html).not.toContain("Unicidad de la coincidencia exacta demostrada")
    expect(html).not.toContain("Ausencia de coincidencia exacta demostrada")
  })
  it("presupuesto sin candidato mantiene desconocidos, no afirma inexistencia", async () => {
    const { html, presentation } = await scoped({ amount: "1.00" }, { maxEvaluations: 1 })
    expect(presentation.inverse?.recommendedGross).toBeNull()
    expect(html.match(/aria-label="Sin resultado"/g)).toHaveLength(4)
    expect(html).toContain("no se ha demostrado ausencia de solución")
    expect(html).not.toContain("lucide-check")
    expect(html).not.toContain("Ausencia de coincidencia exacta demostrada")
  })
  it("mínimo irresuelto puede conservar un candidato ordinario exacto sin llamarlo mínimo", async () => {
    const { html, presentation } = await scoped({ amount: "9451.20" }, undefined)
    expect(presentation.inverse).toMatchObject({ match: "exact", minimumProven: false, coverage: "fiscally-incomplete" })
    expect(presentation.values.netSalary).toBe("9451.20")
    expect(html).toContain("Bruto encontrado")
    expect(html).toContain("puede existir un bruto menor")
    expect(html).toContain("Solo se aplicará al candidato de salario mínimo exacto")
    expect(html).not.toContain("Sin confirmarla no se determina la retención ni el neto")
    expect(html).not.toContain("lucide-check")
  }, 20000)
  it("hipótesis explícita reejecuta y muestra mínimo condicional sin sumar subsidio", async () => {
    const controller = createCalculationController()
    try {
      await controller.submit(capture({ amount: "9451.20" })).completion
      const before = controller.getState()
      expect(before.outcome?.presentation.confirmation?.basis).toBe("inverse-relevant-unresolved-point")
      expect(controller.confirmMinimum(before.requestId - 1, declaration).accepted).toBe(false)
      const state = await controller.confirmMinimum(before.requestId, declaration).completion
      const html = render(state.outcome!.presentation)
      expect(state.outcome!.presentation.values).toMatchObject({ grossSalary: "9451.20", netSalary: "9451.20", isr: "0.00", workerImss: "0.00" })
      expect(html).toContain("Hipótesis mensual aplicada al mínimo")
      expect(html).toContain('data-subsidy="determined">$ 535.65')
      expect(html).toContain('data-subsidy="applied">$ 0.00')
      expect(html).not.toContain('id="minimum-month-ack"')
    } finally { controller.dispose() }
  }, 20000)
  it("un diagnóstico de mínimo fuera de cobertura no ofrece hipótesis", async () => {
    const { report, html } = await scoped({}, { grossRange: { from: "15000.00", to: "15000.00" } })
    expect(report.fiscalDiagnostics.some(d => d.codes.includes("MONTHLY_MINIMUM_CONFIRMATION_REQUIRED"))).toBe(true)
    expect(html).not.toContain('id="minimum-month-ack"')
  })
  it("solo un mínimo irresuelto, sin candidato, no rellena bruto, neto ni deducciones", async () => {
    const { html, presentation } = await scoped({ amount: "9451.20" }, { grossRange: { from: "9451.20", to: "9451.20" } })
    expect(presentation.inverse).toMatchObject({ match: "none", coverage: "fiscally-incomplete" })
    expect(html.match(/aria-label="Sin resultado"/g)).toHaveLength(4)
    expect(html).toContain('id="minimum-month-ack"')
    expect(html).toContain("Bruto no determinado")
  })
  it("fecha fuera de cobertura no se convierte en bruto válido", async () => {
    const controller = createCalculationController()
    try {
      const state = await controller.submit(capture({ effectiveDate: "2027-02-01" })).completion
      const html = render(state.outcome!.presentation)
      expect(html).toContain("Escenario no soportado")
      expect(html.match(/aria-label="Sin resultado"/g)).toHaveLength(4)
      expect(html).not.toContain("lucide-check")
    } finally { controller.dispose() }
  })
  it.each(["calculating", "cancelled", "error"] as const)("%s no conserva cifras de una presentación anterior", async phase => {
    const { presentation } = await scoped({}, { grossRange: { from: "15000.00", to: "15000.00" } })
    const html = renderToStaticMarkup(<ResultsSection mode="net-to-gross" phase={phase} presentation={presentation} error={phase === "error" ? "No se pudo completar el cálculo." : undefined} onCancel={() => {}} />)
    expect(html).toContain(`data-result-state="${phase}"`)
    expect(html.match(/aria-label="Sin resultado"/g)).toHaveLength(4)
    expect(html).not.toContain("15,000.00")
    if (phase === "calculating") {
      expect(html).toContain('aria-busy="true"')
      expect(html).toContain("Cancelar")
      expect(html).not.toContain("%")
    }
  })
})
