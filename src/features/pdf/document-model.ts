import type {CalculationState} from "../calculator/calculation-controller"
import type {FiscalCapture,FiscalOutcome} from "../calculator/fiscal-adapter"
import type {FiscalExecutionMetadata} from "../calculator/date-policy"
import {paymentPeriods} from "../calculator/form"
import {formatMxn,formatSignedMxn} from "../calculator/format"
import {inverseStatus,assertDocumentOutcome} from "../documents/presentation-v1"
import {executionReceipt,assertDocumentExecutionMetadata,type ExecutionDocumentProvenance} from "../documents/provenance"
import type {StoredFiscalSnapshot} from "../storage/snapshot"
import {storageBuildIdentity} from "../storage/snapshot"
import type {ExternalDocumentSummary} from "../documents/presentation-v3"
import {externalPresentationSummary as externalDocumentSummary,isCompatDocument} from '../documents/presentation-document-compat'
import {compatOutcomeView,type CompatOutcomeView} from '../documents/compat-outcome-view'
import {originalDocumentIdentity,readOriginalDocument,type OriginalDocumentIdentity} from '../documents/original-document'
import {compatClassification} from '../documents/presentation-compat-v1'
import type {CompatClassification} from '../documents/contracts-compat-v1'

export type DocumentAmount=Readonly<{raw:string|null;display:string;known:boolean}>
export const documentAmount=(raw:string|null,signed=false):DocumentAmount=>Object.freeze({raw,display:raw===null?"—":signed?formatSignedMxn(raw):formatMxn(raw),known:raw!==null})
type Source=Readonly<{origin:"current"|"history"|"verified-fixture";executionId:string|null;capture:FiscalCapture;outcome:FiscalOutcome;execution:FiscalExecutionMetadata;versions:StoredFiscalSnapshot["versions"];fiscalPackage:StoredFiscalSnapshot["fiscalPackage"];executionProvenance?:ExecutionDocumentProvenance;externalDocument?:ExternalDocumentSummary;originalDocument?:OriginalDocumentIdentity;compatDetails?:CompatOutcomeView;documentClassification?:CompatClassification}>
function immutable<T>(value:T):T{if(value&&typeof value==="object"){Object.values(value).forEach(immutable);Object.freeze(value)}return value}
export function createPdfModel(source:Source){
 const original=structuredClone(source),{outcome,capture}=original,p=outcome.presentation
 try{
  if((capture.form.mode==="gross-to-net")!==(outcome.kind==="direct")||p.kind!==outcome.kind||original.execution.fiscalDate!==capture.form.effectiveDate||outcome.report.operation!==capture.form.mode)throw new Error("direction")
  // La misma comprobación de fidelidad que Historial: proyección del reporte,
  // no impuestos, sin reemplazar la presentación ni consultar tablas actuales.
   assertDocumentOutcome(outcome,capture.form.effectiveDate)
   const hosts=new Set(["www.sat.gob.mx","sat.gob.mx","www.dof.gob.mx","dof.gob.mx","sidof.segob.gob.mx","www.imss.gob.mx","imss.gob.mx","www.inegi.org.mx","inegi.org.mx","www.diputados.gob.mx","www.gob.mx","gob.mx"])
   for(const source of outcome.report.provenance.sources){const url=new URL(source.url);if(url.protocol!=="https:"||!hosts.has(url.hostname)||url.username||url.password||url.port)throw new Error("source")}
  const requested=outcome.report.operation==="gross-to-net"?outcome.report.gross.amount:outcome.report.targetNet
  if(requested!==null&&formatMxn(capture.form.amount)!==formatMxn(requested))throw new Error("request")
 }catch{throw new Error("INCOMPATIBLE_DOCUMENT_SOURCE")}
 const inverse=p.inverse
  const conditionalInverseV2=outcome.report.operation==='net-to-gross'&&outcome.report.recommendedForwardResult?.retention.assessment?.state==='conditional'
  const state=inverse?inverseStatus(inverse,p.fiscalStatus)+(conditionalInverseV2?' Candidato mínimo bajo hipótesis mensual no verificada.':''):outcome.report.operation==='gross-to-net'&&outcome.report.retention.assessment?.state==='outside-profile'?'Contexto fuera del perfil: no se determina retención ni neto.':p.confirmation?"Condición fiscal pendiente: ISR retenido y neto no determinados.":outcome.report.operation==="gross-to-net"&&outcome.report.retention.kind==="conditional-no-withholding-LISR-96"?"Simulación estimada condicionada a hipótesis mensual no verificada.":p.determination==="complete-estimate"?"Simulación estimada; no homologada con SUA/CONTPAQi.":"Resultado no determinable; se conservan los valores desconocidos."
 return immutable({schemaVersion:"nomina-pdf-probe-v1" as const,original,
  title:"Calculadora de Nómina",nature:"Simulación estimada",disclaimer:"No es CFDI de nómina",
  referenceDate:{raw:capture.form.effectiveDate,display:capture.form.effectiveDate.split("-").reverse().join("/")},
  period:{raw:capture.form.period,display:paymentPeriods.find(v=>v.value===capture.form.period)?.label??"Periodo no determinado"},
  area:{raw:capture.area,display:capture.area==="general-zone"?"General":"Zona no determinada"},includeImss:capture.form.includeImss,
  benefits:{bonusDays:capture.form.bonusDays,vacationDays:capture.form.vacationDays,vacationPremium:capture.form.vacationPremium},
  direction:capture.form.mode==="gross-to-net"?"Bruto a Neto":"Neto a Bruto",state:original.compatDetails?`Resultado global: ${original.compatDetails.globalLabel}. ${original.compatDetails.candidateLabel}. ${state}`:state,
  amounts:{requested:documentAmount(capture.form.amount),gross:documentAmount(p.values.grossSalary),net:documentAmount(p.values.netSalary),isr:documentAmount(p.values.isr),imss:documentAmount(p.values.workerImss),subsidy:documentAmount(p.subsidy.applied)},
  inverse:inverse?{original:inverse,target:documentAmount(inverse.targetNet),obtained:documentAmount(inverse.obtainedNet),difference:documentAmount(inverse.difference,true),alternatives:inverse.alternatives.map(c=>({original:c,gross:documentAmount(c.gross),net:documentAmount(c.net),difference:documentAmount(c.difference,true)}))}:null,
  confirmation:p.confirmation,warnings:p.warnings,issues:p.issues,references:outcome.report.provenance.sources,
 })
}
export type PdfDocumentModel=ReturnType<typeof createPdfModel>
export function documentFromCurrent(getState:()=>CalculationState,execution:FiscalExecutionMetadata){const state=getState();if(state.phase!=="result"||!state.snapshot||!state.outcome||state.requestId!==execution.requestId||!execution.completedAt)throw new Error("STALE_OR_INCOMPLETE_DOCUMENT");const provenance=executionReceipt(state);if(state.executionProvenance&&!provenance)throw new Error("STALE_OR_INCOMPLETE_DOCUMENT");assertDocumentExecutionMetadata(state,execution);return createPdfModel({origin:"current",executionId:null,capture:state.snapshot,outcome:state.outcome,execution,versions:provenance?.versions??{application:storageBuildIdentity.applicationVersion,engine:storageBuildIdentity.engineVersion},fiscalPackage:provenance?.fiscalPackage??storageBuildIdentity.fiscalPackage,...(provenance?{executionProvenance:provenance}:{})})}
function documentFromOriginal(snapshot:StoredFiscalSnapshot,origin:Source['origin']){
 const identity=originalDocumentIdentity(snapshot),compat=isCompatDocument(snapshot)
 if(compat&&!identity)throw new Error('INCOMPATIBLE_DOCUMENT_SOURCE: ORIGINAL_WIRE_REQUIRED')
 return createPdfModel({origin,executionId:snapshot.executionId,capture:snapshot.capture,outcome:snapshot.outcome,execution:snapshot.execution,versions:snapshot.versions,fiscalPackage:snapshot.fiscalPackage,
  ...(snapshot.schemaVersion===2?{executionProvenance:snapshot.executionProvenance}:snapshot.schemaVersion===3?{externalDocument:externalDocumentSummary(snapshot)}:{}),
  ...(identity?{originalDocument:identity}:{}),...(compat?{compatDetails:compatOutcomeView(snapshot.outcome,snapshot.capture.form.effectiveDate),documentClassification:compatClassification(snapshot)}:{})})
}
export function documentFromHistory(snapshot:StoredFiscalSnapshot){return documentFromOriginal(snapshot,'history')}
/** A read-only RAM/QA preview, explicitly NOT a stored record or an authority. */
export function documentFromPreview(wire:string){const s=readOriginalDocument(wire);return documentFromOriginal(s,s.schemaVersion===3&&s.documentKind==='qa-document-fixture'?'verified-fixture':'current')}
