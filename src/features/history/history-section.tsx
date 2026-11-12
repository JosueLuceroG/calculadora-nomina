import { useEffect, useRef, useState } from "react"
import { ArrowLeft, History, Trash2, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatMxn } from "../calculator/format"
import { paymentPeriods } from "../calculator/form"
import type { HistoryItem } from "../storage/storage-api"
import type { StoredFiscalSnapshot } from "../storage/snapshot"
import type { HistoryController, HistoryState } from "./history-controller"
import { HistoricalResults } from "./historical-results"
import {externalPresentationSummary as externalDocumentSummary} from '../documents/presentation-document-compat'
import {originalDocumentIdentity} from '../documents/original-document'

const direction=(mode:string)=>mode==="gross-to-net"?"Bruto a neto":"Neto a bruto"
export const historyTitle=(item:Pick<HistoryItem,"direction"|"requestedAmount">)=>`${direction(item.direction)} · ${formatMxn(item.requestedAmount).replace("$ ","$")}`
const period=(value:string)=>paymentPeriods.find(p=>p.value===value)?.label??"Periodo no disponible"
const civil=(value:string)=>value.split("-").reverse().join("/")
const utc=(value:string)=>`${civil(value.slice(0,10))} ${value.slice(11,19)} UTC`
const labels={estimated:"Estimado",exact:"Exacto verificado",approximate:"Aproximado",limited:"Limitado",conditioned:"Condicionado",'not-determinable':'No determinable'} as const

export function HistoryDetail({snapshot}:{snapshot:StoredFiscalSnapshot}) {
  const form=snapshot.capture.form,execution=snapshot.execution
  const report=snapshot.outcome.report,retentionPolicy=report.operation==="gross-to-net"?report.retention.policyVersion:report.recommendedForwardResult?.retention.policyVersion
  return <div className="history-detail" data-history-execution={snapshot.executionId}>
    <section className="surface history-original-metadata" aria-labelledby="history-detail-title">
      <h2 id="history-detail-title" tabIndex={-1}>{snapshot.schemaVersion===3&&snapshot.documentKind==='qa-document-fixture'?'Documento de QA':'Cálculo original'}</h2>
      {snapshot.schemaVersion===3&&<ExternalDetails snapshot={snapshot}/>}
      <p className="history-original-title">{historyTitle({direction:form.mode,requestedAmount:form.amount})}</p>
      <p>Consulta de solo lectura. No usa los parámetros ni la fecha actuales para recalcular.</p>
      {originalDocumentIdentity(snapshot)&&<p>SHA-256 del documento original leído: <code>{originalDocumentIdentity(snapshot)!.sha256}</code> · {originalDocumentIdentity(snapshot)!.byteLength} bytes UTF-8.</p>}
      <dl className="history-original-facts">
        <div><dt>Realización original</dt><dd>{civil(execution.completedLocalDate!)} {execution.completedLocalTime} · offset UTC {execution.utcOffsetMinutes} min</dd></div>
        <div><dt>Instante de realización</dt><dd><time dateTime={execution.completedAt!}>{utc(execution.completedAt!)}</time></dd></div>
        <div><dt>Fecha de referencia fiscal</dt><dd>{civil(form.effectiveDate)} · {execution.referenceMode==="automatic"?"Automática":"Manual"}</dd></div>
        <div><dt>Periodicidad</dt><dd>{period(form.period)}</dd></div>
        <div><dt>Aguinaldo / vacaciones / prima</dt><dd>{form.bonusDays} días / {form.vacationDays} días / {form.vacationPremium}%</dd></div>
        <div><dt>Descuento IMSS / zona</dt><dd>{form.includeImss?"Sí":"No"} · General</dd></div>
      </dl>
      <details className="history-original-versions"><summary>Versiones y referencia original</summary>
        <p>Aplicación: {snapshot.versions.application}. Motor: <code>{snapshot.versions.engine}</code>.</p>
        <p>Paquete: <strong>{snapshot.fiscalPackage.id}</strong>. Versión: {snapshot.fiscalPackage.version}.</p>
        <p>SHA-256: <code>{snapshot.fiscalPackage.sha256}</code>.</p>
        <p>Política de retención original: <code>{retentionPolicy??"No registrada en este contrato"}</code>.</p>
        {report.operation==="net-to-gross"&&<p>Política inversa original: <code>{report.provenance.policyVersion}</code>.</p>}
        {snapshot.schemaVersion===2&&<><p>Procedencia v2 · Ejercicio {snapshot.fiscalPackage.exercise}. Paquete integrado, confianza del build; sin firma digital externa.</p><p>Reglas: <code>{snapshot.executionProvenance.resolution.ruleProfileId}</code>. Autorización: <code>{snapshot.executionProvenance.authorization.capabilityId}</code>.</p><p>Registro: <code>{snapshot.executionProvenance.resolution.capabilityRegistryVersion}</code>.</p></>}
      </details>
      {snapshot.outcome.presentation.confirmation&&<p className="history-detail-warning" role="note">Este registro conserva una condición fiscal pendiente. No se presenta como completo ni se puede aplicar una confirmación nueva al histórico.</p>}
    </section>
    <HistoricalResults key={snapshot.executionId} snapshot={snapshot}/>
  </div>
}

