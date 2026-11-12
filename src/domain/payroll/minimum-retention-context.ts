import type {PayrollPeriodicity} from './contracts'
import {FiscalFoundationError} from './errors'
import {compareDecimals,moneyText,multiplyDecimals} from './money'
import {STANDARD_CONVENTIONS} from './simulation-conventions'

export const CONTEXTUAL_WITHHOLDING_POLICY = Object.freeze({
  id:'standard-isr-withholding-2026-independent-context-v2',
  nature:'conditional-standard-estimate-not-factual-certification' as const,
  reviewRegion:'daily-minimum-times-standard-month-through-conasami-published-monthly' as const,
  calendar:'not-reconstructed' as const,
})
export type ContextualRetentionContext=Readonly<{
  kind:'contextual-retention-2026-v2'
  salaryBasis:'fixed-period'|'agreed-daily-reference'|'actual-calendar'
  monthlyCondition:'unknown'|'minimum-only-assumed'|'outside-profile'
  referenceMonth:string
  noOtherSalaryPayments?:boolean
  acknowledgement?:'explicit-standard-simulation-assumption-not-payroll-verification'
  actualDays?:28|30|31
}>
export type RetentionAssessment=Readonly<{
  policyVersion:typeof CONTEXTUAL_WITHHOLDING_POLICY.id
  state:'not-applicable'|'conditional'|'insufficient-context'|'outside-profile'
  reason:string
  message:string
  context:ContextualRetentionContext
  dailyRelation:'below'|'equal'|'above'|null
  referenceDailyMinimum:string
  publishedMonthlyReference:string
  reviewRegion:Readonly<{from:string;to:string}>
  factualVerification:false
}>
export const isContextualRetention=(value:unknown):value is ContextualRetentionContext=>Boolean(value&&typeof value==='object'&&(value as {kind?:unknown}).kind==='contextual-retention-2026-v2')
export const defaultRetentionContext=(date:string):ContextualRetentionContext=>Object.freeze({kind:'contextual-retention-2026-v2',salaryBasis:'fixed-period',monthlyCondition:'unknown',referenceMonth:date.slice(0,7)})
export function parseRetentionContext(value:Record<string,unknown>):ContextualRetentionContext{
  const allowed=['kind','salaryBasis','monthlyCondition','referenceMonth','noOtherSalaryPayments','acknowledgement','actualDays']
  if(Object.keys(value).some(k=>!allowed.includes(k))||!['fixed-period','agreed-daily-reference','actual-calendar'].includes(String(value.salaryBasis))||!['unknown','minimum-only-assumed','outside-profile'].includes(String(value.monthlyCondition))
    ||typeof value.referenceMonth!=='string'||!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value.referenceMonth)
    ||value.noOtherSalaryPayments!==undefined&&typeof value.noOtherSalaryPayments!=='boolean'
    ||value.acknowledgement!==undefined&&value.acknowledgement!=='explicit-standard-simulation-assumption-not-payroll-verification'
    ||value.actualDays!==undefined&&(value.salaryBasis!=='actual-calendar'||![28,30,31].includes(value.actualDays as number)))throw new FiscalFoundationError('INVALID_METADATA','El contexto salarial o mensual no pertenece al contrato contextual v2.')
  return Object.freeze({...value}) as ContextualRetentionContext
}

