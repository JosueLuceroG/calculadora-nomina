import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { createCalculationController, createContextualCalculationController, type CalculationState } from "../calculator/calculation-controller"
import { createContextualFiscalAdapter, presentInverseFiscalResult, type FiscalAdapter } from "../calculator/fiscal-adapter"
import { createInitialForm, type CaptureForm } from "../calculator/form"
import type { FiscalExecutionMetadata } from "../calculator/date-policy"
import { createStoredFiscalSnapshot, decodeFiscalSnapshot, encodeFiscalSnapshot, type StoredFiscalSnapshotV2 } from "../storage/snapshot"
import { serializeStorageValue } from "../storage/serialization"
import { assertHistoricalPresentation } from "../history/historical-snapshot"
import { documentFromCurrent, documentFromHistory } from "../pdf/document-model"
import { createSalaryReport } from "../pdf/report-model"
import { renderSalaryReport } from "../pdf/render-report"
import { calculateStandardEstimatedNetToGross } from "../../domain/payroll/net-to-gross"
import { standardGrossToNetContext2026 } from "../../infrastructure/fiscal/2026"
import * as directModule from "../../domain/payroll/gross-to-net"
import * as inverseModule from "../../domain/payroll/net-to-gross"
import * as selectorModule from "../../infrastructure/fiscal/2026"
import { DOCUMENT_PRODUCER, executionReceipt,recordDocumentExecutionMetadata,documentExecutionMetadata } from "./provenance"

