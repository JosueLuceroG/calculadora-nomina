import {useState} from 'react'
import type {FiscalOutcome} from '../calculator/fiscal-adapter'
import {formatMxn,formatSignedMxn} from '../calculator/format'
import {compatOutcomeView,documentaryPage,documentaryLabels,dispositionLabels} from '../documents/compat-outcome-view'
import type {CompatClassification} from '../documents/contracts-compat-v1'
import './compat-outcome-details.css'

type IntervalRow=Readonly<{from:string;to:string;disposition?:keyof typeof dispositionLabels;reason?:string}>
export function DocumentaryIntervalTable({title,rows}:{title:string;rows:readonly IntervalRow[]}){
 const [selected,setSelected]=useState(0),p=documentaryPage(rows,selected)
 return <section className="documentary-table-section"><h4>{title} ({rows.length})</h4>{rows.length?<>
  <div className="documentary-table-scroll" tabIndex={0} role="region" aria-label={title}><table><thead><tr><th>Desde (bruto MXN)</th><th>Hasta (bruto MXN)</th><th>Estado / motivo original</th></tr></thead><tbody>{p.rows.map((r,n)=><tr key={p.start+n}><td>{formatMxn(r.from)}</td><td>{formatMxn(r.to)}</td><td>{r.disposition?dispositionLabels[r.disposition]:'Intervalo pendiente'}{r.reason&&<><br/><code>{r.reason}</code></>}</td></tr>)}</tbody></table></div>
  <nav aria-label={`Paginación: ${title}`}><button type="button" disabled={!p.page} onClick={()=>setSelected(p.page-1)}>Anterior</button><span>Página {p.page+1} de {p.pages} · filas {p.start+1}–{Math.min(p.start+p.rows.length,p.total)} de {p.total}</span><button type="button" disabled={p.page+1===p.pages} onClick={()=>setSelected(p.page+1)}>Siguiente</button></nav>
 </>:<p>Sin intervalos reportados en esta lista; no implica ausencia de solución.</p>}</section>
}

