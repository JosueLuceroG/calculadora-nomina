import type {PdfDocumentModel} from "./document-model"
import {createSalaryReport,defaultReportFilename} from "./report-model"
import {savePdfReport,type PdfSaveResult} from "./native-save"
import type {loadReportRuntime} from "./export-runtime"

type Runtime=Awaited<ReturnType<typeof loadReportRuntime>>
export type PdfExportState=Readonly<{busy:boolean;phase:"idle"|"preparing"|"saving"|"saved"|"cancelled"|"obsolete"|"error";source:"current"|"history"|null;message:string}>
export const initialPdfExportState:PdfExportState=Object.freeze({busy:false,phase:"idle",source:null,message:""})
let runtime:Promise<Runtime>|null=null
const defaultRuntime=()=>runtime??=import("./export-runtime").then(m=>m.loadReportRuntime()).catch(e=>{runtime=null;throw e})
export function createPdfExportController({loadRuntime=defaultRuntime,save=savePdfReport,clock=()=>new Date(),newId=()=>crypto.randomUUID()}:{loadRuntime?:()=>Promise<Runtime>;save?:(bytes:Uint8Array,name:string)=>Promise<PdfSaveResult>;clock?:()=>Date;newId?:()=>string}={}){
 let state=initialPdfExportState,disposed=false
 const listeners=new Set<(s:PdfExportState)=>void>()
 function publish(patch:Partial<PdfExportState>){if(disposed)return;state=Object.freeze({...state,...patch});for(const f of [...listeners])f(state)}
 async function exportPdf({source,getDocument,isCurrent}:{source:"current"|"history";getDocument:()=>PdfDocumentModel|Promise<PdfDocumentModel>;isCurrent:()=>boolean}){
  if(disposed||state.busy)return false
  publish({busy:true,phase:"preparing",source,message:"Preparando el reporte PDF…"})
  try{
   if(!isCurrent())throw new Error("PDF_SOURCE_CHANGED")
   const document=await getDocument();if(!isCurrent())throw new Error("PDF_SOURCE_CHANGED");const exportedAt=clock(),report=createSalaryReport(document,{exportedAt,reportId:newId()})
   const ready=await loadRuntime();if(disposed)return false
   if(!isCurrent())throw new Error("PDF_SOURCE_CHANGED")
   const generated=ready.render(report)
   if(!isCurrent())throw new Error("PDF_SOURCE_CHANGED")
   publish({phase:"saving",message:"Elige nombre y ubicación en el diálogo de Windows."})
   const result=await save(generated.bytes,defaultReportFilename(exportedAt));if(disposed)return false
   if(result.status==="cancelled")publish({busy:false,phase:"cancelled",message:"Exportación cancelada. No se guardó un PDF."})
   else publish({busy:false,phase:"saved",message:`Reporte PDF guardado en ${result.path}`})
   return true
  }catch(e){if(disposed)return false;const message=e instanceof Error?e.message:"No se pudo exportar el reporte PDF.";if(message==="PDF_SOURCE_CHANGED")publish({busy:false,phase:"obsolete",message:"El resultado o la selección cambió antes de guardar. No se exportó un PDF."});else publish({busy:false,phase:"error",message:/INCOMPATIBLE_DOCUMENT_SOURCE|STALE_OR_INCOMPLETE_DOCUMENT/.test(message)?"No se puede representar fielmente este resultado. No se guardó ningún PDF.":message});return false}
 }
 return Object.freeze({getState:()=>state,subscribe:(f:(s:PdfExportState)=>void)=>{listeners.add(f);return()=>{listeners.delete(f)}},exportPdf,dismiss:()=>{if(!state.busy)publish({...initialPdfExportState})},dispose:()=>{disposed=true;listeners.clear()}})
}
export type PdfExportController=ReturnType<typeof createPdfExportController>
