import { Button } from '@/components/ui/button'
import { getParameterCatalog2026, type ParameterCatalog } from './parameter-catalog'

export const fiscalUpdateMessage = 'Las actualizaciones fiscales llegan mediante nuevas versiones de la aplicación, distribuidas con su instalador. Esta versión no ofrece importación manual de parámetros.'
const date = (value: string) => value.split('-').reverse().join('/')

/** Recorded dates only: opening the screen never claims a fresh verification. */
export function recordedDateRange(values: readonly string[]): string {
  const dates = [...new Set(values.filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value)))].sort()
  if (!dates.length) return 'No registrada'
  return dates.length === 1 ? date(dates[0]) : `${date(dates[0])} — ${date(dates[dates.length - 1])}`
}

export function FiscalUpdateNotice() {
  return <p className="parameter-coverage-note" role="note">{fiscalUpdateMessage}</p>
}

export function FiscalAdministrationSummary({ catalog }: { catalog: ParameterCatalog }) {
  const sets = [...catalog.isrTariffs, ...catalog.uma.map(s => s.parameters), ...catalog.minimumWages.map(s => s.parameters), ...catalog.subsidy.map(s => s.parameters), ...catalog.imss.map(s => s.parameters), ...catalog.benefits, ...catalog.contractualDivisors]
  const sources = [...sets.flatMap(s => s.sources), ...Object.values(catalog.supportingSources)]
  const checked = catalog.sourceReview.records.filter(record => record.status === 'verified').map(record => record.queriedOn.slice(0, 10))
  return <div className="parameter-context" role="note" aria-label="Administración fiscal integrada">
    <FiscalUpdateNotice />
    <dl className="parameter-facts">
      <div><dt>Ejercicio</dt><dd>{catalog.exercise}</dd></div>
      <div><dt>Fuente fiscal</dt><dd>Catálogo integrado en la aplicación; documentos oficiales en cada categoría.</dd></div>
      <div><dt>Revisión de parámetros</dt><dd><code>{catalog.packageVersion}</code></dd></div>
      <div><dt>Cobertura del catálogo</dt><dd><time dateTime={catalog.supportedDates.from}>{date(catalog.supportedDates.from)}</time> — <time dateTime={catalog.supportedDates.through}>{date(catalog.supportedDates.through)}</time></dd></div>
      <div><dt>Verificación registrada en las fuentes</dt><dd>{recordedDateRange(sources.map(source => source.verifiedOn))}</dd></div>
      <div><dt>Cotejo documental registrado</dt><dd>{recordedDateRange(checked)}</dd></div>
    </dl>
    <p>Estas fechas proceden de los registros incluidos; no indican una consulta en línea al abrir la pantalla ni una aprobación fiscal nueva.</p>
    <p>Consultar el catálogo no modifica cálculos guardados. Pago diario independiente y cobertura 2027 no están habilitados.</p>
  </div>
}

/** Availability of the catalog, not a substitute for per-request resolution. */
export function IntegratedFiscalSourceNotice({ onParameters }: { onParameters: () => void }) {
  const catalog = getParameterCatalog2026()
  return <div className="fiscal-source-notice" role="note">
    <p>Parámetros fiscales integrados · {catalog.exercise}. Actualizaciones mediante nuevas versiones de la aplicación.</p>
    <Button variant="ghost" type="button" onClick={onParameters}>Revisar fuente en Parámetros</Button>
  </div>
}