export function CompatOutcomeDetails({outcome,date,classification,current=false}:{outcome:FiscalOutcome;date:string;classification?:CompatClassification;current?:boolean}){
 const v=compatOutcomeView(outcome,date),i=v.inverse
 return <section className="surface documentary-compat" aria-label="Detalle documental compat-v1">
  <h3>{current?'Detalle del resultado actual en RAM':'Detalle del documento original'}</h3>
  {current&&<p role="note">Visualización de solo lectura. No acredita guardado; los diagnósticos incompletos no pueden guardarse en este bloque.</p>}
  {classification&&<p>Clasificación documental: <strong>{documentaryLabels[classification]}</strong>.</p>}
  <dl className="history-original-facts"><div><dt>Resultado global</dt><dd>{v.globalLabel} · <code>{v.globalStatus}</code></dd></div><div><dt>Resultado encontrado</dt><dd>{v.candidateLabel}</dd></div>
   <div><dt>Bruto{ i?' del candidato':''}</dt><dd>{formatMxn(v.amounts.grossSalary)}</dd></div><div><dt>Neto{ i?' del candidato':''}</dt><dd>{formatMxn(v.amounts.netSalary)}</dd></div><div><dt>ISR retenido</dt><dd>{formatMxn(v.amounts.isr)}</dd></div><div><dt>IMSS descontado</dt><dd>{formatMxn(v.amounts.workerImss)}</dd></div>
  </dl>
  <details><summary>Componentes e integración originales</summary><dl className="history-original-facts">
   <div><dt>Subsidio determinado</dt><dd>{formatMxn(v.subsidy.determined)}</dd></div><div><dt>Subsidio aplicado</dt><dd>{formatMxn(v.subsidy.applied)}</dd></div><div><dt>Subsidio no aplicado por falta de retención</dt><dd>{formatMxn(v.subsidy.notAppliedDueToNoWithholding)}</dd></div><div><dt>Excedente no entregado ni trasladable</dt><dd>{formatMxn(v.subsidy.excessOverTariffIsrNotDelivered)}</dd></div>
   <div><dt>Diario de referencia del reporte</dt><dd>{formatMxn(v.amounts.dailySalary)}</dd></div><div><dt>Factor de integración mostrado</dt><dd>{v.amounts.integrationFactor??'—'}</dd></div><div><dt>SDI teórico</dt><dd>{formatMxn(v.amounts.integratedDailySalary)}</dd></div><div><dt>SBC estimado, no registrado</dt><dd>{formatMxn(v.amounts.contributionBaseSalary)}</dd></div>
  </dl></details>
  <p>— significa desconocido, nunca cero. Las cifras se copian del original; no se recalculan.</p>
  {v.confirmation&&<p role="note">Condición fiscal pendiente: {v.confirmation.contextual?.message??v.confirmation.basis}. No se aplica una confirmación al documento original.</p>}
  {i&&<>
   <h4>Candidato, cobertura y garantías independientes</h4>
   <dl className="history-original-facts"><div><dt>Neto objetivo</dt><dd>{formatMxn(i.target)}</dd></div><div><dt>Diferencia con signo</dt><dd>{formatSignedMxn(i.difference)}</dd></div><div><dt>Calidad del candidato</dt><dd>{i.match==='none'?'Sin coincidencia recomendada':documentaryLabels[i.match]}</dd></div><div><dt>Cobertura</dt><dd>{i.coverage==='complete'?'Completa dentro del dominio':i.coverage==='limited'?'Limitada: quedan intervalos pendientes':'Fiscalmente incompleta'}</dd></div><div><dt>Dominio analizado</dt><dd>{i.domain?`${formatMxn(i.domain.from)} a ${formatMxn(i.domain.to)}`:'No determinado'}</dd></div><div><dt>Interrupción / terminación</dt><dd>{i.stopLabel} · <code>{i.metrics.stopReason}</code></dd></div></dl>
   <ul>{i.guarantees.map(g=><li key={g.label}>{g.label}: <strong>{g.value?'Demostrado en el dominio indicado':'No demostrado'}</strong>.</li>)}</ul>
   <p>No se garantiza optimalidad global de una aproximación. Conclusión original: <code>{i.conclusion}</code>. Base de recomendación: <code>{i.recommendationBasis}</code>.</p>
   <p>Certificado técnico disponible: <strong>{i.certificateAvailable?'Sí':'No'}</strong>. Motivo original: <code>{i.certificateReason}</code>. Cierres certificados: {i.metrics.certifiedClosures}. Certificación fiscal: no certificada.</p>
   <p>Evaluaciones reportadas: {i.metrics.directEvaluations} / {i.metrics.maxEvaluations}. Tiempo reportado: {i.metrics.elapsedMs} ms / presupuesto {i.metrics.maxDurationMs} ms. Son hechos reportados, no atestación matemática de JavaScript.</p>
   <p>Vecino inferior: {i.nearestBelow?`${formatMxn(i.nearestBelow.gross)} → ${formatMxn(i.nearestBelow.net)}`:'Desconocido / no reportado'}. Vecino superior: {i.nearestAbove?`${formatMxn(i.nearestAbove.gross)} → ${formatMxn(i.nearestAbove.net)}`:'Desconocido / no reportado'}.</p>
   <DocumentaryIntervalTable title="Intervalos pendientes por presupuesto" rows={i.pending}/><DocumentaryIntervalTable title="Intervalos fiscales pendientes" rows={i.fiscalPending}/><DocumentaryIntervalTable title="Evidencia de cobertura reportada" rows={i.evidence}/>
  </>}
  {!!v.issues.length&&<details open><summary>Motivos y condiciones ({v.issues.length})</summary><ul>{v.issues.map((x,n)=><li key={n}><code>{x.code}</code>: {x.message}</li>)}</ul></details>}
  {!!v.warnings.length&&<details><summary>Advertencias originales ({v.warnings.length})</summary><ul>{v.warnings.map((x,n)=><li key={n}><code>{x.code}</code>: {x.message}</li>)}</ul></details>}
 </section>
}
