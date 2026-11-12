import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createContextualFiscalAdapter, createFiscalAdapter, type FiscalCapture } from "../features/calculator/fiscal-adapter"
import { createContextualCalculationController } from "../features/calculator/calculation-controller"
import { createInitialForm } from "../features/calculator/form"
import { ResultsSection } from "../features/calculator/components/results-section"
import { FISCAL_PARAMETERS_2026, standardGrossToNetContext2026 } from "../infrastructure/fiscal/2026"
import { createEmbeddedFiscalRegistry2026 } from "../infrastructure/fiscal/package-registry"
import { ENGINE_FISCAL_CAPABILITIES as capabilities } from "../infrastructure/fiscal/engine-capabilities"
import { resolveFiscalExecution } from "../domain/fiscal-runtime/resolver"
import { calculateStandardEstimatedNetToGross } from "../domain/payroll/net-to-gross"
import type { StandardNetToGrossInput } from "../domain/payroll/net-to-gross-contracts"
import { certifyInverseProfile } from "../domain/payroll/net-to-gross-certificate"
import { defaultRetentionContext, type ContextualRetentionContext } from "../domain/payroll/minimum-retention-context"
import * as forwardModule from "../domain/payroll/gross-to-net"
import * as inverseModule from "../domain/payroll/net-to-gross"
import identity from "../features/storage/build-identity.json"

const evidence = (name: string) => fileURLToPath(new URL(`../../docs/evidence/${name}`, import.meta.url))
type Case = { id: string; gross: string; period: "weekly" | "fortnightly" | "monthly"; date: string; includeImss: boolean; context: ContextualRetentionContext; expected: Record<string, string | null> }
type Window = { id: string; date: string; includeImss: boolean; context: ContextualRetentionContext; from: string; to: string; target: string; candidates: string[]; unresolved: string[]; complete: boolean; minimumProven: boolean }
const controls = JSON.parse(readFileSync(evidence("5c2/independent-controls.json"), "utf8")) as { cases: Case[]; inverse: Window[] }
const old = createFiscalAdapter(standardGrossToNetContext2026(), true), current = createContextualFiscalAdapter()
const registry = createEmbeddedFiscalRegistry2026(), grant = capabilities.authorizations[0]
const counts = { directReports: 0, independentComponents: 0, inverseWindows: 0, inverseCents: 0, inverseProductiveReports: 0 }
function capture(gross = "15000.00", period: Case["period"] = "monthly", date = "2026-02-01", includeImss = true, mode: "gross-to-net" | "net-to-gross" = "gross-to-net"): FiscalCapture {
  return { form: { ...createInitialForm(), amount: gross, period, effectiveDate: date, includeImss, mode }, area: "general-zone" }
}
function resolved(date: string, operation: "gross-to-net" | "net-to-gross" = "net-to-gross") {
  const result = resolveFiscalExecution({ fiscalDate: date, periodicity: "monthly", simulationProfileId: grant.simulationProfileId, ruleProfileId: grant.ruleProfileId, contextualPolicyId: grant.contextualPolicyId, operation, requiredCapabilities: ["direct", "inverse"] }, registry, capabilities)
  if (result.status !== "resolved") throw new Error(result.code)
  return result.context
}
beforeEach(() => vi.spyOn(performance, "now").mockReturnValue(0))
afterEach(() => vi.restoreAllMocks())

