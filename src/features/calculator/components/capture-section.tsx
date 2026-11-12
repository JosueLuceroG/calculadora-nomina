import { useEffect, useState, type FormEvent, type ReactNode } from "react"
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CalendarDays,
  DollarSign,
  ChevronDown,
  Shield,
  Gift,
  MapPin,
  Percent,
  RotateCcw,
  Sun,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { PreviewField } from "./preview-field"
import { createInitialForm, fiscalFieldIds, paymentPeriods, supportedCaptureProfile, type FiscalCaptureErrors, type CaptureForm } from "../form"
import { validateFiscalCapture } from "../validation"
import { isCivilDate } from "@/domain/payroll/civil-date"

/** Optional session note; never a field of the fiscal capture/document. */
export function paymentDateError(date: string): string | undefined {
  return date === "" || isCivilDate(date) ? undefined : "Elige una fecha de pago válida."
}

export function CaptureSection({ form, onFormChange, onValidated, onClear, externalErrors = {}, disabled = false, dateControl, dateBlocked = false, paymentDate = "", onPaymentDateChange }: {
  form: CaptureForm;
  onFormChange: (form: CaptureForm) => void; onValidated: () => void; onClear?: () => void;
  externalErrors?: FiscalCaptureErrors; disabled?: boolean
  dateControl?: (dateError?: string) => ReactNode; dateBlocked?: boolean
  paymentDate?: string; onPaymentDateChange?: (date: string) => void
}) {
  const [localErrors, setErrors] = useState<FiscalCaptureErrors>({})
  const [moneySession, setMoneySession] = useState(0)
  const [paymentDateTouched, setPaymentDateTouched] = useState(false)
  const [optionsExpanded, setOptionsExpanded] = useState(dateBlocked || Boolean(externalErrors.effectiveDate))
  useEffect(() => { setOptionsExpanded(false) }, [form.includeImss])
  useEffect(() => { if (dateBlocked || externalErrors.effectiveDate) setOptionsExpanded(true) }, [dateBlocked, externalErrors.effectiveDate])
  const paymentError = paymentDateTouched ? paymentDateError(paymentDate) : undefined
  const errors = { ...localErrors, ...externalErrors }
  // El validador describe la cadena canónica; las comas visibles las añade la UI.
  const amountError = errors.amount?.replace(", sin separadores de miles.", ".")
  useEffect(() => {
    setErrors(previous => previous.effectiveDate ? { ...previous, effectiveDate: undefined } : previous)
  }, [form.effectiveDate])

  function update<K extends keyof CaptureForm>(field: K, value: CaptureForm[K]) {
    onFormChange({ ...form, [field]: value })
    setErrors(previous => {
      const next = { ...previous }
      if (field in next) delete next[field as keyof FiscalCaptureErrors]
      return next
    })
  }

  function clear() {
    // Reinicia el historial del input incluso si el importe ya estaba vacío.
    setMoneySession(previous => previous + 1)
    setPaymentDateTouched(false)
    setOptionsExpanded(false)
    onPaymentDateChange?.("")
    if (onClear) onClear(); else onFormChange(createInitialForm())
    setErrors({})
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextErrors = validateFiscalCapture(form, supportedCaptureProfile.area)
    const invalidPaymentDate = paymentDateError(paymentDate)
    setPaymentDateTouched(true)
    setErrors(nextErrors)
    const firstError = (Object.keys(fiscalFieldIds) as (keyof FiscalCaptureErrors)[]).find(field => nextErrors[field])
    if (firstError) {
      if (firstError === "effectiveDate") setOptionsExpanded(true)
      requestAnimationFrame(() => document.getElementById(fiscalFieldIds[firstError])?.focus())
    }
    else if (invalidPaymentDate) { setOptionsExpanded(true); requestAnimationFrame(() => document.getElementById("payment-date")?.focus()) }
    else if (!dateBlocked) onValidated()
  }

  return (
    <form className="surface capture-section" aria-labelledby="capture-title" onSubmit={submit} noValidate>
      <ol className="steps" aria-label="Etapas del cálculo">
        <li className="step step-active" aria-current="step">
          <span className="step-number">1</span><h2 id="capture-title">Datos del cálculo</h2>
        </li>
        <li className="step"><span className="step-number">2</span><span>Calcular</span></li>
        <li className="step"><span className="step-number">3</span><span>Resultado</span></li>
      </ol>

      <div className="capture-grid capture-grid-simple">
        <div className="capture-fields">
          <div className="mode-grid" role="group" aria-label="Modo de cálculo">
            <Button type="button" variant="outline" className={`mode-card${form.mode === "net-to-gross" ? " mode-card-selected" : ""}`} aria-pressed={form.mode === "net-to-gross"} onClick={() => update("mode", "net-to-gross")}>
              <span className="mode-icon"><ArrowDown /></span>
              <span className="mode-copy"><strong>Neto a bruto</strong><span>¿Cuánto debo pagar para que reciba ese neto?</span></span>
            </Button>
            <Button type="button" variant="outline" className={`mode-card${form.mode === "gross-to-net" ? " mode-card-selected" : ""}`} aria-pressed={form.mode === "gross-to-net"} onClick={() => update("mode", "gross-to-net")}>
              <span className="mode-icon"><ArrowUp /></span>
              <span className="mode-copy"><strong>Bruto a neto</strong><span>¿Cuánto recibiría el trabajador?</span></span>
            </Button>
          </div>

          <div className="salary-grid">
            <PreviewField key={moneySession} id="salary" label={form.mode === "net-to-gross" ? "Salario neto deseado" : "Salario bruto ofrecido"} icon={DollarSign} placeholder="Importe por capturar" money suffix="MXN" value={form.amount} onValueChange={value => update("amount", value)} error={amountError} required />
            <PreviewField id="period" label="Periodicidad de pago" icon={CalendarDays} placeholder="Seleccionar periodo" select options={paymentPeriods} value={form.period} onValueChange={value => update("period", value as CaptureForm["period"])} error={errors.period} required />
          </div>
          <div className="benefits-grid">
            <PreviewField id="bonus-days" label="Días de aguinaldo" icon={Gift} placeholder="Días" inputMode="decimal" value={form.bonusDays} onValueChange={value => update("bonusDays", value)} error={errors.bonusDays} required />
            <PreviewField id="vacation-days" label="Días de vacaciones" icon={Sun} placeholder="Días" inputMode="decimal" value={form.vacationDays} onValueChange={value => update("vacationDays", value)} error={errors.vacationDays} hint="12 días: referencia inicial; ajusta por antigüedad y prestaciones pactadas." required />
            <PreviewField id="vacation-premium" label="Prima vacacional" icon={Percent} placeholder="Porcentaje" suffix="%" inputMode="decimal" value={form.vacationPremium} onValueChange={value => update("vacationPremium", value)} error={errors.vacationPremium} required />
          </div>
          <p className="capture-template-note">Plantilla editable; no acredita las prestaciones de cada trabajador.</p>
        </div>

        <div className="capture-profile">
          <fieldset id="state" tabIndex={-1} className="worker-imss-choice" data-salary-area={supportedCaptureProfile.area} aria-labelledby="worker-imss-label">
            <div className="worker-imss-row">
              <span id="worker-imss-label">¿Descontar IMSS al trabajador?</span>
              <div className="worker-imss-options">
                <label><input id="include-imss" type="radio" name="worker-imss" value="yes" checked={form.includeImss} onChange={() => { setOptionsExpanded(false); update("includeImss", true) }} />Sí</label>
                <label><input id="exclude-imss" type="radio" name="worker-imss" value="no" checked={!form.includeImss} onChange={() => { setOptionsExpanded(false); update("includeImss", false) }} />No</label>
              </div>
              {form.includeImss ? <button type="button" className="imss-expand-toggle" aria-label={optionsExpanded ? "Ocultar opciones IMSS y fechas" : "Mostrar opciones IMSS y fechas"} aria-expanded={optionsExpanded} aria-controls="capture-options" onClick={() => setOptionsExpanded(previous => !previous)}><ChevronDown size={17} aria-hidden="true" /></button>
                : <button type="button" className="capture-dates-toggle" aria-expanded={optionsExpanded} aria-controls="capture-options" onClick={() => setOptionsExpanded(previous => !previous)}><CalendarDays size={16} aria-hidden="true" />Fechas</button>}
            </div>
            {optionsExpanded && <div id="capture-options" className="capture-options" role="region" aria-label={form.includeImss ? "Opciones IMSS y fechas" : "Fechas del cálculo"}>
              {form.includeImss && <div className="capture-options-imss">
              <div className="preview-field imss-method">
              <label htmlFor="imss-method">Tipo de descuento IMSS</label>
              <div className="field-control">
                <span className="field-icon"><Shield size={19} aria-hidden="true" /></span>
                <select id="imss-method" value="automatic" onChange={() => {}} aria-describedby="imss-method-note">
                  <option value="automatic">IMSS estimado automáticamente</option>
                  <option value="manual" disabled>Capturar importe de IMSS manualmente (no disponible)</option>
                </select>
                <ChevronDown size={16} className="field-suffix" aria-hidden="true" />
              </div>
              <p id="imss-method-note" className="field-hint">La captura manual no está habilitada en el cálculo actual.</p>
              </div>
              <div>
                <p className="imss-area"><MapPin size={15} aria-hidden="true" />Zona salarial: <strong>{supportedCaptureProfile.areaLabel}</strong></p>
                <p className="field-hint">Solo zona general. El IMSS se estima automáticamente.</p>
              </div>
              </div>}
              <div className="capture-dates">
                {dateControl ? dateControl(errors.effectiveDate) : <PreviewField id="effective-date" label="Fecha de referencia fiscal" icon={CalendarDays} placeholder="dd/mm/aaaa" type="date" value={form.effectiveDate} onValueChange={value => update("effectiveDate", value)} error={errors.effectiveDate} compact required />}
                <PreviewField id="payment-date" label="Fecha de pago" icon={CalendarDays} placeholder="dd/mm/aaaa" type="date" value={paymentDate} onValueChange={value => { setPaymentDateTouched(true); onPaymentDateChange?.(value) }} error={paymentError} compact hint="Opcional y solo de sesión. No cambia las tablas; no se guarda ni aparece en el PDF." />
              </div>
            </div>}
            {!form.includeImss && <p id="worker-imss-note">Sin descuento en esta simulación; no representa una exención legal del IMSS.</p>}
            {errors.area && <p id="state-error" className="field-error" role="alert">{errors.area}</p>}
          </fieldset>
        </div>
      </div>

      <div className="capture-footer">
        <div className="capture-actions">
          <Button type="button" variant="secondary" onClick={clear}><RotateCcw />Limpiar</Button>
          <Button type="submit" className="calculate-button" disabled={disabled || dateBlocked} aria-describedby={dateBlocked ? "effective-date-error" : undefined}><ArrowRight />Calcular</Button>
        </div>
      </div>
    </form>
  )
}
