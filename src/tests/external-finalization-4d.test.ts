import {describe,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import {createFiscalExecutionApi,type Invoke,type SalaryInvoke} from '../features/calculator/fiscal-execution-api'
import {hashBytes} from '../features/documents/evidence-v3'
import {encodeFiscalSnapshot,decodeFiscalSnapshot} from '../features/storage/snapshot'
const record=JSON.parse(readFileSync(new URL('../../docs/evidence/5d3b4d/native-roundtrip.json',import.meta.url),'utf8'))
// Recorded genuine native QA output, with transport doubles ONLY for client
// fault/race tests. These doubles issue no native write authority.
function setup(){let document=structuredClone(record.document),salaryError:unknown=null,reconciled={executionId:document.executionId,checksum:document.documentSha256,status:'COMMITTED',stored:true,inserted:false,reason:null};const calls:string[]=[],salaryArgs:unknown[]=[],m=JSON.parse(record.materialWire),modes:unknown[]=[]
 const invoke:Invoke=async<T>(command:string,args:{request:unknown}):Promise<T>=>{calls.push(command);const request=args.request as any
  if(command==='fiscal_execution_prepare'){modes.push((args as any).referenceMode);return record.state as T}
  if(command==='fiscal_execution_material')return record.materialWire as T
  if(command==='fiscal_execution_complete'){expect(JSON.parse(request.resultWire)).toEqual({capture:m.capture,scenario:m.scenario,contextSha256:record.state.contextSha256,outcome:record.outcome});return {...record.completed,resultSha256:hashBytes(new TextEncoder().encode(request.resultWire)),resultBytes:new TextEncoder().encode(request.resultWire).length} as T}
  if(command==='fiscal_execution_finalize')return document as T
  if(command==='fiscal_execution_reconcile')return reconciled as T
  throw Error(command)
 }
 const salary:SalaryInvoke=async<T>(command:string,args:Parameters<SalaryInvoke>[1]):Promise<T>=>{calls.push(command);salaryArgs.push(args);if(salaryError)throw salaryError;return {...reconciled,inserted:true} as T}
 const api=createFiscalExecutionApi(invoke,salary)
 async function completed(mode:'manual'|'automatic'='manual'){const p=await api.prepare(m.capture,m.scenario,m.context.selection,record.state.requestId,record.state.clientRequestId,mode);await api.material(p);await api.complete(p,record.outcome);return p}
 return {api,calls,salaryArgs,modes,completed,set document(d:typeof document){document=d},get document(){return document},set salaryError(e:unknown){salaryError=e},set reconciled(r:typeof reconciled){reconciled=r}}
}
describe('4-D client association and transport recovery (explicit doubles, actual issuance tested on Windows)',()=>{
 it.each(['manual','automatic'] as const)('%s keeps exact finalized bytes, native authority reference and original salary generation',async route=>{const t=setup(),p=await t.completed(route),d=await t.api.finalize(p);expect(encodeFiscalSnapshot(decodeFiscalSnapshot(d.payload))).toBe(d.payload);expect(d.stored).toBe(false);await t.api.store(p,route);expect(t.calls.at(-1)).toBe(route==='manual'?'storage_insert':'storage_insert_automatic');expect(t.salaryArgs[0]).toEqual({generation:d.writeGeneration,payload:d.payload,authority:{handle:record.state.handle,expectedDocumentSha256:d.documentSha256}});expect(t.modes).toEqual([route])})
 it('does not persist complete results that have no finalized native document',async()=>{const t=setup(),p=await t.completed();await expect(t.api.store(p,'manual')).rejects.toMatchObject({code:'DOCUMENT_NOT_FINALIZED'});expect(t.salaryArgs).toEqual([])})
 it('rejects foreign JS references before finalization or storage IPC',async()=>{const t=setup();await expect(t.api.finalize({state:record.state} as any)).rejects.toMatchObject({code:'FOREIGN_EXECUTION_REFERENCE'});await expect(t.api.store({state:record.state} as any,'automatic')).rejects.toMatchObject({code:'FOREIGN_EXECUTION_REFERENCE'});expect(t.calls).toEqual([])})
 it('rejects a substituted UUID even with an otherwise valid native document',async()=>{const t=setup(),p=await t.completed();t.document={...t.document,executionId:crypto.randomUUID()};await expect(t.api.finalize(p)).rejects.toMatchObject({code:'DOCUMENT_BINDING_MISMATCH'});expect(t.salaryArgs).toEqual([])})
 it('rejects a changed sealed outcome even if its document bytes and checksum are mutually coherent',async()=>{const t=setup(),p=await t.completed(),s=JSON.parse(JSON.stringify(decodeFiscalSnapshot(t.document.payload)));s.outcome.report.provenance.assumptions.push('QA tampered narrative after native complete');const payload=encodeFiscalSnapshot(s);t.document={...t.document,payload,documentBytes:new TextEncoder().encode(payload).length,documentSha256:hashBytes(new TextEncoder().encode(payload))};await expect(t.api.finalize(p)).rejects.toMatchObject({code:'DOCUMENT_BINDING_MISMATCH'})})
 it.each([Error('reply lost'),{code:'OUTCOME_UNKNOWN'}])('lost or explicitly unknown transport outcome reconciles exactly once without re-inserting (%j)',async error=>{const t=setup(),p=await t.completed();await t.api.finalize(p);t.salaryError=error;expect((await t.api.store(p,'manual')).stored).toBe(true);expect(t.calls.filter(c=>c==='storage_insert')).toHaveLength(1);expect(t.calls.filter(c=>c==='fiscal_execution_reconcile')).toHaveLength(1)})
 it('preserves demonstrated consent rejection without treating it as transport uncertainty',async()=>{const t=setup(),p=await t.completed();await t.api.finalize(p);t.salaryError={code:'STALE_GENERATION'};await expect(t.api.store(p,'automatic')).rejects.toMatchObject({code:'STALE_GENERATION'});expect(t.calls).not.toContain('fiscal_execution_reconcile')})
 it('does not convert an unknown reconciliation into a saved result',async()=>{const t=setup(),p=await t.completed(),d=await t.api.finalize(p);t.salaryError=Error('reply lost');t.reconciled={executionId:d.executionId,checksum:d.documentSha256,status:'OUTCOME_UNKNOWN',stored:null,inserted:false,reason:'STORAGE_UNAVAILABLE'} as any;const r=await t.api.store(p,'manual');expect(r.stored).toBeNull();expect(r.status).toBe('OUTCOME_UNKNOWN')})
})
