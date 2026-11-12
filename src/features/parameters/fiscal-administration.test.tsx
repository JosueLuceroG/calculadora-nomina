import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { App } from '../../app/App'
import { FiscalAdministrationSummary, IntegratedFiscalSourceNotice, recordedDateRange } from './fiscal-administration'
import { getParameterCatalog2026 } from './parameter-catalog'
import { ParameterSection } from './parameter-section'
import { HelpSection } from '../help/help-section'
import { createFiscalExecutionApi } from '../calculator/fiscal-execution-api'
import { createEmbeddedFiscalRegistry2026 } from '../../infrastructure/fiscal/package-registry'
import { ENGINE_FISCAL_CAPABILITIES } from '../../infrastructure/fiscal/engine-capabilities'
import { resolveFiscalExecution } from '../../domain/fiscal-runtime/resolver'

describe('SIMPLE-1: catálogo integrado y actualizaciones mediante instalador', () => {
  it('muestra revisión, cobertura y verificaciones existentes, no una fecha nueva', () => {
    const catalog = getParameterCatalog2026()
    const html = renderToStaticMarkup(<FiscalAdministrationSummary catalog={catalog} />)
    expect(html).toContain(String(catalog.exercise))
    expect(html).toContain(catalog.packageVersion)
    expect(html).toContain('2026-01-01')
    expect(html).toContain('2026-12-31')
    expect(html).toContain('13/10/2026 — 14/10/2026')
    expect(html).toContain('18/10/2026')
    expect(html).toContain('no indican una consulta en línea')
    expect(html).toContain('no ofrece importación manual de parámetros')
    expect(html).not.toMatch(/<(?:input|select|textarea)\b/)
  })
  it('conserva fecha desconocida y resume fechas registradas sin usar el reloj', () => {
    expect(recordedDateRange([])).toBe('No registrada')
    expect(recordedDateRange(['', 'sin verificar'])).toBe('No registrada')
    expect(recordedDateRange(['2026-10-14', '2026-10-13', '2026-10-14'])).toBe('13/10/2026 — 14/10/2026')
  })
  it('Parámetros y Ayuda explican el mismo canal de actualización y exclusiones', () => {
    const parameters = renderToStaticMarkup(<ParameterSection referenceDate="2026-11-04" simulationPackage={null} />)
    const help = renderToStaticMarkup(<HelpSection onOpenParameters={() => {}} />)
    for (const html of [parameters, help]) {
      expect(html).toContain('Las actualizaciones fiscales llegan mediante nuevas versiones de la aplicación')
      expect(html).toContain('instalador')
      expect(html).toContain('2027')
      expect(html).toContain('diario independiente')
      expect(html).not.toContain('Importar paquete fiscal')
      expect(html).not.toContain('Gestionar confianza')
    }
  })
  it('la captura real conserva ambos modos sin auxiliar ni operaciones externas', () => {
    const html = renderToStaticMarkup(<App />)
    expect(html).toContain('Parámetros fiscales integrados')
    expect(html).toContain('Bruto a neto')
    expect(html).toContain('Neto a bruto')
    expect(html).not.toContain('Desde cuota diaria')
    expect(html).not.toContain('En ejecuciones externas: guardar automáticamente')
    expect(html).not.toContain('Gestionar confianza')
    expect(html).not.toContain('Importar paquete fiscal')
    expect(html).not.toContain('bootstrap')
  })
  it('consultar información no requiere red, no cambia catálogo ni dispara navegación', () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Offline'))
    const navigate = vi.fn(), catalog = getParameterCatalog2026(), before = JSON.stringify(catalog)
    try {
      const notice = renderToStaticMarkup(<IntegratedFiscalSourceNotice onParameters={navigate} />)
      expect(notice).toContain(String(catalog.exercise))
      expect(notice).not.toContain(catalog.packageVersion)
      renderToStaticMarkup(<FiscalAdministrationSummary catalog={catalog} />)
      expect(navigate).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
      expect(JSON.stringify(catalog)).toBe(before)
    } finally { fetch.mockRestore() }
  })
  it('disponibilidad ordinaria cerrada conserva integrado sin iniciar fuentes externas', async () => {
    const invoke = vi.fn().mockResolvedValue({ qa: false, canImport: false })
    expect((await createFiscalExecutionApi(invoke).source()).kind).toBe('embedded')
    expect(invoke.mock.calls).toEqual([['fiscal_import_info', { request: { repository: false } }]])
  })
  it('directo/inverso se resuelven en el perfil integrado y no cambian por consultar la interfaz', () => {
    const a = ENGINE_FISCAL_CAPABILITIES.authorizations[0], registry = createEmbeddedFiscalRegistry2026()
    const base = { fiscalDate: '2026-11-04', periodicity: 'weekly' as const, simulationProfileId: a.simulationProfileId, ruleProfileId: a.ruleProfileId, contextualPolicyId: a.contextualPolicyId }
    for (const operation of ['gross-to-net', 'net-to-gross'] as const) {
      const result = resolveFiscalExecution({ ...base, operation, requiredCapabilities: operation === 'gross-to-net' ? ['direct'] : ['direct', 'inverse'] }, registry, ENGINE_FISCAL_CAPABILITIES)
      expect(result.status).toBe('resolved')
      if (result.status === 'resolved') expect(result.context.package.origin).toBe('embedded')
    }
    expect(resolveFiscalExecution({ ...base, fiscalDate: '2027-01-01', operation: 'gross-to-net', requiredCapabilities: ['direct'] }, registry, ENGINE_FISCAL_CAPABILITIES)).toMatchObject({ status: 'rejected', code: 'EXERCISE_PACKAGE_MISSING' })
    expect(resolveFiscalExecution({ ...base, ruleProfileId: 'not-implemented', operation: 'gross-to-net', requiredCapabilities: ['direct'] }, registry, ENGINE_FISCAL_CAPABILITIES)).toMatchObject({ status: 'rejected', code: 'ENGINE_RULE_PROFILE_UNSUPPORTED' })
  })
})
