// Preparación de datos exclusiva de la prueba. El generador PDF no importa este módulo.
import fixtures from "../../src-tauri/src/storage/fixtures.json"
import oracle from "../tests/fixtures/operational-4b1.expected.json"
import {decodeFiscalSnapshot,type StoredFiscalSnapshot} from "../features/storage/snapshot"
import {createFiscalAdapter,presentDirectFiscalResult,type FiscalCapture,type FiscalOutcome} from "../features/calculator/fiscal-adapter"
import {createPdfModel,documentFromHistory,type PdfDocumentModel} from "../features/pdf/document-model"
import type {CaptureForm} from "../features/calculator/form"

const snapshots=Object.fromEntries(fixtures.map(f=>[f.name,decodeFiscalSnapshot(f.payload)]))
let preparationCalls=0
function model(snapshot:StoredFiscalSnapshot,outcome=snapshot.outcome,capture=snapshot.capture){return createPdfModel({origin:"verified-fixture",executionId:snapshot.executionId,capture,outcome,execution:snapshot.execution,versions:snapshot.versions,fiscalPackage:snapshot.fiscalPackage})}
function forwardModel(snapshot:StoredFiscalSnapshot){if(snapshot.outcome.report.operation!=="net-to-gross"||!snapshot.outcome.report.recommendedForwardResult)throw new Error("MISSING_ORIGINAL_FORWARD_REPORT");const report=snapshot.outcome.report.recommendedForwardResult;const capture: FiscalCapture={...snapshot.capture,form:{...snapshot.capture.form,mode:"gross-to-net",amount:report.gross.amount!}};return model(snapshot,{kind:"direct",report,presentation:presentDirectFiscalResult(report)},capture)}
export function mainVerifiedPdfModel(){const doc=forwardModel(snapshots["inverse-exact"]),expected=oracle.direct.find(c=>c.id==="M01-on")!.expected.components;if(doc.amounts.gross.raw!==expected.gross||doc.amounts.isr.raw!==expected.isrWithheld||doc.amounts.imss.raw!==expected.imssDeducted||doc.amounts.net.raw!==expected.net)throw new Error("PDF_FIXTURE_DOES_NOT_MATCH_M01");return doc}
export type PdfProbeCase={id:string;label:string;model:PdfDocumentModel}
let cached:Promise<PdfProbeCase[]>|null=null
export const getPdfPreparationCalls=()=>preparationCalls
export function loadPdfProbeCases(){return cached??=prepareCases()}
async function prepareCases():Promise<PdfProbeCase[]>{
 const base=snapshots["inverse-exact"],adapter=createFiscalAdapter()
 async function run(form:CaptureForm):Promise<FiscalOutcome>{const prepared=adapter.prepare({area:"general-zone",form});if(!prepared.ok)throw new Error("INVALID_PDF_PROBE_FIXTURE");preparationCalls++;return prepared.prepared.mode==="gross-to-net"?adapter.direct(prepared.prepared):adapter.inverse(prepared.prepared)}
 const weekly=oracle.inverse.find(c=>c.id==="M09-week")!,request=weekly.request
 const weeklyCapture:FiscalCapture={area:"general-zone",form:{...base.capture.form,mode:"net-to-gross",amount:request.targetNet,period:request.periodicity as CaptureForm["period"],effectiveDate:request.date}}
 const weeklyOutcome=await run({...weeklyCapture.form})
 if(weeklyOutcome.report.operation!=="net-to-gross"||!weekly.expectedCandidates.every(e=>weeklyOutcome.report.operation==="net-to-gross"&&weeklyOutcome.report.exactCandidates.some(c=>c.gross===e.gross&&c.net===e.net)))throw new Error("M09_ALTERNATIVES_NOT_VERIFIED")
 const minimum=snapshots["direct-conditioned"],pending=await run({...minimum.capture.form}),unprovenCapture:FiscalCapture={...minimum.capture,form:{...minimum.capture.form,mode:"net-to-gross"}},unproven=await run({...unprovenCapture.form})
 return[
  {id:"directo",label:"Bruto a Neto · M01-on verificado",model:mainVerifiedPdfModel()},
  {id:"inverso-exacto",label:"Neto a Bruto exacto · snapshot original",model:documentFromHistory(base)},
  {id:"alternativas",label:"Inverso semanal con dos alternativas M09-week",model:model(base,weeklyOutcome,weeklyCapture)},
  {id:"aproximado",label:"Resultado aproximado original",model:documentFromHistory(snapshots["inverse-approximate"])},
  {id:"limitado",label:"Búsqueda limitada original",model:documentFromHistory(snapshots["inverse-limited"])},
  {id:"pendiente-desconocido",label:"Condición pendiente · ISR/neto desconocidos",model:model(minimum,pending)},
  {id:"encontrado-sin-minimo",label:"Bruto encontrado sin mínimo demostrado",model:model(minimum,unproven,unprovenCapture)},
  {id:"condicionado",label:"Hipótesis mensual confirmada original",model:documentFromHistory(minimum)},
 ]
}
