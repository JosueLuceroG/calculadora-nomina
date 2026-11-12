import { Pencil } from "lucide-react"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { paymentPeriods, type CaptureForm } from "../form"
import { formatMxn } from "../format"
import { readableCivilDate, type FiscalExecutionMetadata } from "../date-policy"

/** Captured inputs only: these amounts never populate fiscal result values. */
export function CaptureSummary({ form, onEdit, onClear, area = "", statusText = "Captura conservada.", execution, statusAdornment, paymentDate }: { form: CaptureForm; onEdit: () => void; onClear?: () => void; area?: string; statusText?: string; execution?: FiscalExecutionMetadata; statusAdornment?: ReactNode; paymentDate?: string }) {
  const inverse = form.mode === "net-to-gross"
  const period = paymentPeriods.find(item => item.value === form.period)?.label ?? "Sin seleccionar"
  return (
    <section className="surface capture-summary" aria-labelledby="capture-summary-title">
      <header className="capture-summary-header">
        <div>
          <h2 id="capture-summary-title">Datos capturados <span>· {inverse ? "Neto a bruto" : "Bruto a neto"}</span>{statusAdornment}</h2>
          {execution?.completedAt ? <p role="status" className="capture-summary-timing" data-date-mode={execution.referenceMode} data-package-id={execution.packageId ?? ""}>
            Consulta: {execution.consultationLocalDate}{" · "}Realización: <time dateTime={execution.completedAt}>{execution.completedLocalDate} {execution.completedLocalTime}</time>{" · "}Referencia {execution.referenceMode === "automatic" ? "automática" : "manual"}
          </p> : <p role="status">{statusText}</p>}
        </div>
        <div className="capture-summary-actions">
          {onClear && <Button type="button" variant="secondary" onClick={onClear}>Limpiar</Button>}
          <Button type="button" variant="outline" onClick={onEdit}><Pencil />Editar datos</Button>
        </div>
      </header>
      <dl className="capture-summary-values">
        <div><dt>{inverse ? "Neto deseado capturado" : "Bruto ofrecido capturado"}</dt><dd className="captured-amount">{formatMxn(form.amount)} <span>MXN</span></dd></div>
        <div><dt>Periodicidad</dt><dd>{period}</dd></div>
        <div><dt>Fecha de referencia fiscal</dt><dd><time dateTime={form.effectiveDate}>{execution ? readableCivilDate(form.effectiveDate) : form.effectiveDate}</time></dd></div>
        {paymentDate && <div><dt>Fecha de pago · solo sesión</dt><dd><time dateTime={paymentDate}>{readableCivilDate(paymentDate)}</time></dd></div>}
        <div><dt>Incluir IMSS</dt><dd>{form.includeImss ? "Sí" : "No"}</dd></div>
      </dl>
      <p className="capture-summary-benefits">
        Aguinaldo: {form.bonusDays ? `${form.bonusDays} días` : "sin capturar"}
        {" · "}Vacaciones: {form.vacationDays ? `${form.vacationDays} días` : "sin capturar"}
        {" · "}Prima vacacional: {form.vacationPremium ? `${form.vacationPremium}%` : "sin capturar"}
        {" · "}Zona salarial: {area === "general-zone" ? "Zona general" : "sin seleccionar"}
      </p>
    </section>
  )
}
