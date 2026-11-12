// TEST-ONLY rational oracle. No production payroll imports or production JSON.
// Tariff data come from the independently transcribed DOF fixture of Hito 2C.
import csv from "./isr-2026.expected.csv?raw"

type Q = Readonly<{ n: bigint; d: bigint }>
const q = (n: bigint, d = 1n): Q => ({ n, d })
function dec(s: string): Q {
  const [a, b = ""] = s.split(".")
  return q(BigInt(a + b), 10n ** BigInt(b.length))
}
const add = (a: Q, b: Q) => q(a.n * b.d + b.n * a.d, a.d * b.d)
const mul = (a: Q, b: Q) => q(a.n * b.n, a.d * b.d)
const div = (a: Q, b: Q) => q(a.n * b.d, a.d * b.n)
const compare = (a: Q, b: Q) => a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0
const round = (a: Q) => (2n * a.n + a.d) / (2n * a.d)
export const referenceCents = (s: string) => round(mul(dec(s), q(100n)))
export const referenceMoney = (c: bigint) => `${c < 0n ? "-" : ""}${(c < 0n ? -c : c) / 100n}.${((c < 0n ? -c : c) % 100n).toString().padStart(2, "0")}`
type Period = "weekly" | "fortnightly" | "monthly"
export type ReferenceSettings = Readonly<{ periodicity: Period; january: boolean; includeImss: boolean; confirmedMinimum: boolean; benefits: Readonly<{ annualBonusDays: string; annualVacationDays: string; vacationPremiumPercent: string }> }>
const rows = csv.split(/\r?\n/).filter(line => line && !line.startsWith("#")).slice(1).map(line => {
  const [periodicity, lower, upper, fee, rate] = line.split(",")
  return { periodicity, lower: referenceCents(lower), upper: upper ? referenceCents(upper) : null, fee: q(referenceCents(fee)), rate: div(dec(rate), q(100n)) }
})
export function referenceOracle(s: ReferenceSettings): (g: bigint) => bigint | null {
  const days = { weekly: 7n, fortnightly: 15n, monthly: 30n }[s.periodicity]
  const minGross = 31504n * days
  const factor = add(q(1n), div(add(dec(s.benefits.annualBonusDays), mul(dec(s.benefits.annualVacationDays), div(dec(s.benefits.vacationPremiumPercent), q(100n)))), q(365n)))
  const cap = s.january ? 282850n : 293275n
  const threshold = s.january ? 33942n : 35193n
  const monthly = mul(dec(s.january ? "3439.46" : "3566.22"), dec(s.january ? "0.1559" : "0.1502"))
  const subsidy = round(mul(s.periodicity === "monthly" ? monthly : div(mul(monthly, q(days)), dec("30.4")), q(100n)))
  const tariff = rows.filter(row => row.periodicity === s.periodicity)
  return gross => {
    if (gross < minGross) return null
    if (gross === minGross) return s.confirmedMinimum ? gross : null
    const rawSbc = mul(div(q(gross), q(days)), factor) // SBC in cents
    const bounded = compare(rawSbc, q(31504n)) < 0 ? q(31504n) : compare(rawSbc, q(cap)) > 0 ? q(cap) : rawSbc
    const b = round(bounded)
    const excess = b > threshold ? b - threshold : 0n
    const fees = [mul(q(b * days), q(3n, 800n)), mul(q(b * days), q(1n, 400n)), mul(q(b * days), q(1n, 160n)), mul(q(b * days), q(9n, 800n)), mul(q(excess * days), q(1n, 250n))]
    const imss = s.includeImss ? fees.reduce((sum, fee) => sum + round(fee), 0n) : 0n
    const row = tariff.find(row => gross >= row.lower && (row.upper === null || gross <= row.upper))!
    const tax = round(add(row.fee, mul(q(gross - row.lower), row.rate)))
    const eligible = gross * 30n <= 1149266n * days
    const applied = eligible ? subsidy < tax ? subsidy : tax : 0n
    return gross - (tax - applied) - imss
  }
}
export function exhaustiveReference(s: ReferenceSettings, from: string, to: string, target: string): string[] {
  const evaluate = referenceOracle(s)
  const wanted = referenceCents(target)
  const result: string[] = []
  for (let g = referenceCents(from); g <= referenceCents(to); g++) if (evaluate(g) === wanted) result.push(referenceMoney(g))
  return result
}
