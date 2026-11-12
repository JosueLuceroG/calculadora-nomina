import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { App } from "@/app/App"
import { createDateSession, changeManualDate } from "../date-policy"
import { queryFiscalDateCoverage } from "../fiscal-adapter"
import { FiscalDateControl, fiscalDateHelp } from "./fiscal-date-control"

const noAction = () => {}
describe("fecha fiscal en React", () => {
  it("App inicia compacta; la referencia automática conserva hoy al desplegar", () => {
    const html = renderToStaticMarkup(<App clock={() => new Date(2026, 9, 16, 12)} />)
    expect(html).not.toContain('id="effective-date"')
    expect(html).toContain('aria-label="Mostrar opciones IMSS y fechas" aria-expanded="false"')
    expect(html).not.toContain('type="date"')
    expect(html).toMatch(/<input(?=[^>]*id="include-imss")(?=[^>]*checked="")[^>]*>/)
    expect(html).toContain('id="bonus-days"')
    expect(html).toMatch(/<input(?=[^>]*id="bonus-days")(?=[^>]*value="15")[^>]*>/)
    expect(html).toContain('data-salary-area="general-zone"')
    expect(html).not.toContain("Seleccionar zona")
    const session = createDateSession(new Date(2026, 9, 16, 12))
    const openedDate = renderToStaticMarkup(<FiscalDateControl session={session} coverage={queryFiscalDateCoverage(session.referenceDate)} onManual={noAction} onAutomatic={noAction} onChange={noAction} />)
    expect(openedDate).toContain('data-reference-date="2026-10-16"')
    expect(openedDate).toContain("16 de octubre de 2026")
    expect(openedDate).toMatch(/<input(?=[^>]*name="fiscal-date-mode")(?=[^>]*value="no")(?=[^>]*checked="")[^>]*>/)
  })
  it("App conserva hoy de 2027 visible y bloquea sin seleccionar 2026", () => {
    const html = renderToStaticMarkup(<App clock={() => new Date(2027, 0, 1, 12)} />)
    expect(html).toContain('data-reference-date="2027-01-01"')
    expect(html).toContain("No hay parámetros compatibles")
    expect(html).toMatch(/class="[^"]*calculate-button"/)
    expect(html).toContain('aria-describedby="effective-date-error"')
  })
  it("manual ofrece límites del repositorio y explicación con control de teclado", () => {
    const session = changeManualDate(createDateSession(new Date(2026, 9, 16, 12)), "2026-02-01")
    const html = renderToStaticMarkup(<FiscalDateControl session={session} coverage={queryFiscalDateCoverage(session.referenceDate)} onManual={noAction} onAutomatic={noAction} onChange={noAction} />)
    expect(html).toContain('type="date"')
    expect(html).toContain('min="2026-01-01" max="2026-12-31"')
    expect(html).toContain('aria-label="Ayuda sobre Fecha de referencia fiscal"')
    expect(html).toContain('aria-expanded="false"')
    expect(fiscalDateHelp).toContain("No necesariamente coincide con el día de pago.")
  })
})
