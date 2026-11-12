import { mkdirSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import fixture from "./fixtures/operational-4b1.expected.json"
import { calculateStandardEstimatedGrossToNet } from "../domain/payroll/gross-to-net"
import { calculateStandardEstimatedNetToGross } from "../domain/payroll/net-to-gross"
import type { StandardEstimatedGrossToNetInput, StandardEstimatedGrossToNetResult } from "../domain/payroll/gross-to-net-contracts"
import type { PayrollPeriodicity } from "../domain/payroll/contracts"
import { FISCAL_PARAMETERS_2026, standardGrossToNetContext2026 } from "../infrastructure/fiscal/2026"

type Components = Record<string, string | null>
type Comparison = { component: string; expected: string | null; obtained: string | null; difference: string | null; matches: boolean }
type RecordRow = { id: string; family: string; operation: string; request: unknown; expectedStatus: string; obtainedStatus: string; comparisons: Comparison[]; conclusion: string; details: unknown }
const records: RecordRow[] = []
const context = standardGrossToNetContext2026()
const out = fileURLToPath(new URL("../../docs/evidence/4b1/", import.meta.url))

// Solo corrección numérica reproducible: el rendimiento se mide aparte con reloj
// real en la ventana nativa. No modifica el presupuesto/evaluador del producto.
beforeEach(() => vi.spyOn(performance, "now").mockReturnValue(0))
afterEach(() => vi.restoreAllMocks())

function units(value: string, places: number): bigint {
  const negative = value.startsWith("-")
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".")
  const result = BigInt(whole) * 10n ** BigInt(places) + BigInt(fraction.padEnd(places, "0").slice(0, places) || "0")
  return negative ? -result : result
}
function text(value: bigint, places: number): string {
  const absolute = value < 0n ? -value : value
  const scale = 10n ** BigInt(places)
  return `${value < 0n ? "-" : ""}${absolute / scale}.${(absolute % scale).toString().padStart(places, "0")}`
}
function shown(value: string | undefined, places = 2): string | null {
  if (value === undefined) return null
  const fraction = value.split(".")[1] ?? ""
  const rounded = units(value, places) + (fraction.length > places && fraction[places] >= "5" ? 1n : 0n)
  return text(rounded, places)
}
function components(report: StandardEstimatedGrossToNetResult): Components {
  const integration = report.integration.data
  const result: Components = {
    gross: report.gross.amount,
    daily: integration?.dailySalary.presentation.amount ?? null,
    factor4: shown(integration?.factor.value, 4),
    benefitDays: shown(integration?.equivalentAnnualBenefitDays.value),
    sdi: integration?.theoreticalSdi.presentation.amount ?? null,
    sbc: report.sbc?.status === "estimated" ? report.sbc.data.sbc.estimatedSbc : null,
    isrTariff: report.isr.accordingToTariff.amount,
    isrProvisional: report.isr.afterSubsidyProvisional.amount,
    isrWithheld: report.isr.withheld.amount,
    subsidyDetermined: report.subsidy.determined.amount,
    subsidyPotential: report.subsidy.potentiallyApplicable.amount,
    subsidyApplied: report.subsidy.applied.amount,
    subsidyDisplaced: report.subsidy.notAppliedDueToNoWithholding.amount,
    subsidyExcess: report.subsidy.excessOverTariffIsrNotDelivered.amount,
    subsidyTotalUnused: report.subsidy.totalNotApplied.amount,
    subsidyCash: report.subsidy.cashDelivered.amount,
    imssCalculated: report.imss.calculated.amount,
    imssDeducted: report.imss.deducted.amount,
    imssAbsorbed: report.imss.absorbedByEmployer.amount,
    imssExcluded: report.imss.excludedBySimulation.amount,
    net: report.net.amount,
  }
  for (const name of ["pensioner-medical", "cash-benefits", "disability-life", "unemployment-old-age", "excess-medical"] as const) {
    const quotas = report.imss.byBranch?.[name].quotas
    result[`branch.${name}.calculated`] = quotas?.calculated ?? null
    result[`branch.${name}.deducted`] = quotas?.deducted ?? null
    result[`branch.${name}.absorbed`] = quotas?.absorbedByEmployer ?? null
    result[`branch.${name}.excluded`] = quotas?.excludedBySimulation ?? null
  }
  return result
}
function compare(expected: Components, actual: Components): Comparison[] {
  return Object.entries(expected).map(([component, wanted]) => {
    const obtained = actual[component] ?? null
    const places = component === "factor4" ? 4 : 2
    return { component, expected: wanted, obtained, difference: wanted === null || obtained === null ? null : text(units(obtained, places) - units(wanted, places), places), matches: wanted === obtained }
  })
}
function forwardInput(request: { gross: string; periodicity: string; date: string; benefits: StandardEstimatedGrossToNetInput["benefits"]; includeImss: boolean; confirmed: boolean }): StandardEstimatedGrossToNetInput {
  return {
    profileId: "standard-estimate-2026-v1", grossPeriodSalary: request.gross,
    periodicity: request.periodicity as PayrollPeriodicity, referenceDate: request.date,
    benefits: request.benefits, area: "general-zone", includeWorkerImss: request.includeImss,
    minimumWageMonthlyScenario: request.confirmed ? { kind: "only-general-minimum-assumed-for-reference-month", referenceMonth: request.date.slice(0, 7), noOtherSalaryPayments: true, acknowledgement: "explicit-standard-simulation-assumption-not-payroll-verification" } : { kind: "unconfirmed" },
  }
}
function record(id: string, family: string, operation: string, request: unknown, expectedStatus: string, report: StandardEstimatedGrossToNetResult, expected: Components, details: unknown = null) {
  const comparisons = compare(expected, components(report))
  const row: RecordRow = { id, family, operation, request, expectedStatus, obtainedStatus: report.status, comparisons,
    conclusion: comparisons.every(c => c.matches) && expectedStatus === report.status ? "conforme-aritmetica-del-perfil-no-homologacion" : "diferencia-requiere-investigacion",
    details: { extra: details, package: report.provenance.fiscalPackageVersion, foundations: ["Anexo 8 B.II/B.IV/B.V; RMF 3.12.2", "Decretos subsidio 01/05/2024 y 31/12/2025", "INEGI UMA 2025/2026", "CONASAMI resolución 2026, III/IV", "LSS 25/27/28/29/36/106/107/147/168 y transitorio XIX", "LISR 96", "LFT 76/80/85/87/90"], issues: report.issues.map(i => i.code), retention: report.retention.kind, normativeReview: family === "M05" || family === "M11" ? "minimum-monthly-30-vs-365/12-pending-review" : "profile-rounding-not-SUA-certified" },
  }
  records.push(row)
  expect(report.status, id).toBe(expectedStatus)
  expect(comparisons.filter(c => !c.matches), id).toEqual([])
}

