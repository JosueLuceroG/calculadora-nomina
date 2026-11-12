// Integration-only WebView2 entry. All issuance, sealing and writes use real IPC.
import {createFiscalExecutionApi} from '../src/features/calculator/fiscal-execution-api'
import {prepareExternalExecution} from '../src/features/calculator/prepared-external-execution'
import type {FiscalCapture} from '../src/features/calculator/fiscal-adapter'
import {jcs} from '../src/features/documents/evidence-v3'
let dropReply=false
const api=createFiscalExecutionApi(undefined,async<T>(command:string,args:any):Promise<T>=>{const result=await (globalThis as any).window.__TAURI_INTERNALS__.invoke(command,args);if(dropReply){dropReply=false;throw Error('Integration probe deliberately discarded native response after real commit')}return result})
const held=new Map<string,Awaited<ReturnType<typeof prepareExternalExecution>>>()
export async function hold(capture:FiscalCapture,referenceMode:'manual'|'automatic'='manual'){
 const selection=await api.source(),scenario={kind:'contextual-retention-2026-v2' as const,salaryBasis:'fixed-period' as const,monthlyCondition:'unknown' as const,referenceMonth:capture.form.effectiveDate.slice(0,7)}
 const reference=await api.prepare(capture,scenario,selection,701,crypto.randomUUID(),referenceMode),execution=await prepareExternalExecution(api,reference)
 held.set(reference.state.executionId,execution)
 return {executionId:reference.state.executionId,handle:reference.state.handle,context:execution.provider.material.context}
}
export async function complete(id:string){const e=held.get(id);if(!e)throw Error('UNKNOWN_OWNED_EXECUTION');const outcome=await e.calculate();return {state:await api.complete(e.reference,outcome),outcome}}
export async function finalize(id:string){const e=held.get(id);if(!e)throw Error('UNKNOWN_OWNED_EXECUTION');return api.finalize(e.reference)}
export async function store(id:string,route:'manual'|'automatic'){const e=held.get(id);if(!e)throw Error('UNKNOWN_OWNED_EXECUTION');return api.store(e.reference,route)}
export async function cancel(id:string){const e=held.get(id);if(!e)throw Error('UNKNOWN_OWNED_EXECUTION');return api.cancel(e.reference)}
export const reconcile=api.reconcile
export function discardNextStoreReply(){dropReply=true}
export function recorded(id:string){const e=held.get(id);if(!e)throw Error('UNKNOWN_OWNED_EXECUTION');return {state:e.reference.state,materialWire:jcs(e.provider.material)}}
