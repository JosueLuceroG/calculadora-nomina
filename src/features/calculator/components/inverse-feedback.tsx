import type { FiscalPresentation } from "../fiscal-adapter"
import { formatMxn, formatSignedMxn } from "../format"

type InversePresentation = NonNullable<FiscalPresentation["inverse"]>

export function InverseReconciliation({ inverse }: { inverse: InversePresentation }) {
  return <dl className="inverse-reconciliation" aria-label="Comparación del neto objetivo y obtenido">
    <div><dt>Neto solicitado</dt><dd data-inverse="target">{formatMxn(inverse.targetNet)}</dd></div>
    <div><dt>Neto realmente obtenido</dt><dd data-inverse="obtained">{formatMxn(inverse.obtainedNet)}</dd></div>
    <div><dt>Diferencia</dt><dd data-inverse="difference">{formatSignedMxn(inverse.difference)}</dd></div>
  </dl>
}

export function InverseSearchDetails({ inverse }: { inverse: InversePresentation }) {
  return <div className="inverse-search-details">
    <h3>Cobertura del inverso</h3>
    <p>Dominio analizado: {inverse.domain ? `${formatMxn(inverse.domain.from)} a ${formatMxn(inverse.domain.to)} MXN de bruto.` : "no determinado."} Las conclusiones se limitan a este dominio y al perfil estándar.</p>
    <p>{inverse.coverage === "complete" ? "Cobertura completa del dominio." : inverse.coverage === "limited" ? "Búsqueda limitada: quedan intervalos pendientes. Los candidatos mostrados sí están verificados; pueden existir otros." : "Cobertura fiscal incompleta: hay condiciones fiscales pendientes; no equivale a ausencia de solución."}</p>
    {inverse.stopReason === "time-budget" && <p>Se agotó el presupuesto de tiempo; no es una cancelación voluntaria.</p>}
    {inverse.stopReason === "evaluation-budget" && <p>Se agotó el presupuesto de evaluaciones; no es una cancelación voluntaria.</p>}
    {inverse.minimumProven ? <p>El bruto recomendado es el mínimo demostrado dentro del dominio analizado.</p> : inverse.match === "exact" ? <p>Bruto encontrado: no se ha demostrado que sea el mínimo; puede existir un bruto menor.</p> : null}
    {inverse.uniquenessProven && <p>Unicidad de la coincidencia exacta demostrada dentro del dominio analizado.</p>}
    {inverse.noExactMatchProven && <p>Ausencia de coincidencia exacta demostrada únicamente dentro del dominio analizado.</p>}
    {inverse.match === "approximate" && <p>Bruto aproximado: el neto no coincide con el objetivo. No se garantiza la mejor aproximación global.</p>}
    {!inverse.exactSetComplete && <p>El conjunto de coincidencias exactas no está demostrado completo.</p>}
  </div>
}

export function InverseAlternatives({ inverse }: { inverse: InversePresentation }) {
  return <div className="inverse-alternatives">
    {inverse.match === "approximate" && <p>El neto realmente obtenido difiere del solicitado. Una diferencia positiva significa que recibe más; una negativa, que recibe menos. No se garantiza la mejor aproximación global.</p>}
    {inverse.coverage === "limited" && <p>Búsqueda limitada: los brutos mostrados están verificados, pero pueden existir otros. No se ha certificado toda la cobertura requerida.</p>}
    {inverse.coverage === "fiscally-incomplete" && <p>Hay una condición fiscal pendiente. Esto no demuestra que no exista solución ni que el bruto encontrado sea el menor.</p>}
    {inverse.alternatives.length > 0 ? <>
      <p>Alternativas verificadas ({inverse.alternatives.length}). Lista informativa; el desglose siempre corresponde al bruto recomendado.</p>
      <p>{inverse.exactSetComplete ? "El conjunto está certificado únicamente dentro del dominio analizado, no fuera de él." : "No se afirma que esta lista contenga todas las soluciones posibles."}</p>
      <ul aria-label="Brutos exactos verificados">{inverse.alternatives.map(candidate => <li key={candidate.gross}>
        Bruto {formatMxn(candidate.gross)} · Neto {formatMxn(candidate.net)} · Diferencia {formatSignedMxn(candidate.difference)}{candidate.gross === inverse.recommendedGross ? " · Recomendado" : ""}{candidate.scenario === "conditional-minimum" ? " · Hipótesis mensual explícita" : ""}
      </li>)}</ul>
    </> : <p>No hay alternativas exactas verificadas para mostrar.</p>}
  </div>
}
