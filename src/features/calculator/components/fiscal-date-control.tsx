import { useRef, useState } from "react"
import { CalendarDays, CircleHelp } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { DateSession } from "../date-policy"
import { readableCivilDate } from "../date-policy"
import type { FiscalDateCoverage } from "../fiscal-adapter"

export const fiscalDateHelp = "Esta fecha indica qué tablas de ISR, UMA, subsidio y otros parámetros fiscales se utilizan. Por defecto usamos la fecha de hoy. Puedes elegir otra fecha para hacer una simulación con las reglas disponibles de ese momento. No necesariamente coincide con el día de pago."

export function FiscalDateControl({ session, coverage, error, stale, onManual, onAutomatic, onChange }: {
  session: DateSession; coverage: FiscalDateCoverage; error?: string; stale?: boolean;
  onManual: () => void; onAutomatic: () => void; onChange: (date: string) => void
}) {
  const [help, setHelp] = useState(false)
  const helpButton = useRef<HTMLButtonElement>(null)
  const unavailable = coverage.reason === "outside-coverage" || coverage.reason === "parameters-unavailable"
  const message = stale ? "Cambió el día desde que preparaste esta simulación. Actualiza a hoy o elige otra fecha antes de calcular." : unavailable ? `No hay parámetros compatibles para ${readableCivilDate(session.referenceDate)}. Elige manualmente una fecha entre ${coverage.supportedDates.from} y ${coverage.supportedDates.through}.` : error
  return <div className="fiscal-date-control" onKeyDown={event => {
    if (event.key === "Escape" && help) { setHelp(false); helpButton.current?.focus() }
  }}>
    <div className="fiscal-date-label">
      <label htmlFor="effective-date">Fecha de referencia fiscal</label>
      <button ref={helpButton} type="button" className="date-help-toggle" aria-label="Ayuda sobre Fecha de referencia fiscal" aria-expanded={help} aria-controls="fiscal-date-help" aria-describedby={help ? "fiscal-date-help" : undefined} onClick={() => setHelp(!help)}><CircleHelp size={16} /></button>
    </div>
    <div className="field-control">
      <span className="field-icon"><CalendarDays size={19} aria-hidden="true" /></span>
      {session.mode === "manual" ? <input id="effective-date" type="date" value={session.referenceDate} min={coverage.supportedDates.from} max={coverage.supportedDates.through} aria-required="true" aria-invalid={Boolean(message)} aria-describedby={message ? "effective-date-error" : "fiscal-date-note"} onChange={event => onChange(event.target.value)} /> : <output id="effective-date" tabIndex={0} data-reference-date={session.referenceDate} aria-describedby={message ? "effective-date-error" : "fiscal-date-note"}>{readableCivilDate(session.referenceDate)}</output>}
    </div>
    <fieldset className="date-mode"><legend>Elegir otra fecha</legend>
      <label><input type="radio" name="fiscal-date-mode" value="no" checked={session.mode === "automatic"} onChange={onAutomatic} />No</label>
      <label><input type="radio" name="fiscal-date-mode" value="yes" checked={session.mode === "manual"} onChange={onManual} />Sí</label>
    </fieldset>
    <p id="fiscal-date-note" className="date-note">{session.preservedFromResult ? "Fecha conservada al editar el resultado." : session.mode === "automatic" ? "Automática: determina los parámetros fiscales." : "Determina parámetros; no es la fecha de pago."}</p>
    {help && <div id="fiscal-date-help" className="date-help-content" role="note">{fiscalDateHelp}</div>}
    {message && <p id="effective-date-error" className="field-error" role="alert">{message}</p>}
    {stale && <Button type="button" variant="outline" className="date-refresh" onClick={onAutomatic}>Usar fecha de hoy</Button>}
  </div>
}
