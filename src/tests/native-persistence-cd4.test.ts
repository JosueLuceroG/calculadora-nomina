import {describe,it,expect,afterAll} from 'vitest'
import {readFileSync,writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {createFiscalExecutionApi,type Invoke,type SalaryInvoke,type FinalizedDocument,type ExecutionState,type StoreOutcome} from '../features/calculator/fiscal-execution-api'
import type {FiscalOutcome} from '../features/calculator/fiscal-adapter'
import type {CalculationState} from '../features/calculator/calculation-controller'
import {createExternalDocumentController} from '../features/calculator/external-document-controller'
import {hashBytes} from '../features/documents/evidence-v3'
import {compatCompleteResult} from '../features/documents/persistence-compat-v1'
import {decodeFiscalSnapshot,encodeFiscalSnapshot} from '../features/storage/snapshot'

const out=new URL('../../docs/evidence/snapshot-v3-compat/cd4/',import.meta.url)
const repo=new URL('../../',import.meta.url),runPath=(run:string)=>fileURLToPath(new URL(run,repo))
type Case={label:string;run:string;executionId?:string;documentSha256?:string}
const positives=JSON.parse(readFileSync(new URL('positive-persistence.json',out),'utf8')).cases as Case[]
const diagnostics=JSON.parse(readFileSync(new URL('diagnostics-closed.json',out),'utf8')).cases as Case[]
const observations:{label:string;clientChecked:true;nativeAuthorityIssuedByThisTest:false}[]=[]
// Recorded outputs of NEW real native CD-4 sessions. These transport doubles
// test the client, not issuance; the Rust suite exercises the private permit.
function setup(row:Case){
 const run=runPath(row.run),input=JSON.parse(readFileSync(`${run}/input.json`,'utf8')),engine=JSON.parse(readFileSync(`${run}/engine-result.json`,'utf8'))
 const result=JSON.parse(engine.resultWire),m=JSON.parse(input.materialWire),state=input.state as ExecutionState
 const document=JSON.parse(readFileSync(`${run}/finalization.json`,'utf8')) as FinalizedDocument
 let salaryError:unknown=null
 let reconciled:StoreOutcome={executionId:document.executionId,checksum:document.documentSha256,status:'COMMITTED',stored:true,inserted:false,reason:null}
 const calls:string[]=[],writes:Parameters<SalaryInvoke>[1][]=[]
 const invoke:Invoke=async<T>(command:string,args:{request:unknown}):Promise<T>=>{
  calls.push(command)
  if(command==='fiscal_execution_prepare')return state as T
  if(command==='fiscal_execution_material')return input.materialWire as T
  if(command==='fiscal_execution_complete'){
   const wire=(args.request as {resultWire:string}).resultWire
   expect(wire).toBe(engine.resultWire)
   return {...state,phase:'complete',resultSha256:hashBytes(new TextEncoder().encode(wire)),resultBytes:new TextEncoder().encode(wire).length} as T
  }
  if(command==='fiscal_execution_finalize')return document as T
  if(command==='fiscal_execution_reconcile')return reconciled as T
  throw Error(command)
 }
 const salary:SalaryInvoke=async<T>(command:string,args:Parameters<SalaryInvoke>[1]):Promise<T>=>{calls.push(command);writes.push(args);if(salaryError)throw salaryError;return {...reconciled,inserted:true} as T}
 const api=createFiscalExecutionApi(invoke,salary)
 async function completed(){const p=await api.prepare(m.capture,m.scenario,m.context.selection,m.requestId,state.clientRequestId,input.referenceMode);await api.material(p);await api.complete(p,result.outcome);return p}
 return {api,completed,document,calls,writes,m,outcome:result.outcome as FiscalOutcome,set salaryError(e:unknown){salaryError=e},set reconciled(r:StoreOutcome){reconciled=r}}
}

describe('CD-4 client routes over genuine native-issued artifacts; transport doubles are not permits',()=>{
 it.each(positives)('$label restores normal storage with original generation/bytes/authority reference',async row=>{
  const t=setup(row),p=await t.completed(),d=await t.api.finalize(p)
  expect(compatCompleteResult(t.outcome)).toBe(true);expect(d.writeGeneration).toBeTypeOf('string')
  expect(encodeFiscalSnapshot(decodeFiscalSnapshot(d.payload))).toBe(d.payload)
  const route=row.label==='direct-manual'?'manual':'automatic'
  expect((await t.api.store(p,route)).stored).toBe(true)
  expect(t.writes).toEqual([{generation:d.writeGeneration,payload:d.payload,authority:{handle:p.state.handle,expectedDocumentSha256:d.documentSha256}}])
  observations.push({label:row.label,clientChecked:true,nativeAuthorityIssuedByThisTest:false})
 })
 for(const route of ['manual','automatic'] as const)it.each(diagnostics)(`$label remains closed through ${route}, before storage IPC`,async row=>{
  const t=setup(row),p=await t.completed(),d=await t.api.finalize(p)
  expect(d.writeGeneration).toBeNull();expect(compatCompleteResult(t.outcome)).toBe(false)
  await expect(t.api.store(p,route)).rejects.toMatchObject({code:'DOCUMENT_MANUAL_FLOW_REQUIRED'});expect(t.writes).toEqual([])
 })
 it('a lost response reconciles the existing native commit exactly once without another insert',async()=>{
  const t=setup(positives[0]),p=await t.completed();await t.api.finalize(p);t.salaryError=Error('response delivery failed')
  expect((await t.api.store(p,'manual')).stored).toBe(true);expect(t.writes).toHaveLength(1)
  expect(t.calls.filter(c=>c==='fiscal_execution_reconcile')).toHaveLength(1)
 })
 it('unknown reconciliation stays unknown and never substitutes a different checksum',async()=>{
  const t=setup(positives[0]),p=await t.completed(),d=await t.api.finalize(p);t.salaryError={code:'OUTCOME_UNKNOWN'}
  t.reconciled={executionId:d.executionId,checksum:d.documentSha256,status:'OUTCOME_UNKNOWN',stored:null,inserted:false,reason:'STORAGE_UNAVAILABLE'}
  expect((await t.api.store(p,'automatic')).stored).toBeNull()
  t.reconciled={executionId:d.executionId,checksum:'0'.repeat(64),status:'COMMITTED',stored:true,inserted:false,reason:null}
  await expect(t.api.store(p,'automatic')).rejects.toMatchObject({code:'DOCUMENT_BINDING_MISMATCH'})
 })
 it.each([true,false])('the unchanged normal document controller completes automatic=%s',async automatic=>{
  const t=setup(positives[0]),p=await t.completed()
  const controller=createExternalDocumentController({consent:()=>true,port:()=>({finalize:()=>t.api.finalize(p),store:r=>t.api.store(p,r),reconcile:(id,sha)=>t.api.reconcile(id,sha)})})
  controller.begin(p.state.requestId,true,automatic)
  const state:CalculationState={phase:'result',requestId:p.state.requestId,snapshot:t.m.capture,outcome:t.outcome,captureIssues:[],error:null}
  await controller.finish(state)
  if(!automatic){expect(controller.getState().phase).toBe('finalized');await controller.store('manual')}
  expect(controller.getState().phase).toBe('stored');expect(t.writes).toHaveLength(1);controller.dispose()
 })
 it('the fresh direct fiscal outcome is identical to the approved CD-3 result',()=>{
  const approved=JSON.parse(readFileSync(new URL('../../docs/evidence/snapshot-v3-compat/cd3/native-finalization.json',import.meta.url),'utf8')) as Case[]
  const old=JSON.parse(readFileSync(`${runPath(approved.find(x=>x.label==='direct')!.run)}/finalized.json`,'utf8'))
  expect(setup(positives[0]).outcome).toEqual(old.value.outcome)
 })
})
afterAll(()=>writeFileSync(new URL('ts-client-results.json',out),JSON.stringify({kind:'Client and unchanged controller checks over fresh native-issued artifacts; explicit transport doubles',observations,nativeIssuanceProvedBy:'Rust cd4_ tests',historicalEvidenceOverwritten:false},null,2)+'\n'))
