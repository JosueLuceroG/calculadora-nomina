import type { CalculationState } from "../calculator/calculation-controller"
import type { FiscalExecutionMetadata } from "../calculator/date-policy"
import { createStoredFiscalSnapshot, type StoredFiscalSnapshot } from "../storage/snapshot"
import { createNativeStorageApi, LocalStorageFailure, type HistoryCursor, type HistoryItem, type HistoryWriteSession } from "../storage/storage-api"
import { assertHistoricalPresentation } from "./historical-snapshot"

export type HistoryApi=ReturnType<typeof createNativeStorageApi>
export type SaveNotice=Readonly<{ status:"saving"|"saved"|"not-saved"|"error"; message:string }>
export type HistoryState=Readonly<{
  preferenceStatus:"loading"|"ready"|"error"; autoSave:boolean; preferenceBusy:boolean; storageError:string|null;
  items:readonly HistoryItem[]; nextCursor:HistoryCursor|null; listLoading:boolean; listLoaded:boolean; listError:string|null;
  selectedId:string|null; selected:StoredFiscalSnapshot|null; detailLoading:boolean; detailError:string|null;
  mutationBusy:boolean; notices:Readonly<Record<number,SaveNotice>>;
}>
type Run={ id:string; session:HistoryWriteSession|null; consentRevision:number; saveRevision:number; completed:boolean }
const errorText=(e:unknown)=>e instanceof LocalStorageFailure ? e.message : "No se pudo completar la operación del Historial local."

export function autoSaveEligible(state:CalculationState):boolean {
  if(state.phase!=="result"||!state.snapshot||!state.outcome)return false
  const {report,presentation}=state.outcome
  if(presentation.confirmation!==null||presentation.values.grossSalary===null||presentation.values.netSalary===null)return false
  return report.operation==="gross-to-net" ? report.status==="estimated"&&report.complete : report.status==="estimated"&&report.recommended!==null&&report.recommendedForwardResult!==null&&report.match!=="none"&&report.metrics.stopReason!=="aborted"
}

/** Coordinación de UI/persistencia, no almacenamiento alternativo. Las decisiones
 * finales de consentimiento, generación, tombstones e idempotencia son SQLite. */
