import type {FiscalOutcome} from '../calculator/fiscal-adapter'
import {assertDocumentOutcome} from './presentation-v1'

export const documentaryLabels={estimated:'Estimado',exact:'Exacto verificado',approximate:'Aproximado',limited:'Limitado',conditioned:'Condicionado','not-determinable':'No determinable','not-supported':'No soportado'} as const
export const stopLabels={completed:'Búsqueda completada','time-budget':'Presupuesto de tiempo agotado','evaluation-budget':'Presupuesto de evaluaciones agotado',aborted:'Interrumpida','invalid-input':'Entrada no válida','fiscal-preflight':'Comprobación fiscal previa'} as const
export const dispositionLabels={examined:'Examinado','proved-no-exact':'Sin coincidencia exacta demostrada','excluded-by-scope':'Fuera del alcance','fiscally-unresolved':'Fiscalmente pendiente','pending-budget':'Pendiente por presupuesto'} as const
export const DOCUMENTARY_PAGE_SIZE=20
export const PDF_EVIDENCE_PREVIEW=24
export function documentaryPage<T>(rows:readonly T[],requested=0,size=DOCUMENTARY_PAGE_SIZE){
 if(!Number.isInteger(size)||size<1)throw Error('INVALID_DOCUMENTARY_PAGE_SIZE')
 const pages=Math.max(1,Math.ceil(rows.length/size)),page=Math.min(pages-1,Math.max(0,Math.trunc(requested)||0)),start=page*size
 return {page,pages,start,total:rows.length,rows:rows.slice(start,start+size)}
}
/** Pure documentary projection. No payroll functions, current parameters,
 * certificate creation, policy edits or numeric conversion of money. */
export function compatOutcomeView(outcome:FiscalOutcome,date:string){
 assertDocumentOutcome(outcome,date)
 const p=outcome.presentation,r=outcome.report
 const inverse=r.operation==='net-to-gross'?r:null
 return Object.freeze({
  globalStatus:r.status,globalLabel:documentaryLabels[r.status],candidateLabel:inverse?inverse.recommended?'Candidato verificado; resultado global independiente':'Sin candidato recomendado':r.status==='estimated'?'Directo completo':'Directo incompleto',
  amounts:p.values,subsidy:p.subsidy,componentStates:p.componentStates,confirmation:p.confirmation,warnings:p.warnings,issues:p.issues,
  inverse:inverse?Object.freeze({
   target:inverse.targetNet,candidate:inverse.recommended,difference:inverse.recommended?.difference??null,match:inverse.match,coverage:inverse.coverage.state,domain:inverse.coverage.domain,
   conclusion:inverse.conclusion,recommendationBasis:inverse.recommendationBasis,nearestBelow:inverse.nearestVerifiedBelow,nearestAbove:inverse.nearestVerifiedAbove,
   pending:inverse.coverage.pendingIntervals,fiscalPending:inverse.coverage.fiscalUnresolvedIntervals,evidence:inverse.coverage.evidence,diagnostics:inverse.fiscalDiagnostics,
   guarantees:Object.freeze([{label:'Mínimo dentro del dominio',value:inverse.coverage.minimumProven},{label:'Unicidad dentro del dominio',value:inverse.coverage.uniquenessProven},{label:'Ausencia de coincidencia exacta dentro del dominio',value:inverse.coverage.noExactMatchProven},{label:'Conjunto exacto completo dentro del dominio',value:inverse.coverage.exactSetComplete}]),
   certificateAvailable:inverse.provenance.certificationAvailable,certificateReason:inverse.provenance.certificationReason,fiscalCertification:inverse.provenance.fiscalCertification,
   metrics:inverse.metrics,stopLabel:stopLabels[inverse.metrics.stopReason],approximationOptimality:inverse.coverage.approximationOptimality,
  }):null,
 })
}
export type CompatOutcomeView=ReturnType<typeof compatOutcomeView>
