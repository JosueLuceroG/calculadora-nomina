import { renderToStaticMarkup } from "react-dom/server"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"
import fixture from "../../tests/fixtures/operational-4b1.expected.json"
import examples from "./verified-examples.json"
import { HelpExample, HelpSection } from "./help-section"
import { getHelpTopics, inverseHelpStates } from "./help-topics"
import { ParameterSection, parameterCategories } from "../parameters/parameter-section"
import { createFiscalAdapter } from "../calculator/fiscal-adapter"
import { createInitialForm } from "../calculator/form"

const html = () => renderToStaticMarkup(<HelpSection onOpenParameters={() => {}} />)
describe("5B.6: ejemplos de fixtures verificados, sin calcular al consultar", () => {
  it("proyección identifica el fixture original intacto por SHA-256", () => {
    const source = readFileSync(fileURLToPath(new URL("../../tests/fixtures/operational-4b1.expected.json", import.meta.url)))
    expect(examples.provenance.sourceSha256).toBe(createHash("sha256").update(source).digest("hex").toUpperCase())
    expect(examples.provenance.method).toBe(fixture.method)
    expect(examples.provenance.sourceFile).toBe("src/tests/fixtures/operational-4b1.expected.json")
  })
  it("ejemplo mensual e intermedio proceden de M01-on/M01-off sin reconstruir impuestos", () => {
    const on = fixture.direct.find(item => item.id === examples.direct.fixtureId)!
    const off = fixture.direct.find(item => item.id === examples.direct.intermediateFixtureId)!
    expect(examples.direct.request).toEqual(on.request)
    expect(examples.direct.values).toEqual({ gross: on.expected.components.gross, isrTariff: on.expected.components.isrTariff, subsidyApplied: on.expected.components.subsidyApplied, isrWithheld: on.expected.components.isrWithheld, imssDeducted: on.expected.components.imssDeducted, net: on.expected.components.net })
    expect(examples.direct.afterIsr).toBe(off.expected.components.net)
    expect(examples.direct.values).toMatchObject({ gross: "15000.00", isrWithheld: "1402.82", imssDeducted: "394.54", net: "13202.64", subsidyApplied: "0.00" })
    expect(examples.direct.afterIsr).toBe("13597.18")
  })
  it("caso mensual continúa coincidiendo con el adaptador y motor reales", () => {
    const adapter = createFiscalAdapter(), request = examples.direct.request
    const prepared = adapter.prepare({ area: "general-zone", form: { ...createInitialForm(), mode: "gross-to-net", amount: request.gross, period: "monthly", effectiveDate: request.date, bonusDays: request.benefits.annualBonusDays, vacationDays: request.benefits.annualVacationDays, vacationPremium: request.benefits.vacationPremiumPercent, includeImss: request.includeImss } })
    if (!prepared.ok || prepared.prepared.mode !== "gross-to-net") throw new Error("Preparación fallida")
    const result = adapter.direct(prepared.prepared)
    expect(result.presentation.values).toMatchObject({ netSalary: examples.direct.values.net, isr: examples.direct.values.isrWithheld, workerImss: examples.direct.values.imssDeducted })
  })
  it("las dos alternativas semanales proceden de M09-week, sin convertir observaciones en prueba global", () => {
    const inverse = fixture.inverse.find(item => item.id === examples.inverse.fixtureId)!
    expect(examples.inverse.request).toEqual(inverse.request)
    expect(examples.inverse.candidates).toEqual(inverse.expectedCandidates.map(({ gross, net, difference }) => ({ gross, net, difference })))
    expect(examples.inverse.candidates.map(item => item.gross)).toEqual(["3499.99", "3500.00"])
    expect(examples.inverse.request.targetNet).toBe("3076.67")
    expect(examples.inverse.coverage).toBe("exhaustive-only-in-listed-windows-not-global-proof")
    expect(html()).toContain("no aseguran unicidad ni cobertura global")
  })
  it("cada alternativa se verifica con el motor directo original", () => {
    const adapter = createFiscalAdapter()
    for (const candidate of examples.inverse.candidates) {
      const request = examples.inverse.request
      const prepared = adapter.prepare({ area: "general-zone", form: { ...createInitialForm(), mode: "gross-to-net", amount: candidate.gross, period: "weekly", effectiveDate: request.date } })
      if (!prepared.ok || prepared.prepared.mode !== "gross-to-net") throw new Error("Preparación semanal fallida")
      expect(adapter.direct(prepared.prepared).report.net.amount).toBe(candidate.net)
    }
  })
  it("el ejemplo muestra fecha, prestaciones, IMSS y ambas restas con centavos exactos", () => {
    const result = renderToStaticMarkup(<HelpExample />)
    for (const text of ["01/02/2026", "General · Mensual", "15 / 12 días", "25% · Sí", "$ 15,000.00", "$ 1,402.82", "$ 394.54", "$ 13,597.18", "$ 13,202.64", "$ 0.00", "no se suma el subsidio otra vez al neto"]) expect(result).toContain(text)
    expect(result).toContain("No utiliza ni cambia los datos")
    expect(result).toContain('aria-label="Resta final paso a paso"')
    expect(result).not.toContain("Calcular</button>")
  })
})

