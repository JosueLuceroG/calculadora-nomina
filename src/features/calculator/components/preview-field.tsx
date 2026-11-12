import type { LucideIcon } from "lucide-react"
import { ChevronDown } from "lucide-react"
import { Input } from "@/components/ui/input"
import { MoneyInput } from "./money-input"

type PreviewFieldProps = {
  id: string
  label: string
  icon: LucideIcon
  placeholder: string
  select?: boolean
  suffix?: string
  compact?: boolean
  value?: string
  onValueChange?: (value: string) => void
  options?: readonly { value: string; label: string }[]
  disabled?: boolean
  type?: "text" | "date"
  inputMode?: "decimal"
  required?: boolean
  error?: string
  hint?: string
  money?: boolean
}

/** Captura controlada; los controles fuera del alcance siguen deshabilitados. */
export function PreviewField({ id, label, icon: Icon, placeholder, select, suffix, compact, value = "", onValueChange, options = [], disabled = false, type = "text", inputMode, required, error, hint, money = false }: PreviewFieldProps) {
  const accessibility = {
    id,
    disabled,
    title: disabled ? "Sin opciones adicionales validadas; no disponible en este hito." : undefined,
    "aria-required": required,
    "aria-invalid": Boolean(error),
    "aria-describedby": [error ? `${id}-error` : "", hint ? `${id}-hint` : ""].filter(Boolean).join(" ") || undefined,
  }
  return (
    <div className={`preview-field${compact ? " preview-field-compact" : ""}`}>
      <label htmlFor={id}>{label}</label>
      <div className={`field-control${error ? " field-control-error" : ""}`}>
        <span className="field-icon"><Icon size={19} aria-hidden="true" /></span>
        {select ? (
          <select {...accessibility} value={value} onChange={event => onValueChange?.(event.target.value)}>
            <option value="">{placeholder}</option>
            {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        ) : money ? (
          <MoneyInput {...accessibility} placeholder={placeholder} value={value} onValueChange={onValueChange} />
        ) : (
          <Input {...accessibility} type={type} inputMode={inputMode} placeholder={placeholder} value={value} onChange={event => onValueChange?.(event.target.value)} />
        )}
        {select && <ChevronDown size={16} className="field-suffix" aria-hidden="true" />}
        {suffix && <span className="field-suffix">{suffix}</span>}
      </div>
      {error && <p id={`${id}-error`} className="field-error">{error}</p>}
      {hint && <p id={`${id}-hint`} className="field-hint">{hint}</p>}
    </div>
  )
}
