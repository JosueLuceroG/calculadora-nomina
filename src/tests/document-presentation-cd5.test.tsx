import {afterAll,describe,it,expect,vi} from 'vitest'
import {readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {renderToStaticMarkup} from 'react-dom/server'
import {decodeFiscalSnapshot,encodeFiscalSnapshot} from '../features/storage/snapshot'
import {readOriginalDocument,originalDocumentIdentity} from '../features/documents/original-document'
import {compatOutcomeView,documentaryPage,PDF_EVIDENCE_PREVIEW} from '../features/documents/compat-outcome-view'
import {isCompatDocument} from '../features/documents/presentation-document-compat'
import {compatClassification} from '../features/documents/presentation-compat-v1'
import {assertHistoricalPresentation} from '../features/history/historical-snapshot'
import {HistoricalResultContent} from '../features/history/historical-results'
import {HistoryDetail} from '../features/history/history-section'
import {CompatOutcomeDetails} from '../features/history/compat-outcome-details'
import {createHistoryController} from '../features/history/history-controller'
import {createNativeStorageApi,type HistoryItem} from '../features/storage/storage-api'
import {documentFromHistory,documentFromPreview} from '../features/pdf/document-model'
import {documentFromPersisted} from '../features/pdf/persisted-document'
import {createSalaryReport} from '../features/pdf/report-model'
import {renderSalaryReport} from '../features/pdf/render-report'
import {createPdfExportController} from '../features/pdf/export-controller'
import {compatCompleteResult} from '../features/documents/persistence-compat-v1'

vi.mock('../domain/payroll/gross-to-net',async original=>({...await original<typeof import('../domain/payroll/gross-to-net')>(),calculateStandardEstimatedGrossToNet:()=>{throw Error('CD5_FORBIDDEN_FISCAL_RECALCULATION')}}))
vi.mock('../domain/payroll/net-to-gross',async original=>({...await original<typeof import('../domain/payroll/net-to-gross')>(),calculateStandardEstimatedNetToGross:()=>{throw Error('CD5_FORBIDDEN_FISCAL_RECALCULATION')}}))

const root=new URL('../../',import.meta.url),out=new URL('docs/evidence/snapshot-v3-compat/cd5/',root)
const load=(p:string)=>JSON.parse(readFileSync(new URL(p,root),'utf8'))
const hash=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex')
type Case={name:string;payload:string;accepted:boolean;historical?:boolean}
const corpus=load('docs/evidence/snapshot-v3-compat/cd2/cases.json') as Case[]
const baseline=load('docs/evidence/snapshot-v3-compat/cd5/current-presentation-verified.json') as {historical:{name:string;accepted:boolean;modelSha256?:string;htmlSha256?:string;pdfSha256?:string;pages?:number}[]}
type Native={label:string;run:string;executionId?:string;documentSha256?:string}
const positives=load('docs/evidence/snapshot-v3-compat/cd4/positive-persistence.json').cases as Native[]
const diagnostics=load('docs/evidence/snapshot-v3-compat/cd4/diagnostics-closed.json').cases as Native[]
// The CD-4 label "no-candidate" contains a candidate in its actual original.
// Use the approved CD-3 null-candidate original for that specific assertion;
// never change an archived report to make its label true.
const nullCandidate=(load('docs/evidence/snapshot-v3-compat/cd3/native-finalization.json') as Native[]).find(n=>n.label==='no-candidate')!
diagnostics.push({...nullCandidate,label:'no-candidate-null'})
const classifications=new Set<string>()
const wire=(n:Native)=>readFileSync(new URL(`${n.run}/finalized.json`,root),'utf8')
const fonts={regular:new Uint8Array(readFileSync(new URL('src/features/pdf/assets/DejaVuSans.ttf',root))),bold:new Uint8Array(readFileSync(new URL('src/features/pdf/assets/DejaVuSans-Bold.ttf',root)))}
const meta={exportedAt:new Date('2028-03-04T12:00:00Z'),reportId:'cd500000-0000-4000-8000-000000000001'}
const historical:unknown[]=[],pdfs:unknown[]=[],reads:unknown[]=[]

function readonlyStorage(payloads:readonly string[]){
 const map=new Map(payloads.map(p=>[decodeFiscalSnapshot(p).executionId,p])),calls:string[]=[]
 const invoke=async<T,>(command:string,args?:Record<string,unknown>):Promise<T>=>{
  calls.push(command)
  if(command==='storage_get')return (map.get(String(args?.executionId))??null) as T
  if(command==='storage_begin_write')return {generation:'cd500000-0000-4000-8000-000000000010'} as T
  if(command==='storage_get_preferences')return {theme:'light',historyAutoSave:false} as T
  if(command==='storage_list'){
   const items:HistoryItem[]=[...map.values()].map(p=>{const s=decodeFiscalSnapshot(p);if(!isCompatDocument(s)||s.capture.form.period==='')throw Error('Native compat corpus required');return {executionId:s.executionId,direction:s.capture.form.mode,requestedAmount:s.capture.form.amount,periodicity:s.capture.form.period,completedAt:s.execution.completedAt!,referenceDate:s.capture.form.effectiveDate,classification:compatClassification(s),gross:s.outcome.presentation.values.grossSalary,net:s.outcome.presentation.values.netSalary}})
   return {items,nextCursor:null,generation:'cd500000-0000-4000-8000-000000000010'} as T
  }
  throw Error('No fiscal repository or write transport in this presentation test: '+command)
 }
 return {api:createNativeStorageApi(invoke),calls}
}
function savePdf(name:string,model:ReturnType<typeof documentFromHistory>){
 const report=createSalaryReport(model,meta),result=renderSalaryReport(report,fonts),identity=model.original.originalDocument!
 expect(result.audit.boxes.every(b=>b.x>=42&&b.x+b.width<=570.05&&b.y>=78&&b.y+b.height<=730.05)).toBe(true)
 const boxes=result.audit.boxes
 for(let a=0;a<boxes.length;a++)for(let b=a+1;b<boxes.length;b++){
  const x=boxes[a],y=boxes[b];if(x.page!==y.page)continue
  const overlap=Math.min(x.x+x.width,y.x+y.width)-Math.max(x.x,y.x)>.1&&Math.min(x.y+x.height,y.y+y.height)-Math.max(x.y,y.y)>.1
  expect(overlap,`${name}: ${x.text} / ${y.text}`).toBe(false)
 }
 expect(boxes.some(b=>b.text.includes(identity.sha256))).toBe(true)
 const file=new URL(`${name}.pdf`,out);writeFileSync(file,result.bytes)
 pdfs.push({name,file:`docs/evidence/snapshot-v3-compat/cd5/${name}.pdf`,bytes:result.bytes.length,sha256:hash(result.bytes),pages:result.audit.pages,originalIdentity:identity,executionId:model.original.executionId,origin:model.original.origin,amounts:model.amounts,globalStatus:model.original.compatDetails?.globalStatus,match:model.original.compatDetails?.inverse?.match,coverage:model.original.compatDetails?.inverse?.coverage,pendingCount:model.original.compatDetails?.inverse?.pending.length,evidenceCount:model.original.compatDetails?.inverse?.evidence.length,evidencePreview:PDF_EVIDENCE_PREVIEW,withinMargins:true,noOverlaps:true,summaryOnly:true})
 return result
}

describe('CD-5 historical v1/v2/v3 compatibility: approved current golden comparison',()=>{
 it.each(baseline.historical)('$name keeps acceptance and approved model/HTML/PDF bytes',old=>{
  const c=corpus.find(c=>c.name===old.name)!
  if(!old.accepted){expect(()=>assertHistoricalPresentation(decodeFiscalSnapshot(c.payload))).toThrow();historical.push({name:old.name,accepted:false,unchanged:true});return}
  const s=decodeFiscalSnapshot(c.payload);assertHistoricalPresentation(s)
  const before=encodeFiscalSnapshot(s),m=documentFromHistory(s),html=renderToStaticMarkup(<HistoricalResultContent snapshot={s}/>),pdf=renderSalaryReport(createSalaryReport(m,meta),fonts)
  expect(hash(JSON.stringify(m))).toBe(old.modelSha256);expect(hash(html)).toBe(old.htmlSha256);expect(hash(pdf.bytes)).toBe(old.pdfSha256);expect(pdf.audit.pages).toBe(old.pages)
  expect(encodeFiscalSnapshot(s)).toBe(before)
  historical.push({name:old.name,accepted:true,modelSha256:hash(JSON.stringify(m)),htmlSha256:hash(html),pdfSha256:hash(pdf.bytes),pages:pdf.audit.pages,unchanged:true})
 })
})

describe('CD-5 original persisted-document reading, without fiscal repository or execution session',()=>{
 it.each(positives)('$label loads, restarts the client and presents the exact original',async n=>{
  const payload=wire(n),transport=readonlyStorage([payload]);let h=createHistoryController({api:transport.api})
  await h.initialize();await h.loadFirst();await h.open(n.executionId!)
  const first=h.getSelectedOriginalForExport()!;expect(first).not.toBeNull();expect(h.getState().detailError).toBeNull()
  expect(originalDocumentIdentity(first)).toEqual({sha256:n.documentSha256,byteLength:Buffer.byteLength(payload),source:'storage-read'})
  const amounts=first.outcome.presentation.values,html=renderToStaticMarkup(<HistoryDetail snapshot={first}/>)+renderToStaticMarkup(<HistoricalResultContent snapshot={first}/>)
  expect(html).toContain(n.documentSha256!);expect(html).toContain('Resultado global');expect(html).not.toContain('Guardar en Historial')
  h.dispose();const restarted=readonlyStorage([payload]);h=createHistoryController({api:restarted.api});await h.open(n.executionId!)
  const second=h.getSelectedOriginalForExport()!;expect(second).not.toBe(first);expect(second.outcome.presentation.values).toEqual(amounts);expect(encodeFiscalSnapshot(second)).toBe(payload)
  const model=await documentFromPersisted(n.executionId!,n.documentSha256!,restarted.api);expect(model.original.outcome).toEqual(second.outcome)
  expect([...transport.calls,...restarted.calls].every(c=>['storage_get','storage_list','storage_get_preferences','storage_begin_write'].includes(c))).toBe(true)
  if(n.label==='direct-manual')savePdf('control-historial-original',model)
  reads.push({label:n.label,executionId:n.executionId,sha256:n.documentSha256,originalRead:true,clientRestart:true,fiscalRepositoryCalls:0,writeCalls:0,nativeIssuanceReusedFrom:'CD-4 positive-persistence',nativeOfflineReadReusedFrom:'CD-4 exact backup-copy restore/reopen proof'})
  h.dispose()
 })
 it('hashes the original legacy wire, not its normalized re-encoding',async()=>{
  const old=corpus.find(c=>c.name==='v1-direct-manual')!,pretty=JSON.stringify(JSON.parse(old.payload),null,2),api=readonlyStorage([pretty]).api
  const s=await api.get(decodeFiscalSnapshot(pretty).executionId);expect(s).not.toBeNull()
  expect(originalDocumentIdentity(s!)!.sha256).toBe(hash(pretty));expect(hash(encodeFiscalSnapshot(s!))).not.toBe(hash(pretty))
  expect(documentFromHistory(s!).original.originalDocument!.sha256).toBe(hash(pretty))
 })
 it('refuses a missing original wire, an absent record or the wrong checksum',async()=>{
  const n=positives[0],p=wire(n)
  expect(()=>documentFromHistory(decodeFiscalSnapshot(p))).toThrow('ORIGINAL_WIRE_REQUIRED')
  await expect(documentFromPersisted(n.executionId!,'0'.repeat(64),readonlyStorage([p]).api)).rejects.toThrow('PERSISTED_ORIGINAL_MISMATCH')
  await expect(documentFromPersisted(n.executionId!,n.documentSha256!,readonlyStorage([]).api)).rejects.toThrow('PERSISTED_ORIGINAL_MISMATCH')
 })
 it('a pending original read becoming obsolete never renders or opens a save dialog',async()=>{
  let resolve!:(m:ReturnType<typeof documentFromHistory>)=>void,current=true
  const pending=new Promise<ReturnType<typeof documentFromHistory>>(r=>{resolve=r}),render=vi.fn(),save=vi.fn()
  const c=createPdfExportController({loadRuntime:async()=>({render}),save}),job=c.exportPdf({source:'history',getDocument:()=>pending,isCurrent:()=>current})
  current=false;resolve(documentFromPreview(wire(positives[0])));await job
  expect(render).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();expect(c.getState().phase).toBe('obsolete')
 })
})

describe('CD-5 independent dimensions, null values and paginated evidence',()=>{
 it.each(diagnostics)('$label can be viewed in RAM without persisting or altering money',n=>{
  const p=wire(n),s=readOriginalDocument(p);if(!isCompatDocument(s))throw Error('compat')
  const before=encodeFiscalSnapshot(s),v=compatOutcomeView(s.outcome,s.capture.form.effectiveDate),html=renderToStaticMarkup(<CompatOutcomeDetails outcome={s.outcome} date={s.capture.form.effectiveDate} current/>)
  expect(html).toContain('no pueden guardarse');expect(compatCompleteResult(s.outcome)).toBe(false)
  expect(encodeFiscalSnapshot(s)).toBe(before);expect(v.amounts).toEqual(s.outcome.presentation.values)
  if(n.label==='partial'){expect(v.amounts.netSalary).toBeNull();const m=documentFromPreview(p);expect(m.amounts.net).toEqual({raw:null,display:'—',known:false});const pdf=savePdf('control-desconocido-ram',m);expect(pdf.audit.boxes.some(b=>b.text.includes('no están determinados'))).toBe(true)}
  if(n.label==='no-candidate-null'){expect(v.inverse!.candidate).toBeNull();expect(v.amounts.grossSalary).toBeNull();expect(v.inverse!.difference).toBeNull()}
  if(n.label==='limited-candidate'){expect(v.globalStatus).toBe('estimated');expect(v.inverse!.coverage).toBe('limited');expect(v.inverse!.candidate).not.toBeNull();expect(html).toContain('No demostrado')}
 })
 it.each(corpus.filter(c=>c.accepted&&!c.historical))('$name draws classification from its original without changing frozen presentation',c=>{
  const s=readOriginalDocument(c.payload);expect(isCompatDocument(s)).toBe(true);if(!isCompatDocument(s))throw Error('compat')
  const before=encodeFiscalSnapshot(s);assertHistoricalPresentation(s);classifications.add(compatClassification(s))
  const html=renderToStaticMarkup(<HistoricalResultContent snapshot={s}/>);expect(html).toContain('Resultado global');expect(encodeFiscalSnapshot(s)).toBe(before)
 })
 it('covers estimated, limited, conditioned and not-determinable independently',()=>{
  for(const label of ['estimated','limited','conditioned','not-determinable'])expect(classifications.has(label)).toBe(true)
 })
 it('D-W2 remains an unpersisted QA document: status, candidate, coverage, certificate and signed difference stay independent',()=>{
  const c=corpus.find(c=>c.name==='D-W2-compat-unchanged')!,s=readOriginalDocument(c.payload);if(!isCompatDocument(s))throw Error('compat')
  const model=documentFromPreview(c.payload),v=model.original.compatDetails!,i=v.inverse!
  expect(model.original.origin).toBe('verified-fixture');expect(v.globalStatus).toBe('not-determinable');expect(i.match).toBe('approximate');expect(i.coverage).toBe('limited')
  expect(model.amounts.gross.raw).toBe('14644.64');expect(model.amounts.net.raw).toBe('10906.22');expect(model.inverse!.difference.raw).toBe('-2296.42');expect(i.nearestAbove).toBeNull();expect(i.certificateAvailable).toBe(false)
  expect(i.guarantees.every(g=>g.value===false)).toBe(true);expect(i.pending).toHaveLength(16);expect(i.evidence).toHaveLength(1903)
  const all=Array.from({length:Math.ceil(i.evidence.length/20)},(_,page)=>documentaryPage(i.evidence,page).rows).flat()
  expect(all).toEqual(i.evidence);expect(documentaryPage(i.evidence,9999).page).toBe(95)
  const pdf=savePdf('control-dw2-resumen-qa',model);expect(pdf.audit.pages).toBeGreaterThan(3)
  const table=pdf.audit.boxes.filter(b=>b.section==='evidencia-documental'),pages=new Set(table.filter(b=>b.text==='Desde (bruto MXN)').map(b=>b.page))
  expect(pages.size).toBeGreaterThan(1);for(const page of pages)expect(table.some(b=>b.page===page&&b.text==='Estado / motivo original')).toBe(true)
  expect(table.some(b=>b.text.includes('1879 omitidas'))).toBe(true)
  expect(encodeFiscalSnapshot(s)).toBe(c.payload)
 },20000)
})
afterAll(()=>{
 writeFileSync(new URL('historical-results.json',out),JSON.stringify({kind:'Pre/post golden legacy model, SSR HTML and deterministic PDF bytes; no registered-wire metadata in these legacy probes',cases:historical},null,2)+'\n')
 writeFileSync(new URL('presentation-results.json',out),JSON.stringify({kind:'Read-only client/SSR/PDF verification; no new native issuance or salary writes',reads,pdfs,fiscalCalculatorsReplacedWithThrowingSentinels:true,diagnosticsPersisted:false,CD5BStarted:false},null,2)+'\n')
})