describe("Ayuda: organización, contenido y límites", () => {
  it.each(getHelpTopics())("$title: apartado nativo desplegable y accesible", topic => {
    const result = html()
    expect(result).toContain(`id="help-topic-${topic.id}"`)
    expect(result).toContain(`<summary>${topic.title}</summary>`)
    expect(result).not.toMatch(new RegExp(`<details[^>]*id="help-topic-${topic.id}"[^>]*open`))
    expect(topic.paragraphs.length).toBeGreaterThan(0)
    expect(topic.parameters.length).toBeGreaterThan(0)
  })
  it("solo el ejemplo comienza desplegado; no se presenta una pantalla legal extensa", () => {
    const result = html()
    expect(result.match(/<details\b/g)).toHaveLength(11)
    expect(result.match(/open=""/g)).toHaveLength(1)
    expect(result).toContain('id="help-title" tabindex="-1"')
  })
  it("fórmula final y papel del subsidio no duplican el beneficio", () => {
    expect(html()).toContain("Neto = Bruto − ISR efectivamente retenido − IMSS efectivamente descontado.")
    expect(html()).toContain("no debe sumarse otra vez al neto")
    expect(html()).toContain("No son tres descuentos distintos")
  })
  it.each(inverseHelpStates)("explica el estado $label sin inventar garantías", state => {
    expect(html()).toContain(`<dt>${state.label}</dt>`)
    expect(html()).toContain(state.text)
  })
  it("mínimo mensual y artículo 96 permanecen visibles fuera de desplegables", () => {
    const lead = html().split('<details class="help-example"')[0]
    expect(lead).toContain("hallazgo 4B.1")
    expect(lead).toContain("artículo 96")
    expect(lead).toContain("requiere percibir únicamente salario mínimo general en el mes")
    expect(lead).toContain("no hay una excepción automática de ISR")
    expect(html()).toContain("la región mensual de análisis no es un nuevo piso legal")
    expect(html()).toContain("no verifica todas las percepciones reales")
  })
  it("no universaliza vacaciones ni presenta SBC como registrado", () => {
    expect(html()).toContain("punto de partida editable")
    expect(html()).toContain("no un valor universal")
    expect(html()).toContain("no infiere la antigüedad")
    expect(html()).toContain("SBC efectivamente registrado")
    expect(html()).toContain("no constituye una exención legal")
  })
  it("fecha, zona y límites no activan cobertura o prestaciones nuevas", () => {
    for (const text of ["fecha civil local", "no necesariamente es la fecha de pago", "Elegir otra fecha: Sí", "2027", "queda bloqueado", "Zona Libre de la Frontera Norte no está soportada", "7/15/30", "acumulados", "no está homologado", "CFDI", "no cero"]) expect(html()).toContain(text)
  })
  it.each(parameterCategories)("referencia a $label usa una categoría existente y no copia sus tablas", ({ id }) => {
    expect(html()).toContain(`data-help-parameter="${id}"`)
    expect(html()).not.toContain("<table")
    expect(html()).not.toContain("data-isr-row")
    const result = renderToStaticMarkup(<ParameterSection referenceDate="2026-02-01" simulationPackage={null} navigationTarget={{ category: id, token: 1 }} />)
    expect(result).toContain(`data-category="${id}"`)
  })
  it("no contiene enlaces externos o controles de captura, modificación o guardado", () => {
    expect(html()).not.toMatch(/<(?:input|textarea|select|form|a)\b/)
    expect(html()).not.toContain("Guardar")
    expect(html()).not.toContain("guardado automáticamente")
  })
  it("contenido offline sin peticiones ni ejecución del controlador", () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline"))
    try { expect(html()).toContain("Ayuda"); expect(fetch).not.toHaveBeenCalled() } finally { fetch.mockRestore() }
    for (const filename of ["help-section.tsx", "help-topics.ts"]) {
      const source = readFileSync(fileURLToPath(new URL(`./${filename}`, import.meta.url)), "utf8")
      expect(source).not.toMatch(/calculate\w*\s*\(|createFiscalAdapter|createCalculationController|\.submit\(/)
      expect(source).not.toContain("operational-4b1.expected.json")
    }
    const json = JSON.stringify(examples)
    expect(json).not.toContain('"tariffs"')
    expect(json).not.toContain('"tariffRow"')
  })
})
