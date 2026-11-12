import { Component, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { ResultsSection } from "../calculator/components/results-section"
import type { StoredFiscalSnapshot } from "../storage/snapshot"
import {isCompatDocument} from '../documents/presentation-document-compat'
import {compatClassification} from '../documents/presentation-compat-v1'
import {CompatOutcomeDetails} from './compat-outcome-details'

class HistoricalResultBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false}
  static getDerivedStateFromError(){return {failed:true}}
  render(){return this.state.failed?<p role="alert">No se puede presentar fielmente este registro. Se conserva para recuperación; no se recalculó.</p>:this.props.children}
}

export function HistoricalResultContent({snapshot}:{snapshot:StoredFiscalSnapshot}) {
  if(isCompatDocument(snapshot))return <CompatOutcomeDetails outcome={snapshot.outcome} date={snapshot.capture.form.effectiveDate} classification={compatClassification(snapshot)}/>
  return <fieldset disabled className="historical-readonly-results" aria-label="Resultado histórico de solo lectura">
    <ResultsSection mode={snapshot.capture.form.mode} period={snapshot.capture.form.period} phase="result" presentation={snapshot.outcome.presentation} report={snapshot.outcome.report} requestId={snapshot.execution.requestId} hideExportPdf/>
  </fieldset>
}

/** Reutiliza exactamente los componentes aprobados. Shadow DOM aísla sus IDs
 * ARIA de la calculadora que sigue montada, sin cambiar la lógica ni sus archivos.
 * Los estilos se copian del CSS local ya cargado, también disponible offline. */
export function HistoricalResults({snapshot}:{snapshot:StoredFiscalSnapshot}) {
  const host=useRef<HTMLDivElement>(null),[target,setTarget]=useState<HTMLDivElement|null>(null)
  useLayoutEffect(()=>{
    const element=host.current!
    const shadow=element.shadowRoot??element.attachShadow({mode:"open"})
    const style=document.createElement("style")
    style.textContent=[...document.styleSheets].flatMap(sheet=>{try{return [...sheet.cssRules].map(rule=>rule.cssText)}catch{return []}}).join("\n")+"\n:host{display:block;min-width:0}fieldset.historical-readonly-results{border:0;margin:0;padding:0;min-width:0}.results-view{min-width:0}"
    const mount=document.createElement("div");mount.className="results-view"
    shadow.replaceChildren(style,mount);setTarget(mount)
    return()=>{shadow.replaceChildren()}
  },[])
  return <div ref={host} className="historical-results-host" data-original-execution={snapshot.executionId}>
    {target&&createPortal(<HistoricalResultBoundary key={snapshot.executionId}><HistoricalResultContent snapshot={snapshot}/></HistoricalResultBoundary>,target)}
  </div>
}
