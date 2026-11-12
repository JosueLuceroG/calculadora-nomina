import type { CalculationMode, PaymentPeriod } from "./form"

/** Presentation only. This contract neither calculates nor validates taxes. */
export type ResultValues = {
  grossSalary: string | null
  netSalary: string | null
  workerImss: string | null
  taxableIncome: string | null
  isr: string | null
  employmentSubsidy: string | null
  dailySalary: string | null
  integrationFactor: string | null
  integratedDailySalary: string | null
  contributionBaseSalary: string | null
  integratedBenefitDays: string | null
  integratedVariableIncome: string | null
}

export type DemonstrationResult = {
  kind: "demonstration"
  notice: string
  mode: CalculationMode
  period: PaymentPeriod
  values: ResultValues
}

export const emptyResultValues: Readonly<ResultValues> = Object.freeze({
  grossSalary: null,
  netSalary: null,
  workerImss: null,
  taxableIncome: null,
  isr: null,
  employmentSubsidy: null,
  dailySalary: null,
  integrationFactor: null,
  integratedDailySalary: null,
  contributionBaseSalary: null,
  integratedBenefitDays: null,
  integratedVariableIncome: null,
})
