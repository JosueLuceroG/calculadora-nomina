// Integration-only entry. Uses the very same native API and owned runner that
// the application controller uses; no from-JSON engine context or fake lease.
import {createFiscalExecutionApi} from '../src/features/calculator/fiscal-execution-api'
import {prepareExternalExecution} from '../src/features/calculator/prepared-external-execution'
import type {FiscalCapture} from '../src/features/calculator/fiscal-adapter'
const api=createFiscalExecutionApi()
const held=new Map<string,Awaited<ReturnType<typeof prepareExternalExecution>>>()
export async function hold(capture:FiscalCapture){const selection=await api.source(),scenario={kind:'contextual-retention-2026-v2' as const,salaryBasis:'fixed-period' as const,monthlyCondition:'unknown' as const,referenceMonth:capture.form.effectiveDate.slice(0,7)},ref=await api.prepare(capture,scenario,selection,501,crypto.randomUUID()),execution=await prepareExternalExecution(api,ref);held.set(ref.state.executionId,execution);return {executionId:ref.state.executionId,context:execution.provider.material.context}}
export async function run(id:string){const e=held.get(id);if(!e)throw Error('UNKNOWN_OWNED_EXECUTION');const outcome=await e.calculate();const state=await api.complete(e.reference,outcome);return {state,outcome,context:e.provider.material.context}}
export async function cancel(id:string){const e=held.get(id);if(e){held.delete(id);return api.cancel(e.reference)}}