describe("4B.1: fuente recién cotejada y oráculo Python Fraction sin importaciones productivas", () => {
  it.each(["weekly", "fortnightly", "monthly"] as const)("las 11 filas %s coinciden con DOF/SAT, no se generan desde el paquete", period => {
    const actual = FISCAL_PARAMETERS_2026.isrTariffs.find(t => t.key === period)!.data.rows
    expect(actual).toEqual(fixture.tariffs[period])
    expect(fixture.tariffProof.find(p => p.periodicity === period)?.rowsCheckedAgainstSatPdf).toBe(11)
  })
  it.each(fixture.direct)("$id: comparación por componente, incluyendo nulos y cinco ramos", scenario => {
    const report = calculateStandardEstimatedGrossToNet(forwardInput(scenario.request), context)
    record(scenario.id, scenario.family, "gross-to-net", scenario.request, scenario.expected.status, report, scenario.expected.components, { independentParameters: scenario.expected })
  })
  it.each(fixture.inverse)("$id: candidatos con verificación aritmética independiente", async scenario => {
    const r = scenario.request
    const base = forwardInput({ gross: "1.00", ...r })
    const { grossPeriodSalary: _gross, minimumWageMonthlyScenario: _monthly, ...common } = base
    const report = await calculateStandardEstimatedNetToGross({
      ...common, targetNet: r.targetNet, fiscalPackageVersion: "mx-fiscal-2026-source-v3",
      minimumWageCandidateScenario: r.confirmed ? { kind: "conditional-for-exact-minimum", declaration: { kind: "only-general-minimum-assumed-for-reference-month", referenceMonth: r.date.slice(0, 7), noOtherSalaryPayments: true, acknowledgement: "explicit-standard-simulation-assumption-not-payroll-verification" } } : { kind: "unconfirmed" },
      ...(r.domain ? { searchOptions: { grossRange: r.domain } } : {}),
    }, context)
    const known = scenario.expectedCandidates.map(c => c.gross)
    expect(report.exactCandidates.map(c => c.gross)).toEqual(known)
    const details = { match: report.match, coverage: report.coverage.state, domain: report.coverage.domain, minimumProven: report.coverage.minimumProven, uniquenessProven: report.coverage.uniquenessProven, noExactMatchProven: report.coverage.noExactMatchProven, recommendationBasis: report.recommendationBasis, stopReason: report.metrics.stopReason, actualCandidates: report.exactCandidates, referenceWindows: scenario.referenceWindows, independentCoverage: scenario.independentCoverage }
    for (const expected of scenario.expectedCandidates) {
      const candidate = report.exactCandidates.find(c => c.gross === expected.gross)!
      expect(candidate.net).toBe(expected.net)
      expect(candidate.difference).toBe("0.00")
      const forward = calculateStandardEstimatedGrossToNet(forwardInput({ ...r, gross: candidate.gross, confirmed: candidate.scenario === "conditional-minimum" }), context)
      record(`${scenario.id}@${candidate.gross}`, scenario.family, "net-to-gross", r, "estimated", forward, expected.expectedForward.components, { ...details, independentParameters: expected.expectedForward })
    }
    if (scenario.expectedNearest) {
      const nearest = scenario.expectedNearest
      expect(report.match).toBe("approximate")
      expect(report.recommended).toMatchObject({ gross: nearest.gross, net: nearest.net, difference: nearest.difference })
      expect(report.coverage.noExactMatchProven).toBe(true)
      expect(report.recommendedForwardResult).not.toBeNull()
      record(scenario.id, scenario.family, "net-to-gross", r, "estimated", report.recommendedForwardResult!, nearest.expectedForward.components, { ...details, independentParameters: nearest.expectedForward })
    }
    if (scenario.id === "M11-unconfirmed") {
      expect(report.coverage.state).toBe("fiscally-incomplete")
      expect(report.coverage.minimumProven).toBe(false)
      expect(report.coverage.uniquenessProven).toBe(false)
    }
    if (scenario.id === "M11-confirmed") {
      expect(report.recommended?.gross).toBe("9451.20")
      expect(report.coverage.minimumProven).toBe(true)
    }
  }, 20000)
})

