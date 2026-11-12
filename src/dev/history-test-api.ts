// Doble exclusivo de pruebas/Edge visual. No persistencia ni fallback del producto.
import { decodeFiscalSnapshot, encodeFiscalSnapshot, type StoredFiscalSnapshot } from "../features/storage/snapshot"
import { LocalStorageFailure, type HistoryCursor, type HistoryItem, type LocalPreferences } from "../features/storage/storage-api"
import type { HistoryApi } from "../features/history/history-controller"

export function testUuid(n:number){return `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`}
export function deferred<T>(){let resolve!:(value:T)=>void;let reject!:(e:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
export function createHistoryTestApi(initial:readonly StoredFiscalSnapshot[]=[],enabled=false){
  let epoch=1,preferences:LocalPreferences={theme:"light",historyAutoSave:enabled}
  const records=new Map(initial.map(s=>[s.executionId,encodeFiscalSnapshot(s)])),deleted=new Set<string>()
  const control={writes:0,gets:0,beginCalls:0,failWrites:false,holdWrite:null as Promise<unknown>|null,holdRead:null as Promise<unknown>|null,holdPreferences:null as Promise<unknown>|null}
  const generation=()=>testUuid(epoch)
  const failure=(code:"STALE_GENERATION"|"DELETED_EXECUTION"|"AUTO_SAVE_DISABLED"|"IO_ERROR"|"DUPLICATE_CONFLICT")=>new LocalStorageFailure(code,`Error de prueba: ${code}`)
  const item=(s:StoredFiscalSnapshot):HistoryItem=>{const r=s.outcome.report;return{executionId:s.executionId,direction:s.capture.form.mode,requestedAmount:s.capture.form.amount,periodicity:s.capture.form.period as HistoryItem["periodicity"],completedAt:s.execution.completedAt!,referenceDate:s.capture.form.effectiveDate,classification:r.operation==="net-to-gross"&&r.coverage.state==="limited"?"limited":s.outcome.presentation.confirmation||s.outcome.presentation.warnings.some(w=>w.code==="MONTHLY_MINIMUM_CONDITION_ASSUMED")?"conditioned":r.operation==="net-to-gross"&&r.match==="approximate"?"approximate":r.operation==="net-to-gross"?"exact":"estimated",gross:s.outcome.presentation.values.grossSalary,net:s.outcome.presentation.values.netSalary}}
  async function insert(session:{generation:string},snapshot:StoredFiscalSnapshot,automatic:boolean){
    if(control.holdWrite)await control.holdWrite
    if(control.failWrites)throw failure("IO_ERROR")
    if(session.generation!==generation())throw failure("STALE_GENERATION")
    if(automatic&&!preferences.historyAutoSave)throw failure("AUTO_SAVE_DISABLED")
    if(deleted.has(snapshot.executionId))throw failure("DELETED_EXECUTION")
    const payload=encodeFiscalSnapshot(snapshot),old=records.get(snapshot.executionId)
    if(old&&old!==payload)throw failure("DUPLICATE_CONFLICT")
    if(!old){records.set(snapshot.executionId,payload);control.writes++}
    return{executionId:snapshot.executionId,inserted:!old}
  }
  const api:HistoryApi={
    info:async()=>({schemaVersion:2,databasePath:"test-only-memory",generation:generation(),encrypted:false}),
    beginWrite:async()=>{control.beginCalls++;return{generation:generation()}},
    insert:(s,p)=>insert(s,p,false),insertAutomatic:(s,p)=>insert(s,p,true),
    list:async(limit=30,cursor:HistoryCursor|null=null)=>{
      if(control.holdRead)await control.holdRead
      if(cursor&&cursor.generation!==generation())throw failure("STALE_GENERATION")
      const all=[...records.values()].map(p=>item(decodeFiscalSnapshot(p))).sort((a,b)=>b.completedAt.localeCompare(a.completedAt)||b.executionId.localeCompare(a.executionId)).filter(s=>!cursor||s.completedAt<cursor.completedAt||(s.completedAt===cursor.completedAt&&s.executionId<cursor.executionId))
      const items=all.slice(0,limit),last=items.at(-1)
      return{items,nextCursor:all.length>limit&&last?{completedAt:last.completedAt,executionId:last.executionId,generation:generation()}:null,generation:generation()}
    },
    get:async id=>{control.gets++;const payload=records.get(id);if(control.holdRead)await control.holdRead;return payload?decodeFiscalSnapshot(payload):null},
    delete:async id=>{deleted.add(id);return{deleted:records.delete(id)}},
    clear:async()=>{epoch++;records.clear();deleted.clear();return{generation:generation()}},
    getPreferences:async()=>{if(control.holdPreferences)await control.holdPreferences;return preferences},
    setPreferences:async patch=>{if(patch.historyAutoSave===false)epoch++;preferences={...preferences,...patch};return preferences},
    recoverCorrupt:async()=>({quarantinePath:"test-only",generation:generation()}),
  }
  return{api,control,records,getPreferences:()=>preferences}
}
