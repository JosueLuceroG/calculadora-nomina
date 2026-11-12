import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createInitialForm, type CaptureForm } from "../form"
import { createFiscalAdapter, presentInverseFiscalResult, type FiscalOutcome, type FiscalPresentation } from "../fiscal-adapter"
import { createCalculationController } from "../calculation-controller"
import { calculateStandardEstimatedNetToGross } from "../../../domain/payroll/net-to-gross"
import type { StandardNetToGrossInput } from "../../../domain/payroll/net-to-gross-contracts"
import { standardGrossToNetContext2026 } from "../../../infrastructure/fiscal/2026"
import { ResultsSection } from "./results-section"
import { auxiliaryDecimal, importantWarnings, inverseStatus } from "./result-presentation"

beforeEach(() => vi.spyOn(performance, "now").mockReturnValue(0))
afterEach(() => vi.restoreAllMocks())
function capture(patch: Partial<CaptureForm> = {}) {
  return { form: { ...createInitialForm(), mode: "gross-to-net" as const, amount: "15000.00", period: "monthly" as const, effectiveDate: "2026-02-01", ...patch }, area: "general-zone" as const }
}
function render(outcome: FiscalOutcome, presentation = outcome.presentation) {
  return renderToStaticMarkup(<ResultsSection mode={outcome.kind === "direct" ? "gross-to-net" : "net-to-gross"} period="monthly" presentation={presentation} report={outcome.report} />)
}
function visible(html: string) { return html.split('<details class="fiscal-insights">')[0] }
function direct(patch: Partial<CaptureForm> = {}) {
  const adapter = createFiscalAdapter(), prepared = adapter.prepare(capture(patch))
  if (!prepared.ok || prepared.prepared.mode !== "gross-to-net") throw new Error("Preparación directa fallida")
  return adapter.direct(prepared.prepared)
}
async function inverse(amount = "13202.64", period: CaptureForm["period"] = "monthly", searchOptions?: StandardNetToGrossInput["searchOptions"]) {
  const adapter = createFiscalAdapter(), prepared = adapter.prepare(capture({ amount, period, mode: "net-to-gross" }))
  if (!prepared.ok || prepared.prepared.mode !== "net-to-gross") throw new Error("Preparación inversa fallida")
  const report = await calculateStandardEstimatedNetToGross({ ...prepared.prepared.input, searchOptions }, standardGrossToNetContext2026())
  return { kind: "inverse" as const, report, presentation: presentInverseFiscalResult(report, "2026-02-01") }
}