afterAll(() => {
  mkdirSync(out, { recursive: true })
  writeFileSync(`${out}matrix-results.json`, JSON.stringify({ executedOn: new Date().toISOString(), referenceMethod: fixture.method, fiscalPackage: "mx-fiscal-2026-source-v3", arithmeticComparisonOnly: true, comparisonsWithExternalSystems: "pending-no-access", records }, null, 2))
  const columns = ["id", "family", "operation", "request", "expectedStatus", "obtainedStatus", "component", "expected", "obtained", "difference", "matches", "conclusion"]
  const lines = [columns.join(",")]
  for (const row of records) for (const c of row.comparisons) {
    const values = [row.id, row.family, row.operation, JSON.stringify(row.request), row.expectedStatus, row.obtainedStatus, c.component, c.expected, c.obtained, c.difference, c.matches, row.conclusion]
    lines.push(values.map(v => JSON.stringify(v === null ? "UNKNOWN" : String(v))).join(","))
  }
  writeFileSync(`${out}matrix-results.csv`, lines.join("\n") + "\n")
  const body = records.map(row => {
    const net = row.comparisons.find(c => c.component === "net")!
    const gross = row.comparisons.find(c => c.component === "gross")!
    const isr = row.comparisons.find(c => c.component === "isrWithheld")!
    const imss = row.comparisons.find(c => c.component === "imssDeducted")!
    return `| ${row.id} | ${gross.obtained} | ${net.expected ?? "—"} | ${net.obtained ?? "—"} | ${isr.obtained ?? "—"} | ${imss.obtained ?? "—"} | ${row.comparisons.every(c => c.matches) ? "Sin diferencias" : "REVISAR"} |`
  })
  writeFileSync(`${out}matrix-summary.md`, ["# M01–M12: resultados aritméticos del perfil", "", "Esperados: Python Fraction independiente y tarifas DOF/SAT recién cotejadas. No es homologación ni aprobación de interpretación normativa.", "", "| Caso | Bruto | Neto esperado | Neto motor | ISR retenido | IMSS descontado | Comparación completa |", "| --- | --- | --- | --- | --- | --- | --- |", ...body, "", "Detalles de entradas, supuestos, estado y diferencias por componente: matrix-results.json y matrix-results.csv.", ""].join("\n"))
})