export function createHistoryController({api=createNativeStorageApi(),newId=()=>crypto.randomUUID()}:{api?:HistoryApi;newId?:()=>string}={}) {
  let state:HistoryState={preferenceStatus:"loading",autoSave:false,preferenceBusy:false,storageError:null,items:[],nextCursor:null,listLoading:false,listLoaded:false,listError:null,selectedId:null,selected:null,detailLoading:false,detailError:null,mutationBusy:false,notices:{}}
  let disposed=false,initialized=false,consentRevision=0,saveRevision=0,readRevision=0,listRequest=0,detailRequest=0,preferenceRead=0
  let clearFailure:string|null=null
  let session:HistoryWriteSession|null=null
  const runs=new Map<number,Run>(),deleted=new Set<string>(),listeners=new Set<(s:HistoryState)=>void>()
  function publish(patch:Partial<HistoryState>){if(disposed)return;state=Object.freeze({...state,...patch});for(const listener of [...listeners])listener(state)}
  function notice(requestId:number,value:SaveNotice){publish({notices:{...state.notices,[requestId]:Object.freeze(value)}})}
  async function initialize(){
    if(initialized||disposed||state.preferenceBusy)return;initialized=true
    const request=++preferenceRead,revision=consentRevision
    try {
      const preferences=await api.getPreferences();if(disposed||request!==preferenceRead||revision!==consentRevision)return
      const lease=await api.beginWrite();if(disposed||request!==preferenceRead||revision!==consentRevision)return
      session=lease;publish({preferenceStatus:"ready",autoSave:preferences.historyAutoSave,storageError:clearFailure})
    }catch(e){if(request!==preferenceRead||revision!==consentRevision)return;session=null;publish({preferenceStatus:"error",autoSave:false,storageError:clearFailure?`${clearFailure} ${errorText(e)}`:errorText(e)})}
  }
  function beginRun(requestId:number){
    if(disposed||runs.has(requestId))return
    const authorized=state.preferenceStatus==="ready"&&state.autoSave&&!state.preferenceBusy&&!state.mutationBusy&&session!==null
    let id:string
    try{id=newId()}catch{notice(requestId,{status:"error",message:"No se pudo preparar el guardado local. El cálculo fiscal no se modifica."});return}
    runs.set(requestId,{id,session:authorized?session:null,consentRevision,saveRevision,completed:false})
    // Nunca se adquiere una generación nueva al finalizar una ejecución vieja.
    if(!authorized)notice(requestId,{status:"not-saved",message:state.preferenceStatus==="error"?"Historial no disponible; este cálculo no se guarda. Consulta Historial para ver el error.":state.preferenceStatus==="loading"?"Historial aún no disponible al iniciar; este cálculo no se guardará.":"Guardado automático desactivado para esta ejecución."})
    if(runs.size>100){for(const [id,run]of runs){if(run.completed&&id!==requestId){runs.delete(id);if(runs.size<=80)break}}}
  }
  async function finishRun(getCurrentState:()=>CalculationState,requestId:number,execution:FiscalExecutionMetadata){
    const run=runs.get(requestId)
    if(!run||run.completed||disposed)return;run.completed=true
    if(!autoSaveEligible(getCurrentState())){notice(requestId,{status:"not-saved",message:"No se guarda: el resultado está bloqueado, no es utilizable o requiere confirmación fiscal."});return}
    if(!run.session||run.consentRevision!==consentRevision||run.saveRevision!==saveRevision||!state.autoSave||deleted.has(run.id)){
      if(run.session)notice(requestId,{status:"not-saved",message:"No guardado: el consentimiento o el historial cambió durante esta ejecución."})
      return
    }
    let snapshot:StoredFiscalSnapshot
    try {snapshot=createStoredFiscalSnapshot({getCurrentState,expectedRequestId:requestId,executionId:run.id,execution})}
    catch {notice(requestId,{status:"not-saved",message:"La ejecución cambió antes de capturar el resultado; no se guardó."});return}
    notice(requestId,{status:"saving",message:"Guardando en este equipo…"})
    try {
      await api.insertAutomatic(run.session,snapshot)
      if(disposed)return
      if(run.saveRevision!==saveRevision||deleted.has(run.id)){notice(requestId,{status:"not-saved",message:"El registro fue eliminado; no se restaura por una respuesta pendiente."});return}
      notice(requestId,{status:"saved",message:"Cálculo guardado en este equipo."})
      if(state.listLoaded)void loadFirst()
    }catch(e){
      const code=e instanceof LocalStorageFailure?e.code:null
      notice(requestId,{status:code==="STALE_GENERATION"||code==="DELETED_EXECUTION"||code==="AUTO_SAVE_DISABLED"?"not-saved":"error",message:code==="STALE_GENERATION"||code==="DELETED_EXECUTION"||code==="AUTO_SAVE_DISABLED"?"No guardado: se desactivó el guardado o se eliminó el registro/historial.":"No se pudo guardar en este equipo. El resultado fiscal sigue siendo válido."})
      // Solo prepara futuras ejecuciones, nunca reintenta el snapshot rechazado.
      if(code==="STALE_GENERATION"||code==="AUTO_SAVE_DISABLED"){session=null;initialized=false;void initialize()}
    }
  }
  async function setAutoSave(enabled:boolean){
    if(disposed||state.preferenceBusy||state.mutationBusy)return
    consentRevision++;preferenceRead++;session=null
    publish({preferenceBusy:true,autoSave:enabled?state.autoSave:false,storageError:clearFailure})
    try{
      const preferences=await api.setPreferences({historyAutoSave:enabled})
      const lease=await api.beginWrite();if(disposed)return
      session=lease;listRequest++
      publish({preferenceStatus:"ready",preferenceBusy:false,autoSave:preferences.historyAutoSave,listLoading:false})
      if(state.listLoaded)void loadFirst()
    }catch(e){publish({preferenceBusy:false,preferenceStatus:"error",autoSave:false,storageError:clearFailure?`${clearFailure} ${errorText(e)}`:errorText(e)})}
  }
  async function loadFirst(){
    if(disposed)return
    const request=++listRequest,revision=readRevision
    publish({listLoading:true,listError:null})
    try{const page=await api.list(20);if(disposed||request!==listRequest||revision!==readRevision)return
      publish({items:Object.freeze([...page.items]),nextCursor:page.nextCursor,listLoaded:true,listLoading:false})
    }catch(e){if(request===listRequest&&revision===readRevision)publish({listLoading:false,listLoaded:true,listError:errorText(e)})}
  }
  async function loadMore(){
    const cursor=state.nextCursor;if(!cursor||state.listLoading||disposed)return
    const request=++listRequest,revision=readRevision;publish({listLoading:true,listError:null})
    try{const page=await api.list(20,cursor);if(disposed||request!==listRequest||revision!==readRevision)return
      publish({items:Object.freeze([...state.items,...page.items.filter(item=>!state.items.some(old=>old.executionId===item.executionId))]),nextCursor:page.nextCursor,listLoading:false})
    }catch(e){if(request===listRequest&&revision===readRevision)publish({listLoading:false,listError:errorText(e)})}
  }
  async function open(id:string){
    const request=++detailRequest,revision=readRevision;publish({selectedId:id,selected:null,detailLoading:true,detailError:null})
    try{const snapshot=await api.get(id);if(disposed||request!==detailRequest||revision!==readRevision)return
      if(!snapshot){publish({detailLoading:false,detailError:"El registro ya no está disponible. No se recalculó ningún resultado."});return}
      assertHistoricalPresentation(snapshot)
      publish({selected:snapshot,detailLoading:false})
    }catch(e){if(request===detailRequest&&revision===readRevision)publish({detailLoading:false,detailError:errorText(e)})}
  }
  function closeDetail(){detailRequest++;publish({selectedId:null,selected:null,detailLoading:false,detailError:null})}
  async function remove(id:string){
    if(state.mutationBusy||disposed)return
    deleted.add(id);readRevision++;listRequest++;detailRequest++
    publish({mutationBusy:true,listLoading:false,detailLoading:false,storageError:clearFailure})
    try{await api.delete(id);if(disposed)return
      if(state.selectedId===id)closeDetail()
      for(const [request,run]of runs)if(run.id===id)notice(request,{status:"not-saved",message:"Registro eliminado del equipo."})
      publish({mutationBusy:false});await loadFirst()
    }catch(e){deleted.delete(id);publish({mutationBusy:false,storageError:clearFailure?`${clearFailure} ${errorText(e)}`:errorText(e)})}
  }
  async function clear(){
    if(state.mutationBusy||disposed)return
    saveRevision++;readRevision++;listRequest++;detailRequest++;session=null
    for(const [request]of runs)notice(request,{status:"not-saved",message:"El historial se borró; esta ejecución anterior no se vuelve a guardar."})
    publish({mutationBusy:true,listLoading:false,detailLoading:false,storageError:null})
    try{const lease=await api.clear();if(disposed)return;session=lease;closeDetail();clearFailure=null
      publish({mutationBusy:false,items:[],nextCursor:null,listLoaded:true,listError:null,storageError:null})
    }catch(e){clearFailure=`El borrado completo no ha concluido. ${errorText(e)}`;publish({mutationBusy:false,storageError:clearFailure});initialized=false;void initialize()}
  }
  return Object.freeze({getState:()=>state,subscribe:(listener:(s:HistoryState)=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}},initialize,beginRun,finishRun,setAutoSave,loadFirst,loadMore,open,closeDetail,remove,clear,
    retry:()=>{initialized=false;void initialize();void loadFirst()},
    getSelectedOriginalForExport:()=>state.selectedId===state.selected?.executionId&&!state.detailError?state.selected:null,
    dispose:()=>{disposed=true;listeners.clear();consentRevision++;saveRevision++},
  })
}
export type HistoryController=ReturnType<typeof createHistoryController>
