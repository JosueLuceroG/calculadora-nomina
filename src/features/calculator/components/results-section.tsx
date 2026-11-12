import { Calculator, Check, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { paymentPeriods, type CalculationMode, type PaymentPeriod } from "../form"
import { emptyResultValues, type DemonstrationResult } from "../results"
import { ResultSummary } from "./result-summary"
import { ResultDetails } from "./result-details"
import { CalculationFeedback } from "./calculation-feedback"
import type { FiscalOutcome, FiscalPresentation, MinimumDeclaration } from "../fiscal-adapter"
import type { CalculationPhase } from "../calculation-controller"
import { InverseReconciliation } from "./inverse-feedback"
import { importantWarnings, inverseStatus, matchingForwardReport } from "./result-presentation"

const futureActionsNotice = "Exportar PDF requiere un resultado vigente y fielmente representable."

export function ResultsSection({ mode, period = "", demonstration, presentation, report, error, phase, onCancel, requestId = 0, onConfirmMinimum, onExportPdf, exportBusy=false, hideExportPdf=false }: {
  mode: CalculationMode
  period?: PaymentPeriod | ""
  demonstration?: DemonstrationResult
  presentation?: FiscalPresentation
  report?: FiscalOutcome["report"]
  error?: string
  phase?: CalculationPhase
  onCancel?: () => void
  requestId?: number
  onConfirmMinimum?: (requestId: number, declaration: MinimumDeclaration) => void
  onExportPdf?: () => void
  exportBusy?: boolean
  hideExportPdf?: boolean
}) {
  const busy = phase === "calculating"
  const cancelled = phase === "cancelled"
  const compatible = mode === "gross-to-net" ? presentation?.kind === "direct" : presentation?.kind === "inverse"
  const fiscal = !demonstration && !error && !busy && !cancelled && compatible ? presentation : undefined
  const activeMode = demonstration?.mode ?? mode
  const activePeriod = demonstration?.period ?? period
  const periodLabel = paymentPeriods.find(item => item.value === activePeriod)?.label
  const displayedPeriod = periodLabel ? `(${periodLabel})` : "Periodo pendiente"
  const values = demonstration?.values ?? fiscal?.values ?? emptyResultValues
  const complete = fiscal?.determination === "complete-estimate"
  const conditionalMinimum = fiscal?.warnings.some(w => w.code === "MONTHLY_MINIMUM_CONDITION_ASSUMED")
  const lowSalary = fiscal?.issues.some(i => i.code === "WORKER_IMSS_CONTRACT_BELOW_GENERAL_MINIMUM")
  const inverse = fiscal?.inverse
  const forward = matchingForwardReport(fiscal, report)
  const inverseMessage = fiscal?.inverse ? inverseStatus(fiscal.inverse, fiscal.fiscalStatus) : null
  const message = demonstration ? `DEMO · ${demonstration.notice}` : error ? error : busy ? "Calculando bruto… Puedes cancelar o editar los datos." : cancelled ? "Cálculo cancelado. La captura se conserva; puedes editar y volver a calcular." : inverseMessage ? `Estimación estándar 2026 · ${inverseMessage}${conditionalMinimum ? " Hipótesis mensual aplicada al mínimo." : ""}` : fiscal?.confirmation?.contextual ? fiscal.fiscalStatus==='not-supported'?'Estimación estándar 2026 · Contexto fuera del perfil; retención y neto no determinados.':'Estimación estándar 2026 · Falta precisar base salarial o contexto mensual; retención y neto no determinados.' : fiscal?.confirmation ? "Estimación estándar 2026 · ISR retenido y neto pendientes de hipótesis mensual." : lowSalary ? "Estimación estándar 2026 · Bloqueado: salario contractual inferior al mínimo." : fiscal?.fiscalStatus === "not-supported" ? "Estimación estándar 2026 · Escenario no soportado; no hay neto determinado." : fiscal && !complete ? "Estimación estándar 2026 · Faltan datos para determinar el resultado; importes desconocidos en —." : conditionalMinimum ? "Estimación estándar 2026 · No retención por hipótesis mensual no verificada." : complete ? "Estimación estándar 2026." : "Sin resultados calculados."
  const resultState = demonstration ? "demonstration" : error ? "error" : busy ? "calculating" : cancelled ? "cancelled" : inverse ? inverse.coverage === "limited" ? "limited" : inverse.match === "exact" ? "exact" : inverse.match === "approximate" ? "approximate" : inverse.noExactMatchProven ? "no-exact" : "blocked" : fiscal ? complete ? "estimated" : "blocked" : "empty"
  const primaryTitle = inverse ? inverse.match === "approximate" ? "Bruto aproximado" : inverse.match === "none" ? "Bruto no determinado" : inverse.minimumProven ? "Bruto mínimo demostrado" : "Bruto encontrado" : mode === "net-to-gross" && (busy || cancelled || error) ? "Salario bruto estimado" : undefined
  const successful = demonstration || (fiscal && !conditionalMinimum && !fiscal.confirmation && fiscal.issues.length === 0 && importantWarnings(fiscal).length === 0 && (complete || (inverse?.match === "exact" && inverse.coverage === "complete" && inverse.minimumProven)))
  return (
    <section className="surface results-section" aria-labelledby="results-title" aria-busy={busy} data-result-state={resultState}>
      <header className="results-header">
        <div className="results-heading">
          <span className={`result-check${successful ? "" : " result-check-empty"}`} aria-hidden="true">{successful ? <Check /> : <Calculator />}</span>
          <div><h2 id="results-title" tabIndex={-1} aria-describedby="result-message">Resultado del cálculo</h2><p id="result-message" role={error || lowSalary ? "alert" : "status"} className={demonstration ? "result-demo-notice" : undefined}>{message}</p></div>
        </div>
        <div className="result-actions" role="group" aria-label="Acciones del resultado">
          {busy && <Button type="button" variant="outline" onClick={onCancel} disabled={!onCancel}>Cancelar</Button>}
          {!hideExportPdf&&<><Button type="button" variant="outline" disabled={!fiscal||phase!=="result"||!onExportPdf||exportBusy} aria-describedby="result-actions-status" onClick={onExportPdf}><FileText />Exportar PDF</Button>
          <span id="result-actions-status" className="sr-only">{exportBusy?"Hay una exportación PDF en curso.":onExportPdf?"Guarda un reporte local con el resultado original.":futureActionsNotice}</span></>}
        </div>
      </header>

      <ResultSummary mode={activeMode} period={displayedPeriod} values={values} estimated={Boolean(fiscal)} primaryTitle={primaryTitle} />
      {inverse && <InverseReconciliation inverse={inverse} />}
       <ResultDetails period={displayedPeriod} paymentPeriod={activePeriod} values={values} presentation={fiscal} forward={forward} />
      {fiscal && <CalculationFeedback key={requestId} presentation={fiscal} forward={forward} report={report} requestId={requestId} onConfirm={onConfirmMinimum} />}
    </section>
  )
}