describe("5D.2a equivalencia completa con composición productiva anterior", () => {
  it.each(controls.cases)("1260 vectores independientes, reporte y presentación: $id", c => {
    const input = capture(c.gross, c.period, c.date, c.includeImss)
    const previous = old.prepare(input, c.context), next = current.prepare(input, c.context)
    expect(next).toEqual(previous)
    if (!previous.ok || previous.prepared.mode !== "gross-to-net" || !next.ok || next.prepared.mode !== "gross-to-net") throw new Error("prepare")
    const before = old.direct(previous.prepared), after = current.direct(next.prepared)
    expect(after).toEqual(before)
    const r = after.report
    const got = { state: r.retention.assessment?.state ?? null, status: r.status, gross: r.gross.amount, isrTariff: r.isr.accordingToTariff.amount,
      subsidyDetermined: r.subsidy.determined.amount, subsidyPotential: r.subsidy.potentiallyApplicable.amount, subsidyApplied: r.subsidy.applied.amount,
      subsidyDisplaced: r.subsidy.notAppliedDueToNoWithholding.amount, subsidyExcess: r.subsidy.excessOverTariffIsrNotDelivered.amount,
      isrWithheld: r.isr.withheld.amount, net: r.net.amount, imssCalculated: r.imss.calculated.amount, imssDeducted: r.imss.deducted.amount,
      imssAbsorbed: r.imss.absorbedByEmployer.amount, imssExcluded: r.imss.excludedBySimulation.amount, sbc: r.sbc?.status === "estimated" ? r.sbc.data.sbc.estimatedSbc : null }
    expect(got).toEqual(c.expected)
    counts.directReports++; counts.independentComponents += Object.keys(got).length
  })
  it.each(controls.inverse)("42 ventanas: reporte completo, Fraction y cada centavo: $id", async c => {
    const input = { profileId: grant.simulationProfileId, periodicity: "monthly", referenceDate: c.date, benefits: { annualBonusDays: "15", annualVacationDays: "12", vacationPremiumPercent: "25" }, area: "general-zone", includeWorkerImss: c.includeImss,
      fiscalPackageVersion: identity.fiscalPackage.version, targetNet: c.target, minimumWageCandidateScenario: c.context, searchOptions: { grossRange: { from: c.from, to: c.to } } }
    const previous = await calculateStandardEstimatedNetToGross(input, standardGrossToNetContext2026())
    const next = await calculateStandardEstimatedNetToGross(input, resolved(c.date).engineContext)
    expect(next).toEqual(previous)
    expect(next.exactCandidates.map(v => v.gross)).toEqual(c.candidates)
    expect(next.coverage.exactSetComplete).toBe(c.complete)
    expect(next.coverage.minimumProven).toBe(c.minimumProven)
    const cents = (value: string) => BigInt(value.replace(".", "")), unresolved = new Set(c.unresolved.map(cents))
    for (let gross = cents(c.from); gross <= cents(c.to); gross++) {
      const rows = next.coverage.evidence.filter(row => cents(row.from) <= gross && gross <= cents(row.to))
      expect(rows).toHaveLength(1)
      expect(rows[0].disposition === "fiscally-unresolved").toBe(unresolved.has(gross))
      counts.inverseCents++
    }
    counts.inverseWindows++
  })
  it.each([
    ["weekly", "3076.67"], ["fortnightly", "6592.87"], ["monthly", "13202.64"], ["monthly", "9451.20"],
  ] as const)("inverso por puerta productiva %s/%s, incluido certificado/alternativas/UI", async (period, target) => {
    const input = capture(target, period, "2026-02-01", true, "net-to-gross")
    const previous = old.prepare(input), next = current.prepare(input)
    if (!previous.ok || previous.prepared.mode !== "net-to-gross" || !next.ok || next.prepared.mode !== "net-to-gross") throw new Error("prepare")
    const before = await old.inverse(previous.prepared), after = await current.inverse(next.prepared)
    expect(after).toEqual(before)
    const markup = (presentation: typeof after.presentation) => renderToStaticMarkup(createElement(ResultsSection, { mode: "net-to-gross", period, presentation }))
    expect(markup(after.presentation)).toBe(markup(before.presentation))
    if (target === "9451.20") {
      expect(after.report.exactCandidates.map(c => c.gross)).toEqual(["9877.38", "9877.39"])
      expect(after.report.coverage.minimumProven).toBe(false)
      expect(after.report.coverage.exactSetComplete).toBe(false)
    }
    counts.inverseProductiveReports++
  }, 20000)
  it("hipótesis condicional inversa no se propaga a superiores", async () => {
    const scenario = { ...defaultRetentionContext("2026-02-01"), salaryBasis: "agreed-daily-reference" as const, monthlyCondition: "minimum-only-assumed" as const, noOtherSalaryPayments: true, acknowledgement: "explicit-standard-simulation-assumption-not-payroll-verification" as const }
    const c = capture("9451.20", "monthly", "2026-02-01", true, "net-to-gross"), a = old.prepare(c, scenario), b = current.prepare(c, scenario)
    if (!a.ok || a.prepared.mode !== "net-to-gross" || !b.ok || b.prepared.mode !== "net-to-gross") throw new Error("prepare")
    const before = await old.inverse(a.prepared), after = await current.inverse(b.prepared)
    expect(after).toEqual(before)
    expect(after.report.exactCandidates.map(c => c.gross)).toEqual(["9451.20", "9877.38", "9877.39"])
    expect(after.report.exactCandidates.filter(c => c.scenario === "conditional-minimum").map(c => c.gross)).toEqual(["9451.20"])
    counts.inverseProductiveReports++
  }, 20000)
  it("resolver no llama a motores ni certificado para decidir disponibilidad", () => {
    const forward = vi.spyOn(forwardModule, "calculateStandardEstimatedGrossToNet"), inverse = vi.spyOn(inverseModule, "calculateStandardEstimatedNetToGross")
    resolved("2026-02-01")
    expect(forward).not.toHaveBeenCalled(); expect(inverse).not.toHaveBeenCalled()
  })
  it("la puerta rechaza2027 antes del motor y conserva captura/diagnóstico", () => {
    const forward = vi.spyOn(forwardModule, "calculateStandardEstimatedGrossToNet"), controller = createContextualCalculationController()
    const run = controller.submit(capture("15000.00", "monthly", "2027-01-01"))
    expect(run.accepted).toBe(false)
    expect(controller.getState()).toMatchObject({ phase: "capture-error", captureIssues: [{ field: "effectiveDate", code: "EXERCISE_PACKAGE_MISSING" }] })
    expect(forward).not.toHaveBeenCalled(); controller.dispose()
  })
  it("no se puede reutilizar una petición de otra instancia ni una copia", () => {
    const p = current.prepare(capture())
    if (!p.ok || p.prepared.mode !== "gross-to-net") throw new Error("prepare")
    const request = p.prepared
    expect(() => createContextualFiscalAdapter().direct(request)).toThrow("no pertenece")
    expect(() => current.direct({ ...request })).toThrow("no pertenece")
    expect(current.direct(p.prepared).report.net.amount).toBe("13202.64")
  })
  it("captura/contexto preparados no cambian al editar datos externos", () => {
    const c = { ...structuredClone(capture()) }, p = current.prepare(c)
    if (!p.ok || p.prepared.mode !== "gross-to-net") throw new Error("prepare")
    c.form = { ...c.form, amount: "9582.47", effectiveDate: "2027-01-01" }
    expect(current.direct(p.prepared).report.net.amount).toBe("13202.64")
    expect(p.prepared.snapshot.form.effectiveDate).toBe("2026-02-01")
  })
  it("cancelación real sigue transmitiendo señal y no publica resultado obsoleto", async () => {
    const inverse = vi.spyOn(inverseModule, "calculateStandardEstimatedNetToGross"), controller = createContextualCalculationController()
    const c = capture("13202.64", "monthly", "2026-02-01", true, "net-to-gross")
    const run = controller.submit({ ...c, form: { ...c.form, bonusDays: "365000000" } })
    const signal = (inverse.mock.calls[0][0] as StandardNetToGrossInput).searchOptions?.signal
    expect(signal).toBeInstanceOf(AbortSignal)
    controller.cancel()
    expect(signal?.aborted).toBe(true)
    await run.completion
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(controller.getState()).toMatchObject({ phase: "cancelled", outcome: null })
    controller.dispose()
  })
  it("las políticas del registro no fabrican certificado ni borran precondiciones", () => {
    const p = current.prepare(capture())
    if (!p.ok || p.prepared.mode !== "gross-to-net") throw new Error("prepare")
    const r = current.direct(p.prepared).report
    if (r.status !== "estimated") throw new Error("forward")
    expect(certifyInverseProfile(r).available).toBe(true)
    expect(certifyInverseProfile({ ...r, retention: { ...r.retention, assessment: undefined } }).available).toBe(false)
    expect(capabilities.authorizations[0]).not.toHaveProperty("certified")
  })
  it("manifest y huella canónica originales: datos,33filas,11conjuntos y fuentes", () => {
    const canonical = (value: unknown): string => JSON.stringify(value, (_, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)
    const sha = createHash("sha256").update(canonical(FISCAL_PARAMETERS_2026)).digest("hex")
    const m = registry.entries[0].manifest
    expect(sha).toBe(identity.fiscalPackage.sha256)
    expect(m.contentIdentity.sha256).toBe(sha)
    expect(grant.content.sha256).toBe(sha)
    expect(m.packageId).toBe(identity.fiscalPackage.id)
    expect(m.parameterVersion).toBe(identity.fiscalPackage.version)
    expect(m.parameterSets).toEqual(identity.fiscalPackage.parameterSets)
    expect(FISCAL_PARAMETERS_2026.isrTariffs.flatMap(t => t.data.rows)).toHaveLength(33)
    expect(m.parameterSets).toHaveLength(11)
    expect(registry.entries[0].reference?.verification).toEqual({ data: "source-verified", basis: "embedded-build", integrity: "build-asserted" })
    expect(m).not.toHaveProperty("signature")
  })
})
afterAll(() => writeFileSync(evidence("5d2a/equivalence.json"), JSON.stringify({ ...counts, monetaryDifferences: [], oracle: "explicit previous contextual composition + archived Fraction controls", timing: "performance.now fixed at zero for deterministic comparisons" }, null, 2) + "\n"))
