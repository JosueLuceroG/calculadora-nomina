import { ChartNoAxesColumn, Smartphone } from "lucide-react"
import { formatMxn } from "../format"
import type { ResultValues } from "../results"
import type { FiscalPresentation } from "../fiscal-adapter"
import { auxiliaryDecimal, referenceDailySalary, type ForwardReport } from "./result-presentation"
import type { PaymentPeriod } from "../form"

export function DetailRow({ label, value, monetary = true, fiscal = false, amountClassName }: { label: string; value: string | null; monetary?: boolean; fiscal?: boolean; amountClassName?: string }) {
  return <div className="detail-row"><dt>{label}</dt><dd className={value === null ? undefined : amountClassName} aria-describedby={fiscal && value === null ? "result-message" : undefined} title={fiscal && value === null ? "No determinado. Consulta el motivo del resultado." : undefined}>{value === null ? "—" : monetary ? formatMxn(value) : value}</dd></div>
}

export function ResultDetails({ period, values, presentation, forward, paymentPeriod = "" }: { period: string; values: Readonly<ResultValues>; presentation?: FiscalPresentation; forward?: ForwardReport; paymentPeriod?: PaymentPeriod | "" }) {
  const fiscal = presentation !== undefined
  return (
    <div className="detail-grid">
      <div className="detail-panel">
        <h3><Smartphone size={18} aria-hidden="true" />Desglose del cálculo <span>{period}</span></h3>
        <dl>
          <DetailRow label="Salario bruto" value={values.grossSalary} fiscal={fiscal} />
          <DetailRow label="Salario diario bruto" value={referenceDailySalary(values.grossSalary, paymentPeriod)} fiscal={fiscal} />
          <DetailRow label="Salario diario neto" value={referenceDailySalary(values.netSalary, paymentPeriod)} fiscal={fiscal} amountClassName="daily-net-amount" />
          {presentation ? <>
            <DetailRow label="ISR calculado por tarifa" value={forward?.isr.accordingToTariff.amount ?? null} fiscal />
            <div className="detail-row"><dt>Subsidio aplicado al ISR</dt><dd data-subsidy="applied">{presentation.subsidy.applied === null ? "—" : formatMxn(presentation.subsidy.applied)}</dd></div>
          </> : <>
            <DetailRow label="Cuota obrera IMSS" value={values.workerImss} />
            <DetailRow label="Base gravable de ISR" value={values.taxableIncome} />
          </>}
          <DetailRow label={fiscal ? "ISR retenido estimado" : "ISR"} value={values.isr} fiscal={fiscal} />
          {!presentation && <DetailRow label="Subsidio al empleo" value={values.employmentSubsidy} />}
        </dl>
        <dl className="net-total"><DetailRow label={fiscal ? "Salario neto estimado" : "Salario neto"} value={values.netSalary} fiscal={fiscal} /></dl>
      </div>
      <div className="detail-panel">
        <h3><ChartNoAxesColumn size={18} aria-hidden="true" />{fiscal ? "IMSS e integración salarial" : "Integración salarial"}</h3>
        <dl>
          {fiscal ? <>
            <DetailRow label="IMSS calculado (cuota obrera)" value={forward?.imss.calculated.amount ?? null} fiscal />
            <DetailRow label="IMSS realmente descontado" value={values.workerImss} fiscal />
          </> : <DetailRow label="Salario diario" value={values.dailySalary} />}
          <DetailRow label="Factor de integración" value={auxiliaryDecimal(values.integrationFactor)} monetary={false} />
          {!fiscal && <DetailRow label="Salario diario integrado (SDI)" value={values.integratedDailySalary} />}
          <DetailRow label={fiscal ? "SBC estimado (no registrado)" : "Salario base de cotización (SBC)"} value={values.contributionBaseSalary} fiscal={fiscal} />
          {!fiscal && <>
            <DetailRow label="Días integrados por prestaciones" value={auxiliaryDecimal(values.integratedBenefitDays)} monetary={false} />
            <DetailRow label="Percepciones variables integradas" value={values.integratedVariableIncome} />
          </>}
        </dl>
      </div>
    </div>
  )
}

export function AuxiliaryDetails({ presentation, forward }: { presentation: FiscalPresentation; forward?: ForwardReport }) {
  const values = presentation.values
  return <section aria-label="Desglose fiscal adicional">
    <h3>Desglose fiscal adicional</h3>
    <dl>
      <DetailRow label="Base gravable de ISR" value={values.taxableIncome} fiscal />
      <div className="detail-row"><dt>Subsidio determinado</dt><dd data-subsidy="determined">{presentation.subsidy.determined === null ? "—" : formatMxn(presentation.subsidy.determined)}</dd></div>
      <DetailRow label="IMSS absorbido por el patrón" value={forward?.imss.absorbedByEmployer.amount ?? null} fiscal />
      <DetailRow label="IMSS excluido en la simulación" value={forward?.imss.excludedBySimulation.amount ?? null} fiscal />
      <DetailRow label={forward?.retention.assessment?forward.retention.assessment.context.salaryBasis==='agreed-daily-reference'?'Salario diario pactado declarado':forward.retention.assessment.context.salaryBasis==='actual-calendar'?'Diario no determinado (calendario real)':'Diario de referencia del perfil':'Salario diario contractual'} value={values.dailySalary} fiscal />
      <DetailRow label="SDI teórico" value={values.integratedDailySalary} fiscal />
      <DetailRow label="Días equivalentes por prestaciones" value={auxiliaryDecimal(values.integratedBenefitDays)} monetary={false} fiscal />
      {presentation.variableIncome === "not-applicable-to-ordinary-salary" ? <div className="detail-row"><dt>Percepciones variables integradas</dt><dd>No aplica · perfil fijo</dd></div> : <DetailRow label="Percepciones variables integradas" value={values.integratedVariableIncome} fiscal />}
    </dl>
    <p>El subsidio aplicado ya disminuye el ISR: no se vuelve a sumar al neto. El IMSS principal es solo lo descontado, no lo calculado ni absorbido.</p>
    <p>Subsidio no aplicado por no retención: {formatMxn(presentation.subsidy.notAppliedDueToNoWithholding)}. Excedente sobre ISR por tarifa no entregado: {formatMxn(presentation.subsidy.excessOverTariffIsrNotDelivered)}. Ninguno se paga en efectivo.</p>
  </section>
}