describe("5B.4: resultados comprensibles con reportes reales inmutables", () => {
  it.each([
    ["monthly", "15000.00", true, "13202.64"],
    ["monthly", "15000.00", false, "13597.18"],
    ["weekly", "3500.00", true, "3076.67"],
  ] as const)("directo %s %s IMSS %s conserva neto %s y separa componentes", (period, amount, includeImss, net) => {
    const outcome = direct({ period, amount, includeImss }), before = structuredClone(outcome)
    const html = render(outcome), main = visible(html)
    expect(outcome.report.net.amount).toBe(net)
    expect(main).toContain("ISR calculado por tarifa")
    expect(main).toContain("Subsidio aplicado al ISR")
    expect(main).toContain("ISR retenido estimado")
    expect(main).toContain("IMSS calculado (cuota obrera)")
    expect(main).toContain("IMSS realmente descontado")
    expect(main).not.toContain("no homologada con SUA ni CONTPAQi")
    expect(main).not.toContain("no determinado, no cero")
    expect(html.split('<details class="fiscal-insights">')[1]).toContain("sin homologación con SUA/CONTPAQi")
    expect(html.split('<details class="fiscal-insights">')[1]).toContain("no determinado, no cero")
    expect(html).not.toContain("Guardar")
    expect(html).not.toContain("guardado automáticamente")
    expect(outcome).toEqual(before)
  })
  it("IMSS No muestra cuota calculada y descuento cero junto a exclusión simulada visible", () => {
    const outcome = direct({ includeImss: false }), main = visible(render(outcome))
    expect(outcome.report.imss.calculated.amount).toBe("394.54")
    expect(main).toContain("IMSS calculado (cuota obrera)</dt><dd>$ 394.54")
    expect(main).toContain("IMSS realmente descontado</dt><dd>$ 0.00")
    expect(main).toContain("no representa una exención legal")
  })
  it.each([
    ["3076.67", "weekly", ["3499.99", "3500.00"]],
    ["10500.00", "monthly", ["11093.07", "11714.44"]],
    ["13202.64", "monthly", ["15000.00"]],
  ] as const)("inverso %s %s: alternativas verificadas y garantía limitada al dominio", async (amount, period, roots) => {
    const outcome = await inverse(amount, period), html = render(outcome), main = visible(html)
    expect(outcome.report.exactCandidates.map(c => c.gross)).toEqual(roots)
    expect(main).toContain("Neto solicitado")
    expect(main).toContain("Neto realmente obtenido")
    expect(main).toContain("Bruto mínimo demostrado en el dominio analizado")
    expect(main).not.toContain("mínimo global")
    expect(main).not.toContain("Dominio analizado:")
    expect(html).toContain("no fuera de él")
    expect(html).toContain('class="verified-alternatives"')
    expect(html).toContain('class="technical-result-details"')
    expect(html).not.toMatch(/<details[^>]*open/)
    expect(html).not.toContain("Búsqueda, alternativas, supuestos y advertencias")
    if (roots.length > 1) expect(html).not.toContain("Unicidad de la coincidencia exacta demostrada")
  }, 20000)
  it("ISR por tarifa, subsidio e ISR retenido se leen del reporte sin sumar subsidio al neto", async () => {
    const outcome = await inverse("10500.00"), main = visible(render(outcome))
    expect(main).toContain("ISR calculado por tarifa</dt><dd>$ 847.94")
    expect(main).toContain('data-subsidy="applied">$ 535.65')
    expect(main).toContain("ISR retenido estimado</dt><dd>$ 312.29")
    expect(outcome.report.recommendedForwardResult?.net.amount).toBe("10500.00")
    expect(render(outcome)).toContain("no se vuelve a sumar al neto")
  }, 20000)
  it("aproximado real muestra centavo de diferencia y no éxito", async () => {
    const outcome = await inverse("5557.04", "fortnightly", { grossRange: { from: "6216.15", to: "6216.16" } })
    const main = visible(render(outcome))
    expect(main).toContain("Bruto aproximado")
    expect(main).toContain("Aproximado:")
    expect(main).toContain('data-inverse="difference">−$ 0.01')
    expect(main).toContain("no es una coincidencia exacta")
    expect(main).not.toContain("lucide-check")
    expect(main).not.toContain("Bruto mínimo demostrado")
  })
  it("limitado puede demostrar mínimo local sin certificar cobertura completa ni éxito", async () => {
    const outcome = await inverse("13202.64", "monthly", { grossRange: { from: "15000.00", to: "50000.00" }, maxEvaluations: 3 })
    const html = render(outcome), main = visible(html)
    expect(main).toContain('data-result-state="limited"')
    expect(main).toContain("Búsqueda limitada")
    expect(main).toContain("Bruto mínimo demostrado en el dominio analizado")
    expect(main).not.toContain("lucide-check")
    expect(html).toContain("No se afirma que esta lista contenga todas las soluciones posibles")
    expect(outcome.report.coverage.minimumProven).toBe(true)
    expect(outcome.report.coverage.uniquenessProven).toBe(false)
  })
  it("sin candidato no inventa importes ni ausencia de solución", async () => {
    const outcome = await inverse("1.00", "monthly", { maxEvaluations: 1 }), main = visible(render(outcome))
    expect(main).toContain("Resultado no determinable")
    expect(main).toContain("no se ha demostrado ausencia de solución")
    expect(main.match(/aria-label="Sin resultado"/g)).toHaveLength(4)
    expect(main).not.toContain("lucide-check")
    expect(outcome.report.recommended).toBeNull()
  })
  it("condición mensual pendiente permanece fuera de ambos plegables y sin éxito", async () => {
    const outcome = await inverse("9451.20"), main = visible(render(outcome))
    expect(main).toContain("Condición fiscal pendiente")
    expect(main).toContain('id="minimum-month-ack"')
    expect(main).toContain("artículo 96")
    expect(main).toContain("Recalcular con hipótesis")
    expect(main).not.toContain("lucide-check")
    expect(main).not.toContain("Bruto mínimo demostrado")
  }, 20000)
  it("hipótesis confirmada no se convierte en certeza y mantiene absorción LSS 36", () => {
    const controller = createCalculationController()
    controller.submit(capture({ amount: "9451.20", includeImss: false }))
    controller.confirmMinimum(controller.getState().requestId, { kind: "only-general-minimum-assumed-for-reference-month", referenceMonth: "2026-02", noOtherSalaryPayments: true, acknowledgement: "explicit-standard-simulation-assumption-not-payroll-verification" })
    const outcome = controller.getState().outcome!
    const html = render(outcome), main = visible(html)
    expect(main).toContain("hipótesis mensual expresa")
    expect(main).toContain("artículo 36 LSS")
    expect(main).toContain("no representa una exención legal")
    expect(main).not.toContain("lucide-check")
    expect(html).toContain('data-subsidy="determined">$ 535.65')
    expect(main).toContain('data-subsidy="applied">$ 0.00')
    expect(outcome.presentation.values.netSalary).toBe("9451.20")
    controller.dispose()
  })
  it("bajo mínimo y prestaciones inferiores no esconden sus avisos en detalles técnicos", () => {
    const outcome = direct({ amount: "9451.19", bonusDays: "0" }), main = visible(render(outcome))
    for (const issue of outcome.presentation.issues) expect(main).toContain(issue.message)
    for (const warning of importantWarnings(outcome.presentation)) expect(main).toContain(warning.message)
    expect(main).toContain("salario contractual inferior al mínimo")
    expect(main).not.toContain("lucide-check")
  })
  it("una advertencia nueva se trata como importante por defecto", () => {
    const outcome = direct()
    const presentation: FiscalPresentation = { ...outcome.presentation, warnings: [...outcome.presentation.warnings, { code: "FUTURE_CRITICAL_NOTICE", message: "Condición adicional que afecta el resultado." }] }
    const main = visible(render(outcome, presentation))
    expect(main).toContain("Condición adicional que afecta el resultado.")
    expect(main).not.toContain("lucide-check")
  })
  it("sin reporte auxiliar no infiere ISR por tarifa ni cuota calculada", () => {
    const outcome = direct()
    const html = renderToStaticMarkup(<ResultsSection mode="gross-to-net" presentation={outcome.presentation} />)
    expect(html).toContain('ISR calculado por tarifa</dt><dd aria-describedby="result-message"')
    expect(html).toContain('IMSS calculado (cuota obrera)</dt><dd aria-describedby="result-message"')
  })
  it("un motivo crítico adicional no recibe distintivo de éxito ni se oculta", () => {
    const outcome = direct()
    const presentation: FiscalPresentation = { ...outcome.presentation, issues: [{ field: "context", code: "UNRESOLVED_CONTEXT", message: "Contexto adicional pendiente de resolver." }] }
    const main = visible(render(outcome, presentation))
    expect(main).toContain("Contexto adicional pendiente de resolver.")
    expect(main).not.toContain("lucide-check")
  })
  it.each(["calculating", "cancelled", "error"] as const)("%s oculta también reporte técnico anterior y conserva salida de captura", phase => {
    const outcome = direct()
    const html = renderToStaticMarkup(<ResultsSection mode="gross-to-net" presentation={outcome.presentation} report={outcome.report} phase={phase} error={phase === "error" ? "Fallo de prueba" : undefined} />)
    expect(html).not.toContain("13,202.64")
    expect(html).not.toContain("mx-fiscal-2026-source-v3")
    expect(html).not.toContain('class="technical-result-details"')
    expect(html).not.toContain("Guardar")
  })
  it("reporte de otro importe no completa componentes auxiliares", () => {
    const first = direct(), other = direct({ amount: "16000.00" })
    const html = renderToStaticMarkup(<ResultsSection mode="gross-to-net" presentation={first.presentation} report={other.report} />)
    expect(html).not.toContain("16,000.00")
    expect(html).toContain('ISR calculado por tarifa</dt><dd aria-describedby="result-message"')
  })
  it.each([
    [null, null], ["1.0493150684931506849", "1.0493"], ["18.123456789", "18.1235"],
    ["18.99999", "19"], ["18", "18"], ["0.00001", "0"],
  ])("precisión auxiliar %s → %s es solo visual", (raw, expected) => {
    expect(auxiliaryDecimal(raw)).toBe(expected)
  })
  it("texto de ausencia certificada se limita al dominio", async () => {
    const outcome = await inverse("5557.04", "fortnightly", { grossRange: { from: "6216.15", to: "6216.16" } })
    const text = inverseStatus({ ...outcome.presentation.inverse!, match: "none" }, "not-determinable")
    expect(text).toContain("ausencia de coincidencia exacta demostrada solo en el dominio analizado")
    expect(text).not.toContain("no se ha demostrado ausencia")
  })
})
