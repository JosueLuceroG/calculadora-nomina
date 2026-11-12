import {useState} from 'react'
import {Button} from '@/components/ui/button'
import type {FiscalPresentation,MinimumDeclaration} from '../fiscal-adapter'
import {formatMxn} from '../format'

export function MinimumContextPanel({prompt,inverse,onApply}:{prompt:NonNullable<FiscalPresentation['confirmation']>;inverse:boolean;onApply?:(context:MinimumDeclaration)=>void}){
  const [basis,setBasis]=useState<NonNullable<typeof prompt.contextual>['salaryBasis']|'other-payments'>(prompt.contextual!.monthlyCondition==='outside-profile'?'other-payments':prompt.contextual!.salaryBasis),[minimumOnly,setMinimumOnly]=useState(prompt.contextual!.monthlyCondition==='minimum-only-assumed')
  const canAssumeMinimum=basis==='agreed-daily-reference'&&(inverse||prompt.contextual!.dailyRelation==='equal')
  return <div className="minimum-confirmation" role="group" aria-labelledby="minimum-context-title">
    <h3 id="minimum-context-title">Base salarial y condición del artículo 96</h3>
    <p>{prompt.contextual!.message}</p>
    {prompt.contextual!.references&&<p>Mínimo diario: {formatMxn(prompt.contextual!.references.daily)} · Equivalente de 30 días: {formatMxn(prompt.contextual!.references.standardMonth)} · Expresión mensual CONASAMI: {formatMxn(prompt.contextual!.references.publishedMonth)}.</p>}
    <label htmlFor="minimum-salary-basis">¿Cómo se pactó este importe para la simulación?</label>
    <div className="field-control"><select id="minimum-salary-basis" value={basis} onChange={e=>{setBasis(e.target.value as typeof basis);setMinimumOnly(false)}}>
      <option value="fixed-period">Sueldo fijo del periodo · sin declarar salario diario pactado</option>
      <option value="agreed-daily-reference">Salario diario pactado · simular 7/15/30 días estándar</option>
      <option value="actual-calendar">Pago calculado por 28/30/31 días reales · fuera del perfil</option>
      <option value="other-payments">Hay otros pagos o hechos del mes · fuera del perfil</option>
    </select></div>
    <p>Se conservan por separado el mínimo diario, el equivalente de 30 días y la expresión mensual CONASAMI. La comparación usa el diario interno, no su cifra redondeada. Esta elección no acredita hechos de una nómina real.</p>
    {canAssumeMinimum&&<label htmlFor="minimum-context-ack"><input id="minimum-context-ack" type="checkbox" checked={minimumOnly} onChange={e=>setMinimumOnly(e.target.checked)}/><span>Para el candidato de diario mínimo, asumo expresamente que en {prompt.referenceMonth} percibo únicamente mínimo general, sin otras percepciones salariales.</span></label>}
    {inverse&&<p>La hipótesis, si se marca, solo corresponde al candidato mínimo exacto. No elimina otras regiones pendientes ni certifica la lista de soluciones.</p>}
    <Button type="button" disabled={!onApply||basis==='fixed-period'&&prompt.contextual!.salaryBasis==='fixed-period'&&prompt.contextual!.monthlyCondition==='unknown'||!inverse&&canAssumeMinimum&&!minimumOnly} onClick={()=>onApply?.({kind:'contextual-retention-2026-v2',salaryBasis:basis==='other-payments'?'fixed-period':basis,monthlyCondition:basis==='other-payments'?'outside-profile':minimumOnly?'minimum-only-assumed':'unknown',referenceMonth:prompt.referenceMonth,...(minimumOnly?{noOtherSalaryPayments:true,acknowledgement:'explicit-standard-simulation-assumption-not-payroll-verification' as const}:{})})}>Aplicar contexto de simulación</Button>
  </div>
}