const root=fileURLToPath(new URL("../../../",import.meta.url)), out=join(root,"docs/evidence/5d2b")
const originals=JSON.parse(readFileSync(join(out,"originals-v1.json"),"utf8")) as {name:string;payload:string;checksum:string}[]
const fixtures:{name:string;payload:string}[]=[], pdfs:unknown[]=[]
const sha=(s:string|Uint8Array)=>createHash("sha256").update(s).digest("hex")
const fonts={regular:new Uint8Array(readFileSync(new URL("../pdf/assets/DejaVuSans.ttf",import.meta.url))),bold:new Uint8Array(readFileSync(new URL("../pdf/assets/DejaVuSans-Bold.ttf",import.meta.url)))}
const form=(patch:Partial<CaptureForm>={})=>({area:"general-zone" as const,form:{...createInitialForm(),mode:"gross-to-net" as const,amount:"00015000.50",period:"monthly" as const,effectiveDate:"2026-02-01",...patch}})
function execution(s:CalculationState,automatic=false):FiscalExecutionMetadata{const previous=documentExecutionMetadata(s);if(previous)return previous;const value:FiscalExecutionMetadata={requestId:s.requestId,consultationLocalDate:"2026-10-22",preparedAt:"2026-10-22T12:00:00.000Z",fiscalDate:s.snapshot!.form.effectiveDate,referenceMode:automatic?"automatic":"manual",packageId:s.executionProvenance!.fiscalPackage.id,startedAt:"2026-10-22T12:00:01.000Z",completedAt:"2026-10-22T12:00:02.000Z",completedLocalDate:"2026-10-22",completedLocalTime:"12:00:02",utcOffsetMinutes:0};recordDocumentExecutionMetadata(s,value);return value}
function snapshot(c:ReturnType<typeof createCalculationController>,n=1,automatic=false):StoredFiscalSnapshotV2 {
  const s=c.getState(),value=createStoredFiscalSnapshot({getCurrentState:c.getState,expectedRequestId:s.requestId,executionId:`00000000-0000-4000-8000-${String(1000+n).padStart(12,"0")}`,execution:execution(s,automatic)})
  if(value.schemaVersion!==2)throw new Error("Expected v2 productive snapshot")
  return value
}
async function completed(patch:Partial<CaptureForm>={},adapter?:FiscalAdapter){const c=adapter?createCalculationController(adapter):createContextualCalculationController();await c.submit(form(patch)).completion;return c}
beforeEach(()=>vi.spyOn(performance,"now").mockReturnValue(0))
afterEach(()=>vi.restoreAllMocks())
describe("5D.2b originales v1 de ambas políticas",()=>{
  it.each(originals)("$name conserva bytes,UUID,checksum,semántica y fuentes sin motor",item=>{
    const s=decodeFiscalSnapshot(item.payload),before=serializeStorageValue(s)
    const direct=vi.spyOn(directModule,"calculateStandardEstimatedGrossToNet").mockImplementation(()=>{throw new Error("Reader called calculator")})
    const inverse=vi.spyOn(inverseModule,"calculateStandardEstimatedNetToGross").mockImplementation(()=>{throw new Error("Reader called inverse")})
    const selector=vi.spyOn(selectorModule,"selectFiscalParameters2026").mockImplementation(()=>{throw new Error("Reader selected active data")})
    expect(s.schemaVersion).toBe(1);expect(sha(item.payload)).toBe(item.checksum)
    expect(assertHistoricalPresentation(s)).toBe(s)
    const model=documentFromHistory(s),report=createSalaryReport(model,{exportedAt:new Date("2028-03-04T12:00:00Z"),reportId:"5d2b0000-0000-4000-8000-000000000001"})
    expect(model.original.outcome).toEqual(s.outcome);expect(model.original.versions).toEqual(s.versions)
    expect(report.exportedAt).toBe("2028-03-04T12:00:00.000Z");expect(report.year).toBe("2026")
    const generated=renderSalaryReport(report,fonts);mkdirSync(join(out,"pdf"),{recursive:true});const path=join(out,"pdf",`${item.name}.pdf`);writeFileSync(path,generated.bytes)
    pdfs.push({id:item.name,path,pages:generated.audit.pages,sha256:sha(generated.bytes),snapshotVersion:1,engine:s.versions.engine,uris:report.references.map(r=>r.url),exportedAt:report.exportedAt})
    expect(serializeStorageValue(s)).toBe(before)
    expect(direct).not.toHaveBeenCalled();expect(inverse).not.toHaveBeenCalled();expect(selector).not.toHaveBeenCalled()
  })
})
describe("5D.2b nuevas simulaciones con recibo real",()=>{
  it.each([
    {name:"direct-manual",patch:{}}, {name:"direct-imss-off-auto",patch:{includeImss:false}},
    {name:"inverse-exact",patch:{mode:"net-to-gross",amount:"13202.64"}},
    {name:"inverse-approximate",patch:{mode:"net-to-gross",amount:"5557.04",period:"fortnightly"},scope:"approximate"},
    {name:"inverse-limited",patch:{mode:"net-to-gross",amount:"13202.64"},scope:"limited"},
    {name:"direct-conditioned",patch:{amount:"9451.20"},conditioned:true},
  ] as const)("$name: v2 exacto y productor compilado",async item=>{
    let adapter: FiscalAdapter|undefined
    if("scope"in item){const original=createContextualFiscalAdapter();adapter={...original,inverse:async request=>{const report=await calculateStandardEstimatedNetToGross({...request.input,searchOptions:item.scope==="approximate"?{grossRange:{from:"6216.15",to:"6216.16"}}:{grossRange:{from:"15000.00",to:"50000.00"},maxEvaluations:3}},standardGrossToNetContext2026());return{kind:"inverse",report,presentation:presentInverseFiscalResult(report,request.input.referenceDate)}}}}
    const c=await completed(item.patch,adapter)
    if("conditioned"in item){const s=c.getState();await c.confirmMinimum(s.requestId,{kind:"contextual-retention-2026-v2",salaryBasis:"agreed-daily-reference",monthlyCondition:"minimum-only-assumed",referenceMonth:"2026-02",noOtherSalaryPayments:true,acknowledgement:"explicit-standard-simulation-assumption-not-payroll-verification"}).completion}
    const s=c.getState(),original=s.outcome,v2=snapshot(c,fixtures.length+1,item.name==="direct-imss-off-auto"),payload=encodeFiscalSnapshot(v2)
    expect(decodeFiscalSnapshot(payload)).toEqual(v2);expect(v2.outcome).toEqual(original);expect(v2.capture).toEqual(s.snapshot)
    expect(v2.executionProvenance.producerId).toBe(DOCUMENT_PRODUCER.producerId);expect(v2.fiscalPackage.containerIdentity).toBeNull()
    expect(v2.executionProvenance.effectiveParameterSets).toHaveLength(7);expect(v2.executionProvenance).not.toHaveProperty("engineContext")
    expect(v2.outcome.presentation.values.integratedVariableIncome).toBeNull();expect(Object.isFrozen(v2.executionProvenance.effectiveParameterSets[0].sources)).toBe(true)
    assertHistoricalPresentation(v2)
    const current=documentFromCurrent(c.getState,execution(s)),historical=documentFromHistory(v2)
    expect(current.original.fiscalPackage).toEqual(historical.original.fiscalPackage);expect(current.original.executionProvenance).toEqual(historical.original.executionProvenance)
    const report=createSalaryReport(historical,{exportedAt:new Date("2028-03-04T12:00:00Z"),reportId:"5d2b0000-0000-4000-8000-000000000002"}),generated=renderSalaryReport(report,fonts)
    mkdirSync(join(out,"pdf"),{recursive:true});const path=join(out,"pdf",`v2-${item.name}.pdf`);writeFileSync(path,generated.bytes)
    pdfs.push({id:`v2-${item.name}`,path,pages:generated.audit.pages,sha256:sha(generated.bytes),snapshotVersion:2,engine:v2.versions.engine,uris:report.references.map(r=>r.url),exportedAt:report.exportedAt})
    expect(encodeFiscalSnapshot(v2)).toBe(payload);fixtures.push({name:item.name,payload});c.dispose()
  },20000)
  it("procedencia disponible antes de que un suscriptor cancele",()=>{
    const c=createContextualCalculationController();let observed=false
    c.subscribe(s=>{if(s.phase==="calculating"){observed=Boolean(executionReceipt(s));c.cancel()}})
    c.submit(form());expect(observed).toBe(true);expect(c.getState().phase).toBe("cancelled");expect(executionReceipt(c.getState())).toBeNull();c.dispose()
  })
  it("no se fabrica recibo copiando estado o cruzando controladores con mismo requestId",async()=>{
    const a=await completed(),b=await completed({amount:"16000.00"}),s=a.getState(),t=b.getState()
    expect(s.requestId).toBe(t.requestId);expect(executionReceipt(s)).not.toBe(executionReceipt(t))
    expect(()=>createStoredFiscalSnapshot({getCurrentState:a.getState,expectedRequestId:s.requestId,executionId:"00000000-0000-4000-8000-000000009998",execution:execution(t)})).toThrow("BINDING")
    expect(()=>createStoredFiscalSnapshot({getCurrentState:()=>({...s}),expectedRequestId:s.requestId,executionId:"00000000-0000-4000-8000-000000009999",execution:execution(s)})).toThrow("UNBOUND")
    a.dispose();b.dispose()
  })
  it.each(["2026-01-01","2026-01-31","2026-02-01","2026-12-31"])("metadatos efectivos conservan la fecha elegida: %s",async date=>{
    const c=await completed({effectiveDate:date}),s=snapshot(c)
    expect(s.executionProvenance.resolution.fiscalDate).toBe(date)
    expect(s.executionProvenance.effectiveParameterSets.find(set=>set.role==="uma")?.id).toBe(date<"2026-02-01"?"mx-uma-2025-for-january-2026":"mx-uma-2026")
    c.dispose()
  })
  it("2027 sigue bloqueado y no produce snapshot",()=>{const c=createContextualCalculationController();expect(c.submit(form({effectiveDate:"2027-01-01"})).accepted).toBe(false);expect(c.getState().outcome).toBeNull();c.dispose()})
  it("exportar con distinta fecha no altera el original",async()=>{const c=await completed(),s=snapshot(c),before=encodeFiscalSnapshot(s),m=documentFromHistory(s);const a=createSalaryReport(m,{exportedAt:new Date("2028-01-01Z")}),b=createSalaryReport(m,{exportedAt:new Date("2029-01-01Z")});expect(a.fiscalRows).toEqual(b.fiscalRows);expect(a.references).toEqual(b.references);expect(a.exportedAt).not.toBe(b.exportedAt);expect(encodeFiscalSnapshot(s)).toBe(before);c.dispose()})
})
afterAll(()=>{
  if(fixtures.length!==6)throw new Error("Incomplete v2 corpus")
  writeFileSync(join(root,"src-tauri/src/storage/fixtures-v2.json"),JSON.stringify(fixtures,null,2)+"\n")
  writeFileSync(join(out,"originals-v2.json"),JSON.stringify(fixtures.map(f=>({...f,checksum:sha(f.payload)})),null,2)+"\n")
  writeFileSync(join(out,"generated-pdfs.json"),JSON.stringify({documents:pdfs},null,2)+"\n")
})
