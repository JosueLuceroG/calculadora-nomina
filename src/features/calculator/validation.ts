import { paymentPeriods, type CaptureErrors, type CaptureForm, type FiscalCaptureErrors } from "./form"

/** Calendario civil, sin Date, UTC ni conversiones de zona horaria. */
export function isValidCivilDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split("-").map(Number)
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= days[month - 1]
}

/** Solo validación de captura. Ninguna operación monetaria ni regla fiscal. */
export function validateCapture(form: CaptureForm): CaptureErrors {
  const errors: CaptureErrors = {}

  if (!form.amount) {
    errors.amount = "Captura el importe."
  } else if (!/^\d+(?:\.\d{1,2})?$/.test(form.amount)) {
    errors.amount = "Usa un importe decimal con punto y máximo dos decimales, sin separadores de miles."
  } else if (!/[1-9]/.test(form.amount)) {
    errors.amount = "El importe debe ser mayor que cero."
  }

  if (!paymentPeriods.some(period => period.value === form.period)) {
    errors.period = "Selecciona la periodicidad de pago."
  }

  if (!form.effectiveDate) {
    errors.effectiveDate = "Selecciona la fecha efectiva."
  } else if (!isValidCivilDate(form.effectiveDate)) {
    errors.effectiveDate = "Selecciona una fecha válida."
  }

  for (const field of ["bonusDays", "vacationDays", "vacationPremium"] as const) {
    if (form[field] !== "" && !/^\d+(?:\.\d+)?$/.test(form[field])) {
      errors[field] = field === "vacationPremium"
        ? "Usa un porcentaje no negativo con punto decimal, sin el símbolo %."
        : "Usa días no negativos con punto decimal, sin letras ni separadores."
    }
  }

  return errors
}

/** Requisitos explícitos de ejecución visual para ambos sentidos. */
export function validateFiscalCapture(form: CaptureForm, area: string): FiscalCaptureErrors {
  const errors: FiscalCaptureErrors = { ...validateCapture(form) }
  if (errors.effectiveDate) errors.effectiveDate = form.effectiveDate ? "Selecciona una fecha normativa válida." : "Selecciona la fecha normativa."
  for (const field of ["bonusDays", "vacationDays", "vacationPremium"] as const) {
    if (form[field] === "") errors[field] = "Captura esta prestación anual; no se asignan valores por defecto."
  }
  if (area === "") errors.area = "Selecciona la zona salarial."
  else if (area !== "general-zone") errors.area = "Solo está soportada la zona general."
  return errors
}