/** Decisión contextual: no calcula ISR/IMSS ni consulta la igualdad usada por IMSS. */
export function assessMinimumRetention(context:ContextualRetentionContext,reference:Readonly<{gross:string;periodicity:PayrollPeriodicity;date:string;dailySalary:string|null;dailyMinimum:string;publishedMonthly:string}>):RetentionAssessment{
  const from=moneyText(multiplyDecimals(reference.dailyMinimum,STANDARD_CONVENTIONS.referenceCotizedDays.monthly).value,'positive'),to=moneyText(reference.publishedMonthly,'positive')
  const relation=reference.dailySalary===null?null:compareDecimals(reference.dailySalary,reference.dailyMinimum)
  const dailyRelation=relation===null?null:relation<0?'below':relation===0?'equal':'above'
  const result=(state:RetentionAssessment['state'],reason:string,message:string):RetentionAssessment=>Object.freeze({policyVersion:CONTEXTUAL_WITHHOLDING_POLICY.id,state,reason,message,context,dailyRelation,referenceDailyMinimum:reference.dailyMinimum,publishedMonthlyReference:to,reviewRegion:Object.freeze({from,to}),factualVerification:false})
  if(context.referenceMonth!==reference.date.slice(0,7))return result('outside-profile','LISR96_CONTEXT_MONTH_MISMATCH','El contexto declarado no corresponde al mes de la fecha fiscal.')
  if(context.salaryBasis==='actual-calendar')return result('outside-profile','ACTUAL_SALARY_CALENDAR_NOT_SUPPORTED','El importe se declaró como pago por días reales (28/30/31). Este perfil no reconstruye ese calendario; no se compara automáticamente como salario mensual dividido entre 30.')
  if(context.monthlyCondition==='outside-profile'||context.noOtherSalaryPayments===false)return result('outside-profile','MONTHLY_PAYMENTS_OUTSIDE_STANDARD_PROFILE','Otros pagos o hechos mensuales requieren un contexto que este perfil no reconstruye. No se determina retención ni neto omitiéndolos.')
  if(dailyRelation==='below')return result('outside-profile','DAILY_REFERENCE_BELOW_PROFILE_MINIMUM','El diario del periodo estándar declarado está por debajo del mínimo general del perfil; no se regulariza aumentando el SBC.')
  if(context.monthlyCondition==='minimum-only-assumed'){
    if(context.salaryBasis==='fixed-period'&&reference.periodicity==='monthly')return result('outside-profile','FIXED_MONTHLY_MINIMUM_OUTSIDE_PROFILE','La no retención de un sueldo fijo mensual declarado como mínimo no se resuelve sustituyendo 30 por 365/12. Ese contexto queda fuera de V1; no se fuerza una retención cero.')
    if(context.salaryBasis!=='agreed-daily-reference')return result('insufficient-context','LISR96_MONTHLY_BASIS_REQUIRED','La expresión mensual CONASAMI y la equivalencia de 30 días no acreditan por sí solas la condición del artículo 96. Falta una base diaria compatible dentro del perfil.')
    if(dailyRelation!=='equal')return result('outside-profile','LISR96_DAILY_ASSUMPTION_INCOMPATIBLE','La hipótesis de percibir exclusivamente mínimo general no es compatible con el diario pactado declarado en esta simulación.')
    if(context.noOtherSalaryPayments!==true||context.acknowledgement!=='explicit-standard-simulation-assumption-not-payroll-verification')return result('insufficient-context','MONTHLY_MINIMUM_CONFIRMATION_REQUIRED','Falta la hipótesis mensual expresa compatible; no se presume la ausencia de otras percepciones.')
    return result('conditional','LISR96_DAILY_MINIMUM_EXPLICIT_CONTEXT','No retención bajo hipótesis expresa: salario diario mínimo pactado, días estándar y mes exclusivamente de mínimo general. No acredita hechos de una nómina real.')
  }
  if(context.salaryBasis==='fixed-period'&&reference.periodicity==='monthly'&&compareDecimals(reference.gross,from)>=0&&compareDecimals(reference.gross,to)<=0)return result('insufficient-context','LISR96_MONTHLY_BASIS_REQUIRED','El importe mensual requiere precisar su base salarial. La región de análisis no es un piso legal ni una prohibición; con base diaria compatible puede resolverse el escenario del perfil.')
  if(dailyRelation==='equal')return result('insufficient-context','MONTHLY_MINIMUM_CONFIRMATION_REQUIRED','La igualdad del diario no demuestra el supuesto mensual del artículo 96. ISR retenido y neto permanecen no determinados.')
  if(dailyRelation==='above')return result('not-applicable','ORDINARY_PROFILE_WITHOUT_MINIMUM_EXCEPTION','Tratamiento ordinario dentro de la base fija declarada del perfil; no se aplica la hipótesis de mínimo exclusivo. No se acredita una retención mensual real.')
  return result('insufficient-context','LISR96_CONTEXT_INSUFFICIENT','No hay información compatible suficiente para decidir la retención del perfil.')
}

/** Alcance de la prueba ordinaria: entre sus extremos no puede esconderse una región pendiente. */
export function contextualOrdinaryScope(assessment:RetentionAssessment,gross:string,period:PayrollPeriodicity):boolean{
  if(assessment.state!=='not-applicable'||assessment.dailyRelation!=='above'||assessment.context.monthlyCondition!=='unknown'||assessment.factualVerification!==false)return false
  if(assessment.context.salaryBasis==='agreed-daily-reference')return true
  return assessment.context.salaryBasis==='fixed-period'&&(period!=='monthly'||compareDecimals(gross,assessment.reviewRegion.to)>0)
}
