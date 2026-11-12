import { useState } from "react"
import { Button } from "@/components/ui/button"
import type { FiscalOutcome, FiscalPresentation, MinimumDeclaration } from "../fiscal-adapter"
import { InverseAlternatives } from "./inverse-feedback"
import { AuxiliaryDetails } from "./result-details"
import { importantWarnings, readableWarning, type ForwardReport } from "./result-presentation"
import { TechnicalResultDetails } from "./technical-result-details"
import {MinimumContextPanel} from './minimum-context-panel'

export function CalculationFeedback({ presentation, requestId, onConfirm, forward, report }: {
  presentation: FiscalPresentation; requestId: number;
  forward?: ForwardReport; report?: FiscalOutcome["report"]
  onConfirm?: (requestId: number, declaration: MinimumDeclaration) => void
}) {
  const [checked, setChecked] = useState(false)
  const prompt = presentation.confirmation
  const important = importantWarnings(presentation)
  const imss = forward?.modules.workerImss
  const context=report?.operation==='gross-to-net'?report.retention.assessment?.context:report?.provenance.retentionContext
  const assessment=forward?.retention.assessment
  const resolvedContext:NonNullable<FiscalPresentation['confirmation']>|null=context&&!prompt&&onConfirm?{referenceMonth:context.referenceMonth,candidateGross:forward?.gross.amount??null,basis:presentation.kind==='direct'?'direct-retention':'inverse-relevant-unresolved-point',contextual:{salaryBasis:context.salaryBasis,monthlyCondition:context.monthlyCondition,dailyRelation:assessment?.dailyRelation??null,message:'Estos resultados corresponden a la base del perfil declarada. Puedes precisar otro contexto; se hará una nueva simulación, sin modificar originales guardados.'}}:null
  return (
    <div className="calculation-feedback">
      <div className="result-interpretation" role="note" aria-label="Interpretación del resultado">
        {imss?.status === "estimated" && !imss.data.includeWorkerImss && <p>Descuento IMSS desactivado en esta simulación; no representa una exención legal del IMSS. La absorción legal, cuando corresponda, se conserva.</p>}
        {imss?.status === "estimated" && imss.data.allocation === "absorbed-under-LSS-36" && <p>La cuota obrera calculada la absorbe el patrón (artículo 36 LSS); el descuento al trabajador es cero.</p>}
        {presentation.issues.length > 0 && <ul aria-label="Motivos del resultado">{presentation.issues.map((item, i) => <li key={`${item.code}-${i}`}>{item.message}</li>)}</ul>}
        {important.length > 0 && <ul aria-label="Avisos importantes">{important.map((item, i) => <li key={`${item.code}-${i}`}>{item.message}</li>)}</ul>}
      </div>
      {prompt?.contextual?<MinimumContextPanel prompt={prompt} inverse={presentation.kind==='inverse'} onApply={onConfirm?declaration=>onConfirm(requestId,declaration):undefined}/>:prompt && <div className="minimum-confirmation" role="group" aria-labelledby="minimum-confirmation-title">
        <h3 id="minimum-confirmation-title">Hipótesis mensual de salario mínimo · artículo 96</h3>
        <label htmlFor="minimum-month-ack"><input id="minimum-month-ack" type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} aria-describedby="minimum-assumption-note" />
          <span>Para esta simulación, durante el mes <strong>{prompt.referenceMonth}</strong> percibo únicamente salario mínimo general y no existen otras percepciones salariales.</span>
        </label>
        <p id="minimum-assumption-note">Es una hipótesis de simulación; no verifica una nómina real. {presentation.kind === "inverse" ? "Solo se aplicará al candidato de salario mínimo exacto. Sin confirmarla ese punto fiscal queda pendiente; los demás candidatos conservan su escenario ordinario." : "Sin confirmarla no se determina la retención ni el neto."}</p>
        <Button type="button" disabled={!checked || !onConfirm} onClick={() => {
          if (!checked) return
          onConfirm?.(requestId, { kind: "only-general-minimum-assumed-for-reference-month", referenceMonth: prompt.referenceMonth, noOtherSalaryPayments: true, acknowledgement: "explicit-standard-simulation-assumption-not-payroll-verification" })
        }}>Recalcular con hipótesis</Button>
      </div>}
      <details className="fiscal-insights">
        <summary>Detalles del cálculo</summary>
        <div className="fiscal-insights-body">
          <p>Simulación orientativa con IMSS estimado; sin homologación con SUA/CONTPAQi. «—» indica un importe no determinado, no cero.</p>
          {assessment&&<p>Base del resultado mostrado: {assessment.context.salaryBasis==='agreed-daily-reference'?'salario diario pactado y días estándar':assessment.context.salaryBasis==='actual-calendar'?'calendario real fuera del perfil':'importe fijo del periodo'}. Decisión ISR contextual v2: {assessment.state==='conditional'?'hipótesis mensual expresa, no acreditación real':assessment.state==='not-applicable'?'ordinaria dentro del perfil declarado':assessment.state==='insufficient-context'?'información insuficiente':'escenario fuera del perfil'}.</p>}
          <AuxiliaryDetails presentation={presentation} forward={forward} />
          {resolvedContext&&<MinimumContextPanel prompt={resolvedContext} inverse={presentation.kind==='inverse'} onApply={onConfirm?declaration=>onConfirm(requestId,declaration):undefined}/>}
          {presentation.inverse && <details className="verified-alternatives"><summary>Alternativas verificadas ({presentation.inverse.alternatives.length})</summary><InverseAlternatives inverse={presentation.inverse} /></details>}
          <h3>Supuestos relevantes</h3>
          <p>Salario ordinario fijo completamente gravado. Días y contexto mensual del perfil estándar son estimados, no percepciones comprobadas. No se realiza conciliación mensual ni se comprueban otros pagos o la elección del empleador.</p>
          <ul aria-label="Advertencias fiscales">{presentation.warnings.map((warning, i) => <li key={`${warning.code}-${i}`}>{readableWarning(warning)}</li>)}</ul>
          <TechnicalResultDetails presentation={presentation} forward={forward} report={report} />
        </div>
      </details>
    </div>
  )
}
