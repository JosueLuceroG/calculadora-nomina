import { Banknote, Calculator, FileText, Shield, type LucideIcon } from "lucide-react"
import type { CalculationMode } from "../form"
import type { ResultValues } from "../results"
import { ResultAmount } from "./result-amount"

function SummaryCard({ title, value, period, tone, icon: Icon, estimated }: {
  title: string
  value: string | null
  period: string
  tone: string
  icon: LucideIcon
  estimated?: boolean
}) {
  return (
    <div className={`summary-card ${tone}`}>
      <span className="summary-icon" aria-hidden="true"><Icon /></span>
      <div className="summary-copy"><h3>{title}</h3><ResultAmount value={value} describedBy={estimated ? "result-message" : undefined} /><span>{period}</span></div>
    </div>
  )
}

export function ResultSummary({ mode, period, values, estimated = false, primaryTitle }: { mode: CalculationMode; period: string; values: Readonly<ResultValues>; estimated?: boolean; primaryTitle?: string }) {
  const inverse = mode === "net-to-gross"
  return (
    <div className="summary-grid">
      <div className="primary-result">
        <div className="primary-result-copy">
          <h3>{primaryTitle ?? (inverse ? "Salario bruto requerido" : estimated ? "Salario neto estimado" : "Salario neto obtenido")}</h3>
          <ResultAmount value={inverse ? values.grossSalary : values.netSalary} className="primary-amount" describedBy={estimated ? "result-message" : undefined} />
          <span>{period} · MXN</span>
        </div>
        <span className="primary-result-icon" aria-hidden="true"><Calculator /></span>
      </div>
      <SummaryCard title={inverse ? "Salario neto obtenido" : "Salario bruto"} value={inverse ? values.netSalary : values.grossSalary} period={period} tone="summary-net" icon={Banknote} />
      <SummaryCard title={estimated ? "ISR retenido" : "ISR"} value={values.isr} period={period} tone="summary-isr" icon={FileText} estimated={estimated} />
      <SummaryCard title={estimated ? "IMSS descontado" : "IMSS (cuota obrera)"} value={values.workerImss} period={period} tone="summary-imss" icon={Shield} estimated={estimated} />
    </div>
  )
}