function ExternalDetails({snapshot}:{snapshot:Extract<StoredFiscalSnapshot,{schemaVersion:3}>}){const p=externalDocumentSummary(snapshot);return <div role="note"><p><strong>{p.fixtureNotice??'Documento externo con observación histórica de ejecución'}</strong></p><p>Canal {p.channel} · {p.stream} · epoch {p.epoch} · revisión {p.revision}.</p><p>Integridad y firmas criptográficas de los documentos fiscales verificadas con claves observadas. Esto no certifica el cálculo salarial ni constituye una firma de su resultado. La cabeza incluida no se declara su propia raíz confiable.</p><p>Autorización: {p.authority}.</p><p>Verificación observada: {p.verifiedAt}, raíz {p.rootVersion}, trustEpoch {p.trustEpoch}.</p><p>{p.trustLimit} {p.currentTrust}</p><details><summary>Evidencia y contexto congelados v3</summary><p>SHA del payload: <code>{p.payloadSha256}</code>.</p><p>SHA del contenedor: <code>{p.envelopeSha256}</code>.</p><p>Productor: <code>{p.producerId}</code>. Reglas: <code>{p.ruleProfile}</code>.</p>{p.sets.map(s=><p key={s.role}>{s.role}: {s.id} · {s.version}</p>)}</details></div>}

