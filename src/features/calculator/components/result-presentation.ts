import type { FiscalOutcome, FiscalPresentation } from "../fiscal-adapter"
import type { PaymentPeriod } from "../form"
import { DECIMAL_POLICY, divideDecimals, moneyText, presentMoney } from "@/domain/payroll/money"
export type ForwardReport = Extract<FiscalOutcome["report"], { operation: "gross-to-net" }>

/** Display-only period average; never written into a fiscal report, SBC or SDI. */
export function referenceDailySalary(amount: string | null, period: PaymentPeriod | ""): string | null {
  const days = period === "weekly" ? "7" : period === "fortnightly" ? "15" : period === "monthly" ? "30" : null
  if (amount === null || days === null) return null
  return presentMoney(divideDecimals(moneyText(amount, "non-negative"), days).value, DECIMAL_POLICY.displayRounding).amount
}

/** Selección de datos ya calculados, nunca un segundo cálculo fiscal. */
export function matchingForwardReport(presentation: FiscalPresentation | undefined, report: FiscalOutcome["report"] | undefined) {
  if (!presentation || !report || (presentation.kind === "direct") !== (report.operation === "gross-to-net")) return undefined
  const forward = report.operation === "gross-to-net" ? report : report.recommendedForwardResult
  if (!forward || forward.gross.amount !== presentation.values.grossSalary || forward.net.amount !== presentation.values.netSalary
    || forward.isr.withheld.amount !== presentation.values.isr || forward.imss.deducted.amount !== presentation.values.workerImss) return undefined
  return forward
}

export function auxiliaryDecimal(value: string | null): string | null {
  // Solo auxiliares no monetarios: presentación a cuatro decimales mediante
  // caracteres/BigInt, sin importar ni invocar el núcleo fiscal desde la UI.
  if (value === null || !/^\d+\.\d{5,}$/.test(value)) return value
  const [whole, fraction] = value.split(".")
  const scaled = BigInt(whole + fraction.slice(0, 4)) + (fraction[4] >= "5" ? 1n : 0n)
  const digits = scaled.toString().padStart(5, "0")
  return `${digits.slice(0, -4)}.${digits.slice(-4)}`.replace(/0+$/, "").replace(/\.$/, "")
}

// Avisos ordinarios resumidos en la nota siempre visible y ampliados en el nivel
// comprensible. Todo código nuevo/no clasificado permanece visible por defecto.
const ordinaryNotices: Readonly<Record<string, string>> = {
  ESTIMATED_MONTHLY_REFERENCE: "El ingreso mensual es una referencia estimada a partir del periodo elegido, no un ingreso real comprobado.",
  MONTHLY_SUBSIDY_RECONCILIATION_NOT_SIMULATED: "No se concilian otros pagos ni subsidios previos del mismo mes.",
  EMPLOYER_ELECTION_NOT_EVALUATED: "No se comprueba la elección del empleador para aplicar subsidio ni la existencia de otros empleadores.",
  SUBSIDY_EXCESS_NOT_PAID_OR_CARRIED: "El excedente de subsidio no se entrega en efectivo ni se suma al neto.",
  STANDARD_RESULT_NOT_CERTIFIED: "Esta simulación no certifica percepciones, retenciones practicadas ni una liquidación mensual real.",
}
export function importantWarnings(presentation: FiscalPresentation) {
  return presentation.warnings.filter(warning => !Object.hasOwn(ordinaryNotices, warning.code))
}
export function readableWarning(warning: FiscalPresentation["warnings"][number]) {
  return Object.hasOwn(ordinaryNotices, warning.code) ? ordinaryNotices[warning.code] : warning.message
}

export function inverseStatus(inverse: NonNullable<FiscalPresentation["inverse"]>, status: FiscalPresentation["fiscalStatus"]): string {
  if (status === "not-supported") return "Resultado no determinable. Escenario no soportado; no hay bruto determinado."
  const limited = inverse.coverage === "limited" ? "Búsqueda limitada. " : ""
  const conditional = inverse.coverage === "fiscally-incomplete" ? " Condición fiscal pendiente; la búsqueda no está cerrada." : ""
  if (inverse.match === "none") return inverse.noExactMatchProven
    ? `${limited}Resultado no determinable: ausencia de coincidencia exacta demostrada solo en el dominio analizado.${conditional}`
    : `${limited}Resultado no determinable: sin candidato verificado; no se ha demostrado ausencia de solución.${conditional}`
  if (inverse.match === "approximate") return `${limited}Aproximado: el neto obtenido difiere del solicitado. No se garantiza la mejor aproximación global.${conditional}`
  const guarantee = inverse.minimumProven ? "Bruto mínimo demostrado en el dominio analizado." : "Bruto encontrado: mínimo no demostrado; puede existir un bruto menor."
  return `${limited}Exacto · ${guarantee}${conditional}`
}
