import { emptyResultValues, type DemonstrationResult } from "../results"

/** Visual test literals only. Never imported by App or derived from capture. */
export const visualResultFixture = Object.freeze({
  kind: "demonstration",
  notice: "Valores ficticios para pruebas visuales. No son un cálculo fiscal.",
  mode: "net-to-gross",
  period: "monthly",
  values: Object.freeze({
    ...emptyResultValues,
    grossSalary: "20000.00",
    netSalary: "18000.00",
    workerImss: "500.00",
    taxableIncome: "20000.00",
    isr: "1500.00",
    employmentSubsidy: "0.00",
    // No integration factors or bases are invented for this fixture.
  }),
} satisfies DemonstrationResult)