export function HistorySection({controller,state,active,onExportPdf,exportBusy=false}:{controller:HistoryController|null;state:HistoryState|null;active:boolean;onExportPdf?:()=>void;exportBusy?:boolean}) {
  const [confirmClear,setConfirmClear]=useState(false)
  const clearButton=useRef<HTMLButtonElement>(null),cancelButton=useRef<HTMLButtonElement>(null)
  useEffect(()=>{if(active&&controller)void controller.loadFirst()},[active,controller])
  useEffect(()=>{if(confirmClear)cancelButton.current?.focus()},[confirmClear])
  useEffect(()=>{if(active&&state?.selected&&!state.detailLoading)document.getElementById("history-detail-title")?.focus({preventScroll:true})},[active,state?.selected,state?.detailLoading])
  const busy=Boolean(state?.mutationBusy),hasSelection=Boolean(state?.selectedId)
  return <section className="history-section" aria-labelledby="history-title">
    <div className="surface history-header-card">
      <header className="history-header"><div><h2 id="history-title" tabIndex={-1}><History size={23} aria-hidden="true"/>Historial</h2><p>Cálculos originales guardados en este equipo</p></div>
        <Button ref={clearButton} type="button" variant="outline" onClick={()=>setConfirmClear(true)} disabled={!controller||busy}><Trash2/>Borrar todo</Button>
      </header>
      <label className="history-consent"><input type="checkbox" checked={state?.autoSave??false} disabled={!controller||state?.preferenceStatus!=="ready"||state.preferenceBusy||busy} onChange={event=>void controller?.setAutoSave(event.target.checked)} aria-describedby="history-privacy"/>Guardar automáticamente mis cálculos en este equipo</label>
      <p id="history-privacy" className="history-privacy">Los importes salariales se conservan localmente. La base ordinaria no está cifrada. Desactivar esta opción no borra los registros existentes. Una migración puede crear un respaldo temporal con Historial salarial; se elimina tras verificar la migración y reapertura.</p>
      {state?.preferenceBusy&&<p role="status">Confirmando la preferencia en este equipo…</p>}
      {state?.preferenceStatus==="loading"&&<p role="status">Preparando el Historial local…</p>}
      {state?.storageError&&<div className="history-error" role="alert"><p>{state.storageError}</p><p>No se pudo completar el acceso o la operación local; el cálculo fiscal no se modifica.</p><Button type="button" variant="outline" onClick={()=>controller?.retry()} disabled={busy||state.preferenceBusy}>Reintentar acceso</Button></div>}
      {confirmClear&&<div className="history-clear-confirm" role="alertdialog" aria-modal="false" aria-labelledby="history-clear-title" aria-describedby="history-clear-description">
        <h3 id="history-clear-title">¿Borrar todo el historial?</h3><p id="history-clear-description">Se eliminarán los cálculos guardados y sus respaldos técnicos locales. Si una recuperación o un error impide eliminarlos, se indicará que el borrado no concluyó. Tu captura, resultado actual y preferencias se conservan. No se garantiza eliminación física irreversible del almacenamiento.</p>
        <div><Button ref={cancelButton} type="button" variant="secondary" disabled={busy} onClick={()=>{setConfirmClear(false);requestAnimationFrame(()=>clearButton.current?.focus())}}>Cancelar borrado</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={async()=>{await controller?.clear();if(!controller?.getState().storageError)setConfirmClear(false)}}>Sí, borrar historial</Button></div>
      </div>}
    </div>
    {hasSelection?<>
      <div className="history-detail-actions"><Button type="button" variant="outline" onClick={()=>{controller?.closeDetail();requestAnimationFrame(()=>document.getElementById("history-title")?.focus())}}><ArrowLeft/>Volver al listado</Button>
       <div className="history-export-actions"><Button type="button" variant="outline" disabled={!state?.selected||state.detailLoading||Boolean(state.detailError)||busy||exportBusy||!onExportPdf} onClick={onExportPdf}><FileText/>Exportar PDF</Button><Button type="button" variant="outline" disabled={busy} onClick={()=>void controller?.remove(state!.selectedId!)}><Trash2/>Eliminar registro</Button></div></div>
      {state?.detailLoading&&<p className="surface" role="status">Recuperando el cálculo original…</p>}
      {state?.detailError&&<div className="surface history-error" role="alert"><p>{state.detailError}</p><p>El registro se conserva para recuperación; no se recalculó ni se sustituyeron sus valores.</p><Button type="button" variant="outline" onClick={()=>void controller?.open(state.selectedId!)}>Reintentar lectura</Button></div>}
      {state?.selected&&<HistoryDetail snapshot={state.selected}/>}
    </>:<div className="surface history-list-card" aria-busy={state?.listLoading??false}>
      {state?.listError&&<p className="history-error" role="alert">{state.listError} Los registros se conservan sin cambios.</p>}
      {state?.listLoaded&&!state.listLoading&&!state.listError&&!state.items.length&&<div className="history-empty"><History size={34} aria-hidden="true"/><h3>Todavía no tienes cálculos guardados.</h3><p>Si deseas conservar las simulaciones nuevas, activa el guardado automático.</p></div>}
      <ol className="history-list" aria-label="Cálculos guardados">{state?.items.map(item=><li key={item.executionId}>
        <button type="button" className="history-entry" data-history-id={item.executionId} onClick={()=>void controller?.open(item.executionId)}>
          <span className="history-entry-main">{historyTitle(item)}</span><span className="history-entry-meta">{period(item.periodicity)} · {utc(item.completedAt)}</span>
          <span className="history-entry-result">{item.direction==="gross-to-net"?"Neto":"Bruto"}: {formatMxn(item.direction==="gross-to-net"?item.net:item.gross)} <span className={`history-tag history-tag-${item.classification}`}>{labels[item.classification]}</span></span>
        </button><Button type="button" variant="ghost" disabled={busy} aria-label={`Eliminar ${historyTitle(item)}`} onClick={()=>void controller?.remove(item.executionId)}><Trash2 size={17}/></Button>
      </li>)}</ol>
      {state?.listLoading&&<p role="status">Cargando historial…</p>}
      {state?.nextCursor&&<Button type="button" variant="outline" disabled={state.listLoading||busy} onClick={()=>void controller?.loadMore()}>Ver más cálculos</Button>}
    </div>}
  </section>
}
