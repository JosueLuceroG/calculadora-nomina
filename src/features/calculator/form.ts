export const paymentPeriods = [
  { value: "weekly", label: "Semanal" },
  { value: "fortnightly", label: "Quincenal" },
  { value: "monthly", label: "Mensual" },
] as const

export type CalculationMode = "net-to-gross" | "gross-to-net"
export type PaymentPeriod = (typeof paymentPeriods)[number]["value"]

export type CaptureForm = {
  mode: CalculationMode
  amount: string
  period: PaymentPeriod | ""
  effectiveDate: string
  bonusDays: string
  vacationDays: string
  vacationPremium: string
  includeImss: boolean
}

export type CaptureField = Exclude<keyof CaptureForm, "mode" | "includeImss">
export type CaptureErrors = Partial<Record<CaptureField, string>>
export type SupportedSalaryArea = "general-zone" | ""
export type FiscalCaptureErrors = CaptureErrors & { area?: string }

/** Perfil visible de captura; no es un default dentro del motor/adaptador. */
export const supportedCaptureProfile = Object.freeze({ area: "general-zone" as const, areaLabel: "General" })

/** Plantilla editable de simulación, no acredita derechos por antigüedad. */
export const initialBenefits = Object.freeze({ bonusDays: "15", vacationDays: "12", vacationPremium: "25" })

export const fieldIds: Record<CaptureField, string> = {
  amount: "salary",
  period: "period",
  bonusDays: "bonus-days",
  vacationDays: "vacation-days",
  vacationPremium: "vacation-premium",
  effectiveDate: "effective-date",
}
export const fiscalFieldIds: Record<keyof FiscalCaptureErrors, string> = { ...fieldIds, area: "state" }

export function createInitialForm(): CaptureForm {
  return {
    mode: "net-to-gross",
    amount: "",
    period: "",
    effectiveDate: "",
    ...initialBenefits,
    includeImss: true,
  }
}
