import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "@/app/App"
import { createCalculationController } from "@/features/calculator/calculation-controller"
import { createFiscalAdapter,presentInverseFiscalResult,type PreparedInverse,type InverseFiscalOutcome } from "@/features/calculator/fiscal-adapter"
import { calculateStandardEstimatedNetToGross } from "@/domain/payroll/net-to-gross"
import { standardGrossToNetContext2026 } from "@/infrastructure/fiscal/2026"
import { createHistoryController, type HistoryController } from "@/features/history/history-controller"
import { createNativeStorageApi } from "@/features/storage/storage-api"
import { decodeFiscalSnapshot,encodeFiscalSnapshot } from "@/features/storage/snapshot"
import { createHistoryTestApi,testUuid,deferred } from "./history-test-api"
import fixtures from "../../src-tauri/src/storage/fixtures.json"
import "@/app/styles.css"
import { createThemeController, type ThemeController } from "@/features/theme/theme-controller"
import {createPdfExportController,type PdfExportController} from "@/features/pdf/export-controller"
import {savePdfReport} from "@/features/pdf/native-save"
import type {renderSalaryReport} from "@/features/pdf/render-report"
import {systemClock} from "@/features/calculator/date-policy"
if(!import.meta.env.DEV)throw new Error("Verificación exclusiva de desarrollo")
const native=Boolean((window as Window&{__TAURI_INTERNALS__?:unknown}).__TAURI_INTERNALS__)
const memory=createHistoryTestApi(),api=native?createNativeStorageApi():memory.api
let history:HistoryController
let fiscal:ReturnType<typeof createCalculationController>
let inverseCalls=0
const pending:{request:PreparedInverse;signal?:AbortSignal;resolve:(o:InverseFiscalOutcome)=>void}[]=[]
const scenario=new URLSearchParams(location.search).get("case")
const fiscalClock=scenario==="past-year"?()=>new Date("2028-03-04T12:00:00.000Z"):systemClock
function createFiscal(){
  const real=createFiscalAdapter()
  fiscal=createCalculationController({...real,inverse:async(request,signal)=>{
    inverseCalls++
    if(scenario==="deferred")return new Promise<InverseFiscalOutcome>(resolve=>pending.push({request,signal,resolve}))
    if(scenario==="approximate"||scenario==="limited"){
      const report=await calculateStandardEstimatedNetToGross({...request.input,searchOptions:scenario==="approximate"?{grossRange:{from:"6216.15",to:"6216.16"},signal}:{grossRange:{from:"15000.00",to:"50000.00"},maxEvaluations:3,signal}},standardGrossToNetContext2026())
      return{kind:"inverse",report,presentation:presentInverseFiscalResult(report,request.input.referenceDate)}
    }
    return real.inverse(request,signal)
  }})
  return fiscal
}
function createHistory(){history=createHistoryController({api});return history}
let pdfExport:PdfExportController
const exportQa={calls:0,hold:null as Promise<void>|null,release:null as (()=>void)|null,result:"saved" as "saved"|"cancelled"|"error",exportedAt:"2028-03-04T12:00:00.000Z",fixedId:null as string|null,last:null as ReturnType<typeof renderSalaryReport>|null,
 holdRuntime(){const gate=deferred<void>();this.hold=gate.promise;this.release=()=>{this.hold=null;gate.resolve()}},get bytes(){return this.last?Array.from(this.last.bytes):null},get state(){return pdfExport.getState()},
 async seedOriginal(){const original=decodeFiscalSnapshot(fixtures.find(f=>f.name==="inverse-exact")!.payload),snapshot={...original,executionId:testUuid(5111),versions:native?original.versions:{application:"0.0.9-original",engine:"motor-original-preservado-2026"}};await api.insert(await api.beginWrite(),snapshot);await history.loadFirst();return snapshot.executionId},
 async payload(id:string){const snapshot=await api.get(id);return snapshot?encodeFiscalSnapshot(snapshot):null},
}
function createPdfExport(){pdfExport=createPdfExportController({clock:()=>new Date(exportQa.exportedAt),newId:()=>exportQa.fixedId??crypto.randomUUID(),loadRuntime:async()=>{if(exportQa.hold)await exportQa.hold;const real=await import("@/features/pdf/export-runtime").then(m=>m.loadReportRuntime());return{render:report=>{const generated=real.render(report);exportQa.last=generated;return generated}}},save:async(bytes,name)=>{exportQa.calls++;if(native)return savePdfReport(bytes,name);if(exportQa.result==="error")throw new Error("Error de escritura controlado solo en Edge.");return exportQa.result==="cancelled"?{status:"cancelled"}:{status:"saved",path:`Edge-prueba/${name}`,bytes:bytes.length,sha256:"mock-only-edge"}}});return pdfExport}
let theme:ThemeController
const themeQa={readFault:"none" as "none"|"missing"|"invalid"|"error",failWrite:false,writes:[] as {theme:"light"|"dark"}[]}
function createTheme(){theme=createThemeController({api:{getPreferences:async()=>{
  if(!native&&themeQa.readFault==="error")throw new Error("synthetic preferences read")
  const preferences=await api.getPreferences()
  if(!native&&themeQa.readFault==="missing")return{historyAutoSave:preferences.historyAutoSave}
  if(!native&&themeQa.readFault==="invalid")return{...preferences,theme:"system"}
  return preferences
},setPreferences:async patch=>{themeQa.writes.push(patch);if(!native&&themeQa.failWrite)throw new Error("synthetic preferences write");return api.setPreferences(patch)}}});window.__themeVerification=theme;return theme}
const verification={native,api,fixtures,
  get history(){return history},get fiscal(){return fiscal},get calls(){return inverseCalls},get pending(){return pending.map(p=>({aborted:p.signal?.aborted??false}))},
  async resolve(index:number){const p=pending[index];p.resolve(await createFiscalAdapter().inverse(p.request))},
  async seed(count=25){const lease=await api.beginWrite();for(let i=0;i<count;i++){const original=decodeFiscalSnapshot(fixtures[i%fixtures.length].payload);const s={...original,executionId:testUuid(1000+i),execution:{...original.execution,completedAt:`2026-02-01T12:01:${String(i%60).padStart(2,"0")}.000Z`}};await api.insert(lease,s)}await history.loadFirst()},
  async corruptView(){if(native)throw new Error("Solo doble de Edge");const row=memory.records.entries().next().value;if(!row)return;const s=decodeFiscalSnapshot(row[1]);memory.records.set(row[0],encodeFiscalSnapshot({...s,outcome:{...s.outcome,presentation:{...s.outcome.presentation,warnings:[]}}}));await history.loadFirst()},
  holdWrites(){if(native)throw new Error("Solo doble de Edge");const d=deferred<void>();memory.control.holdWrite=d.promise;return()=>{memory.control.holdWrite=null;d.resolve()}},
  failHistoryWrites(value:boolean){if(native)throw new Error("Solo doble de Edge");memory.control.failWrites=value},
}
declare global{interface Window{__historyVerification:typeof verification;__themeVerification:ThemeController;__themeQa:typeof themeQa;__pdfExportVerification:typeof exportQa}}
window.__historyVerification=verification
window.__themeQa=themeQa
window.__pdfExportVerification=exportQa
createRoot(document.getElementById("root")!).render(<StrictMode><App createController={createFiscal} clock={fiscalClock} createHistory={createHistory} createTheme={createTheme} createPdfExport={createPdfExport}/></StrictMode>)
