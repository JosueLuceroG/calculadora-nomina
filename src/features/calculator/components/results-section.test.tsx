import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { App } from "@/app/App"
import { visualResultFixture } from "../demo/results.fixture"
import { emptyResultValues } from "../results"
import { ResultsSection } from "./results-section"
import { ResultDetails } from "./result-details"

describe("presentación de resultados", () => {
  it.each([
    ["net-to-gross", "Salario bruto requerido", "Salario neto obtenido"],
    ["gross-to-net", "Salario neto obtenido", "Salario bruto"],
  ] as const)("muestra etiquetas y valores vacíos para %s", (mode, primary, secondary) => {
    const html = renderToStaticMarkup(<ResultsSection mode={mode} />)
    expect(html).toContain(`<h3>${primary}</h3>`)
    expect(html).toContain(`<h3>${secondary}</h3>`)
    expect(html).toContain('data-result-state="empty"')
    expect(html).toContain("Sin resultados calculados.")
    expect(html.match(/aria-label="Sin resultado"/g)).toHaveLength(4)
    expect(html).not.toContain("20,000.00")
    expect(html).not.toContain("lucide-check")
  })

  it.each([
    ["weekly", "Semanal"], ["fortnightly", "Quincenal"], ["monthly", "Mensual"],
  ] as const)("presenta %s sin generar importes", (period, label) => {
    const html = renderToStaticMarkup(<ResultsSection mode="net-to-gross" period={period} />)
    expect(html).toContain(`(${label})`)
    expect(html).toContain("MXN")
    expect(html.match(/aria-label="Sin resultado"/g)).toHaveLength(4)
  })

  it("PDF permanece deshabilitado sin resultado vigente; Guardar se mantiene retirado", () => {
    const html = renderToStaticMarkup(<ResultsSection mode="net-to-gross" />)
    expect(html.match(/disabled=""/g)).toHaveLength(1)
    expect(html.match(/aria-describedby="result-actions-status"/g)).toHaveLength(1)
    expect(html).toContain("requiere un resultado vigente")
    expect(html).not.toContain("Guardar")
  })

  it.each(["net-to-gross", "gross-to-net"] as const)("el fixture %s siempre se identifica como ficticio", mode => {
    const demonstration = { ...visualResultFixture, mode }
    const html = renderToStaticMarkup(<ResultsSection mode={mode} demonstration={demonstration} />)
    expect(html).toContain('data-result-state="demonstration"')
    expect(html).toContain("DEMO · Valores ficticios")
    expect(html).toContain("No son un cálculo fiscal")
    expect(html).toContain("lucide-check")
    expect(html).toContain(mode === "net-to-gross" ? 'class="primary-amount" aria-label="$ 20,000.00 MXN"' : 'class="primary-amount" aria-label="$ 18,000.00 MXN"')
    expect(html).toContain("$ 1,500.00")
    expect(html).toContain("$ 500.00")
  })

  it("App abre en captura, sin reservar espacio para resultados ni presentar el fixture", () => {
    const html = renderToStaticMarkup(<App />)
    expect(html).toContain('class="surface capture-section"')
    expect(html).not.toContain('data-result-state=')
    expect(html).not.toContain('class="results-view"')
    expect(html).not.toContain("Valores ficticios para pruebas visuales")
    expect(html).not.toContain("20,000.00")
  })

  it("SDI y SBC no se igualan ni se completan entre sí", () => {
    const html = renderToStaticMarkup(<ResultDetails period="Periodo pendiente" values={{ ...emptyResultValues, integratedDailySalary: "321.00" }} />)
    expect(html).toContain("Salario diario integrado (SDI)</dt><dd>$ 321.00</dd>")
    expect(html).toContain("Salario base de cotización (SBC)</dt><dd>—</dd>")
    expect(visualResultFixture.values.integrationFactor).toBeNull()
    expect(visualResultFixture.values.integratedDailySalary).toBeNull()
    expect(visualResultFixture.values.contributionBaseSalary).toBeNull()
  })
})
