import {afterAll,describe,it,expect} from 'vitest'
import {readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {renderToStaticMarkup} from 'react-dom/server'
import expected from './fixtures/operational-4b1.expected.json'
import {calculateStandardEstimatedGrossToNet} from '../domain/payroll/gross-to-net'
import type {StandardEstimatedGrossToNetInput,StandardEstimatedGrossToNetResult} from '../domain/payroll/gross-to-net-contracts'
import {standardGrossToNetContext2026} from '../infrastructure/fiscal/2026'
import {decodeFiscalSnapshot} from '../features/storage/snapshot'
import {readOriginalDocument} from '../features/documents/original-document'
import {assertHistoricalPresentation} from '../features/history/historical-snapshot'
import {HistoricalResultContent} from '../features/history/historical-results'
import {HistoryDetail} from '../features/history/history-section'
import {documentFromHistory} from '../features/pdf/document-model'
import {createSalaryReport} from '../features/pdf/report-model'
import {renderSalaryReport} from '../features/pdf/render-report'

const root=new URL('../../',import.meta.url),out=new URL('docs/evidence/snapshot-v3-compat/cd6/',root),load=(p:string)=>JSON.parse(readFileSync(new URL(p,root),'utf8'))
const hash=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex'),moneyRows:unknown[]=[],documentRows:unknown[]=[]
function rounded(value:string|undefined,places=2):string|null{
 if(value===undefined)return null
 const [whole,fraction='']=value.split('.'),digits=BigInt(whole+fraction.padEnd(places+1,'0').slice(0,places))+(fraction.padEnd(places+1,'0')[places]>='5'?1n:0n),s=digits.toString().padStart(places+1,'0')
 return s.slice(0,-places)+'.'+s.slice(-places)
}
function components(r:StandardEstimatedGrossToNetResult){
 const integration=r.integration.data
 const v:Record<string,string|null>={gross:r.gross.amount,daily:integration?.dailySalary.presentation.amount??null,factor4:rounded(integration?.factor.value,4),benefitDays:rounded(integration?.equivalentAnnualBenefitDays.value),sdi:integration?.theoreticalSdi.presentation.amount??null,sbc:r.sbc?.status==='estimated'?r.sbc.data.sbc.estimatedSbc:null,isrTariff:r.isr.accordingToTariff.amount,isrProvisional:r.isr.afterSubsidyProvisional.amount,isrWithheld:r.isr.withheld.amount,subsidyDetermined:r.subsidy.determined.amount,subsidyPotential:r.subsidy.potentiallyApplicable.amount,subsidyApplied:r.subsidy.applied.amount,subsidyDisplaced:r.subsidy.notAppliedDueToNoWithholding.amount,subsidyExcess:r.subsidy.excessOverTariffIsrNotDelivered.amount,subsidyTotalUnused:r.subsidy.totalNotApplied.amount,subsidyCash:r.subsidy.cashDelivered.amount,imssCalculated:r.imss.calculated.amount,imssDeducted:r.imss.deducted.amount,imssAbsorbed:r.imss.absorbedByEmployer.amount,imssExcluded:r.imss.excludedBySimulation.amount,net:r.net.amount}
 for(const name of ['pensioner-medical','cash-benefits','disability-life','unemployment-old-age','excess-medical'] as const){const q=r.imss.byBranch?.[name].quotas;for(const k of ['calculated','deducted','absorbed','excluded'] as const)v[`branch.${name}.${k}`]=q?.[k==='absorbed'?'absorbedByEmployer':k==='excluded'?'excludedBySimulation':k]??null}
 return v
}
describe('CD-6 complementary unit monetary regressions, not Windows evidence',()=>{
 it.each(expected.direct)('$id compares original Fraction-oracle components including unknowns and branches',c=>{
  const r=c.request,input:StandardEstimatedGrossToNetInput={profileId:'standard-estimate-2026-v1',grossPeriodSalary:r.gross,periodicity:r.periodicity as StandardEstimatedGrossToNetInput['periodicity'],referenceDate:r.date,benefits:r.benefits,area:'general-zone',includeWorkerImss:r.includeImss,minimumWageMonthlyScenario:r.confirmed?{kind:'only-general-minimum-assumed-for-reference-month',referenceMonth:r.date.slice(0,7),noOtherSalaryPayments:true,acknowledgement:'explicit-standard-simulation-assumption-not-payroll-verification'}:{kind:'unconfirmed'}}
  const report=calculateStandardEstimatedGrossToNet(input,standardGrossToNetContext2026()),actual=components(report)
  expect(report.status).toBe(c.expected.status)
  for(const [key,value] of Object.entries(c.expected.components))expect(actual[key],`${c.id}/${key}`).toBe(value)
  moneyRows.push({id:c.id,components:Object.keys(c.expected.components).length,status:report.status,differences:0})
 })
})
const baseline=load('docs/evidence/snapshot-v3-compat/cd5/current-presentation-verified.json').historical as {name:string;accepted:boolean;modelSha256?:string;htmlSha256?:string;pdfSha256?:string}[]
const cases=load('docs/evidence/snapshot-v3-compat/cd2/cases.json') as {name:string;payload:string}[]
const fonts={regular:new Uint8Array(readFileSync(new URL('src/features/pdf/assets/DejaVuSans.ttf',root))),bold:new Uint8Array(readFileSync(new URL('src/features/pdf/assets/DejaVuSans-Bold.ttf',root)))}
describe('CD-6 complementary historical document regression, approved evidence read-only',()=>{
 it.each(baseline)('$name retains the historical dispatch and deterministic PDF',b=>{
  const payload=cases.find(c=>c.name===b.name)!.payload
  if(!b.accepted){expect(()=>assertHistoricalPresentation(decodeFiscalSnapshot(payload))).toThrow();documentRows.push({name:b.name,accepted:false,unchanged:true});return}
  const s=decodeFiscalSnapshot(payload);assertHistoricalPresentation(s);const m=documentFromHistory(s),html=renderToStaticMarkup(<HistoricalResultContent snapshot={s}/>),pdf=renderSalaryReport(createSalaryReport(m,{exportedAt:new Date('2028-03-04T12:00:00Z'),reportId:'cd500000-0000-4000-8000-000000000001'}),fonts)
  expect(hash(JSON.stringify(m))).toBe(b.modelSha256);expect(hash(html)).toBe(b.htmlSha256);expect(hash(pdf.bytes)).toBe(b.pdfSha256)
  documentRows.push({name:b.name,accepted:true,unchanged:true,pdfSha256:hash(pdf.bytes)})
 })
 it('the wording explicitly separates fiscal cryptographic signatures from salary certification',()=>{
  const pointer=JSON.parse(readFileSync(new URL('latest-windows.json',out),'utf8')),report=JSON.parse(readFileSync(new URL(pointer.path,out),'utf8')),s=readOriginalDocument(readFileSync(new URL(`runs/${report.run}/direct-automatic-original.json`,out),'utf8'),'storage-read'),html=renderToStaticMarkup(<HistoryDetail snapshot={s}/>)
  expect(html).toContain('firmas criptográficas de los documentos fiscales');expect(html).toContain('Esto no certifica el cálculo salarial');expect(html).not.toContain('firmas matemáticas')
 })
})
afterAll(()=>writeFileSync(new URL('unit-regressions.json',out),JSON.stringify({kind:'Complementary Node/Vitest regressions; no Windows/native issuance claim',monetary:moneyRows,documents:documentRows,approvedFixturesOverwritten:false},null,2)+'\n'))
