import Decimal from "decimal.js"
import { afterEach, describe, expect, it, vi } from "vitest"
import fixture from "../../tests/fixtures/net-to-gross.expected.json"
import { exhaustiveReference, referenceCents, referenceMoney, referenceOracle, type ReferenceSettings } from "../../tests/fixtures/inverse-reference"
import { standardGrossToNetContext2026 } from "../../infrastructure/fiscal/2026"
import type { PayrollPeriodicity } from "./contracts"
import * as forwardOperations from "./gross-to-net"
import { STANDARD_CONVENTIONS } from "./simulation-conventions"
import { calculateStandardEstimatedNetToGross } from "./net-to-gross"
import type { StandardEstimatedNetToGrossResult, StandardNetToGrossInput } from "./net-to-gross-contracts"

const context = standardGrossToNetContext2026()
const standardBenefits = { annualBonusDays: "15", annualVacationDays: "12", vacationPremiumPercent: "25" }
const zeroBenefits = { annualBonusDays: "0", annualVacationDays: "0", vacationPremiumPercent: "0" }
function input(patch: Partial<StandardNetToGrossInput> = {}): StandardNetToGrossInput {
  return { targetNet: "13202.64", profileId: STANDARD_CONVENTIONS.id, fiscalPackageVersion: context.fiscalPackageVersion, periodicity: "monthly", referenceDate: "2026-02-01", benefits: standardBenefits, area: "general-zone", includeWorkerImss: true, minimumWageCandidateScenario: { kind: "unconfirmed" }, ...patch }
}
function confirmed(month = "2026-02"): StandardNetToGrossInput["minimumWageCandidateScenario"] {
  return { kind: "conditional-for-exact-minimum", declaration: { kind: "only-general-minimum-assumed-for-reference-month", referenceMonth: month, noOtherSalaryPayments: true, acknowledgement: "explicit-standard-simulation-assumption-not-payroll-verification" } }
}
function checkLedger(result: StandardEstimatedNetToGrossResult) {
  const domain = result.coverage.domain
  if (!domain) return
  let next = referenceCents(domain.from)
  for (const interval of result.coverage.evidence) {
    expect(referenceCents(interval.from), JSON.stringify(interval)).toBe(next)
    expect(referenceCents(interval.to)).toBeGreaterThanOrEqual(next)
    next = referenceCents(interval.to) + 1n
  }
  expect(next).toBe(referenceCents(domain.to) + 1n)
}
function noFalseProof(result: StandardEstimatedNetToGrossResult) {
  if (result.coverage.state !== "complete") {
    expect(result.coverage.uniquenessProven).toBe(false)
    expect(result.coverage.noExactMatchProven).toBe(false)
    expect(result.coverage.exactSetComplete).toBe(false)
  }
  checkLedger(result)
}
afterEach(() => vi.restoreAllMocks())

describe("inverso: oráculos exhaustivos independientes", () => {
  it.each(fixture.cases)("$id: raíces, mínimo, unicidad y ausencia en dominio declarado", async sample => {
    const settings: ReferenceSettings = { periodicity: sample.periodicity as PayrollPeriodicity, january: sample.january, includeImss: sample.includeImss, confirmedMinimum: sample.confirmed, benefits: sample.zeroBenefits ? zeroBenefits : standardBenefits }
    const expected = exhaustiveReference(settings, sample.from, sample.to, sample.target)
    expect(expected).toEqual(sample.expected)
    const result = await calculateStandardEstimatedNetToGross(input({ targetNet: sample.target, periodicity: settings.periodicity, includeWorkerImss: settings.includeImss, referenceDate: settings.january ? "2026-01-31" : "2026-02-01", benefits: settings.benefits, minimumWageCandidateScenario: sample.confirmed ? confirmed() : { kind: "unconfirmed" }, searchOptions: { grossRange: { from: sample.from, to: sample.to } } }), context)
    expect(result.coverage.state, JSON.stringify(result.metrics)).toBe("complete")
    expect(result.exactCandidates.map(c => c.gross)).toEqual(expected)
    expect(result.coverage.minimumProven).toBe(expected.length > 0)
    expect(result.coverage.uniquenessProven).toBe(expected.length === 1)
    expect(result.coverage.noExactMatchProven).toBe(expected.length === 0)
    expect(result.smallestFound?.gross ?? null).toBe(expected[0] ?? null)
    expect(result.coverage.multipleSolutionsVerified).toBe(expected.length > 1)
    for (const candidate of result.exactCandidates) {
      expect(candidate.difference).toBe("0.00")
      expect(candidate.net).toBe(sample.target)
      expect(candidate.fiscalStatus).toBe("estimated")
    }
    if (result.recommended) {
      expect(result.recommendedForwardResult?.net.amount).toBe(result.recommended.net)
      expect(result.recommendedForwardResult?.gross.amount).toBe(result.recommended.gross)
    }
    checkLedger(result)
  }, 20000)

  it.each(fixture.observations)("oráculo reproduce bajadas/saltos reales $gross → $net", sample => {
    const oracle = referenceOracle({ periodicity: sample.periodicity as PayrollPeriodicity, january: false, includeImss: true, confirmedMinimum: false, benefits: standardBenefits })
    expect(referenceMoney(oracle(referenceCents(sample.gross))!)).toBe(sample.net)
  })

  it.each([
    ["15000.18", "15000.25", "13202.79"],
    ["14999.30", "14999.40", "13202.12"],
    ["11492.60", "11492.72", "10844.47"],
    ["11492.60", "11492.72", "10308.83"],
    ["14990.00", "15010.00", "13205.00"],
  ])("adversarial %s–%s objetivo %s: compara cada centavo independientemente", async (from, to, target) => {
    const expected = exhaustiveReference({ periodicity: "monthly", january: false, includeImss: true, confirmedMinimum: false, benefits: standardBenefits }, from, to, target)
    const result = await calculateStandardEstimatedNetToGross(input({ targetNet: target, searchOptions: { grossRange: { from, to } } }), context)
    expect(result.coverage.state).toBe("complete")
    expect(result.exactCandidates.map(c => c.gross)).toEqual(expected)
    checkLedger(result)
  })

  it("dominio completo ordinario usa podas certificadas, no barrido gigantesco", async () => {
    const result = await calculateStandardEstimatedNetToGross(input(), context)
    expect(result.exactCandidates.some(c => c.gross === "15000.00")).toBe(true)
    expect(result.coverage.state, JSON.stringify(result.metrics)).toBe("complete")
    expect(result.metrics.certifiedClosures).toBeGreaterThan(0)
    expect(result.metrics.directEvaluations).toBeLessThan(4096)
    expect(result.provenance.certificationAvailable).toBe(true)
    checkLedger(result)
  }, 10000)
  it("cada centavo podado en un dominio adversarial respeta la envolvente independiente", async () => {
    const oracle = referenceOracle({ periodicity: "monthly", january: false, includeImss: true, confirmedMinimum: false, benefits: standardBenefits })
    const target = referenceCents("13202.64")
    const result = await calculateStandardEstimatedNetToGross(input({ searchOptions: { grossRange: { from: "14900.00", to: "15100.00" } } }), context)
    expect(result.coverage.state).toBe("complete")
    let checked = 0
    for (const interval of result.coverage.evidence) {
      if (!interval.proof) continue
      const p = interval.proof
      const a = referenceCents(p.from), b = referenceCents(p.to)
      expect(a - oracle(a)!).toBe(referenceCents(p.kFrom))
      expect(b - oracle(b)!).toBe(referenceCents(p.kTo))
      for (let g = referenceCents(interval.from); g <= referenceCents(interval.to); g++) {
        const n = oracle(g)!
        if (n < referenceCents(p.netLower) || n > referenceCents(p.netUpper) || n === target) throw new Error(`Invalid exclusion at ${referenceMoney(g)}`)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(10000)
    checkLedger(result)
  }, 20000)
  it("índices en el extremo de mil millones se comparan exactamente con el oráculo", async () => {
    const from = "999999999.99", to = "1000000000.00"
    const settings: ReferenceSettings = { periodicity: "monthly", january: false, includeImss: true, confirmedMinimum: false, benefits: standardBenefits }
    const oracle = referenceOracle(settings)
    const targetNet = referenceMoney(oracle(referenceCents(to))!)
    const result = await calculateStandardEstimatedNetToGross(input({ targetNet, searchOptions: { grossRange: { from, to } } }), context)
    expect(result.exactCandidates.map(c => c.gross)).toEqual(exhaustiveReference(settings, from, to, targetNet))
    expect(result.coverage.state).toBe("complete")
    checkLedger(result)
  })

  it("cada coincidencia y aproximación procede de una llamada directa única por clave", async () => {
    const calls: string[] = []
    const real = forwardOperations.calculateStandardEstimatedGrossToNet
    const spy = vi.spyOn(forwardOperations, "calculateStandardEstimatedGrossToNet").mockImplementation((capture, ctx) => {
      const v = capture as { grossPeriodSalary: string; minimumWageMonthlyScenario: unknown }
      calls.push(`${v.grossPeriodSalary}|${JSON.stringify(v.minimumWageMonthlyScenario)}`)
      return real(capture, ctx)
    })
    const result = await calculateStandardEstimatedNetToGross(input({ searchOptions: { grossRange: { from: "14998.00", to: "15002.00" } } }), context)
    expect(spy).toHaveBeenCalledTimes(result.metrics.directEvaluations)
    expect(new Set(calls).size).toBe(calls.length)
    expect(result.metrics.cacheHits).toBeGreaterThan(0)
    for (const candidate of result.exactCandidates) expect(calls.some(key => key.startsWith(`${candidate.gross}|`))).toBe(true)
  })
  it.each([
    ["5557.04", "6216.15", "5557.03", "-0.01"],
    ["5557.05", "6216.16", "5557.06", "0.01"],
  ])("hueco %s conserva aproximación %s, diferencia %s/%s sin llamarla exacta", async (targetNet, gross, net, difference) => {
    const result = await calculateStandardEstimatedNetToGross(input({ targetNet, periodicity: "fortnightly", searchOptions: { grossRange: { from: "6216.15", to: "6216.16" } } }), context)
    expect(result.match).toBe("approximate")
    expect(result.recommended).toMatchObject({ gross, net, difference, absoluteDifference: "0.01" })
    expect(result.coverage.noExactMatchProven).toBe(true)
    expect(result.coverage.approximationOptimality).toBe("not-proven")
  })
  it("objetivo 1.00 con mínimo confirmado: ausencia demostrada en el dominio técnico", async () => {
    const result = await calculateStandardEstimatedNetToGross(input({ targetNet: "1.00", minimumWageCandidateScenario: confirmed() }), context)
    expect(result.coverage.state, JSON.stringify(result.metrics)).toBe("complete")
    expect(result.coverage.noExactMatchProven).toBe(true)
    expect(result.exactCandidates).toHaveLength(0)
    expect(result.conclusion).toBe("no-exact-in-domain-proven")
    checkLedger(result)
  }, 10000)
})

describe("límites, cancelación y condiciones fiscales", () => {
  it.each([1, 2, 3, 5, 10])("presupuesto %s: conserva frontera pendiente sin falsos certificados", async maxEvaluations => {
    const result = await calculateStandardEstimatedNetToGross(input({ searchOptions: { maxEvaluations } }), context)
    expect(result.metrics.directEvaluations).toBeLessThanOrEqual(maxEvaluations)
    expect(result.coverage.state).toBe("limited")
    expect(result.metrics.stopReason).toBe("evaluation-budget")
    noFalseProof(result)
  })
  it("conserva coincidencia verificada cuando el presupuesto se agota después", async () => {
    const result = await calculateStandardEstimatedNetToGross(input({ targetNet: "9451.20", minimumWageCandidateScenario: confirmed(), searchOptions: { maxEvaluations: 2 } }), context)
    expect(result.exactCandidates.map(c => c.gross)).toContain("9451.20")
    expect(result.match).toBe("exact")
    expect(result.coverage.state).toBe("limited")
    noFalseProof(result)
  })
  it("AbortSignal previo hace cero evaluaciones", async () => {
    const controller = new AbortController(); controller.abort()
    const result = await calculateStandardEstimatedNetToGross(input({ searchOptions: { signal: controller.signal } }), context)
    expect(result.metrics.directEvaluations).toBe(0)
    expect(result.metrics.stopReason).toBe("aborted")
    noFalseProof(result)
  })
  it("la cesión por macrotarea permite ejecutar cancelación real", async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 0)
    try {
      const result = await calculateStandardEstimatedNetToGross(input({ benefits: { ...standardBenefits, annualBonusDays: "365000000" }, searchOptions: { signal: controller.signal } }), context)
      expect(result.metrics.stopReason).toBe("aborted")
      expect(result.metrics.yields).toBeGreaterThanOrEqual(1)
      expect(result.metrics.directEvaluations).toBe(32)
      noFalseProof(result)
    } finally { clearTimeout(timer) }
  })
  it("tiempo agotado es determinista con reloj monotónico controlado", async () => {
    let tick = 0
    vi.spyOn(performance, "now").mockImplementation(() => tick++)
    const result = await calculateStandardEstimatedNetToGross(input({ searchOptions: { maxDurationMs: 2 } }), context)
    expect(result.metrics.stopReason).toBe("time-budget")
    noFalseProof(result)
  })
  it("mínimo sin confirmar bloquea cobertura, no se convierte en cero ni ausencia", async () => {
    const result = await calculateStandardEstimatedNetToGross(input({ targetNet: "9451.20", searchOptions: { grossRange: { from: "9451.19", to: "9451.25" } } }), context)
    expect(result.exactCandidates).toHaveLength(0)
    expect(result.coverage.state).toBe("fiscally-incomplete")
    expect(result.coverage.fiscalUnresolvedIntervals.some(i => i.from === "9451.20")).toBe(true)
    noFalseProof(result)
  })
  it("una raíz ordinaria no se proclama mínima si queda el mínimo mensual irresuelto", async () => {
    const from = "9451.19", to = "10000.00", targetNet = "9451.20"
    const ordinaryRoots = exhaustiveReference({ periodicity: "monthly", january: false, includeImss: true, confirmedMinimum: false, benefits: standardBenefits }, from, to, targetNet)
    expect(ordinaryRoots.length).toBeGreaterThan(0)
    const capture = input({ targetNet, searchOptions: { grossRange: { from, to } } })
    const unknown = await calculateStandardEstimatedNetToGross(capture, context)
    expect(unknown.exactCandidates.map(c => c.gross)).toEqual(ordinaryRoots)
    expect(unknown.match).toBe("exact")
    expect(unknown.coverage.state).toBe("fiscally-incomplete")
    expect(unknown.coverage.minimumProven).toBe(false)
    expect(unknown.coverage.uniquenessProven).toBe(false)
    expect(unknown.recommendationBasis).toBe("smallest-verified-only")
    noFalseProof(unknown)
    const allowed = await calculateStandardEstimatedNetToGross({ ...capture, minimumWageCandidateScenario: confirmed() }, context)
    expect(allowed.exactCandidates.map(c => c.gross)).toEqual(["9451.20", ...ordinaryRoots])
    expect(allowed.coverage.state).toBe("complete")
    expect(allowed.coverage.minimumProven).toBe(true)
    expect(allowed.coverage.multipleSolutionsVerified).toBe(true)
    checkLedger(allowed)
  }, 20000)
  it("hipótesis incompatible se rechaza aunque otros candidatos ordinarios sean posibles", async () => {
    const result = await calculateStandardEstimatedNetToGross(input({ minimumWageCandidateScenario: confirmed("2026-01") }), context)
    expect(result.status).toBe("not-determinable")
    expect(result.issues[0].code).toBe("MINIMUM_DECLARATION_OR_BOUNDARY_REJECTED")
    expect(result.exactCandidates).toHaveLength(0)
    noFalseProof(result)
  })
  it("hipótesis solo se transmite al mínimo; los superiores usan unconfirmed", async () => {
    const real = forwardOperations.calculateStandardEstimatedGrossToNet
    vi.spyOn(forwardOperations, "calculateStandardEstimatedGrossToNet").mockImplementation((capture, ctx) => {
      const v = capture as { grossPeriodSalary: string; minimumWageMonthlyScenario: { kind: string } }
      if (v.minimumWageMonthlyScenario.kind !== "unconfirmed") expect(v.grossPeriodSalary).toBe("9451.20")
      return real(capture, ctx)
    })
    const result = await calculateStandardEstimatedNetToGross(input({ minimumWageCandidateScenario: confirmed(), searchOptions: { grossRange: { from: "14998.00", to: "15002.00" } } }), context)
    expect(result.exactCandidates[0].gross).toBe("15000.00")
    expect(result.exactCandidates[0].scenario).toBe("unconfirmed")
  })
  it("no certificado no implica podar: dominio pequeño se enumera por completo", async () => {
    const changed = { ...context, isrTariffs: context.isrTariffs.map(set => set.key === "monthly" ? { ...set, data: { ...set.data, rows: set.data.rows.map((row, i) => i === 4 ? { ...row, ratePercent: "40.00" } : row) } } : set) }
    const from = "14999.00", to = "15001.00"
    const result = await calculateStandardEstimatedNetToGross(input({ targetNet: "13000.00", searchOptions: { grossRange: { from, to } } }), changed)
    expect(result.provenance.certificationAvailable).toBe(false)
    expect(result.metrics.certifiedClosures).toBe(0)
    expect(result.metrics.exhaustivePoints).toBe(201)
    expect(result.coverage.state).toBe("complete")
    checkLedger(result)
  })
  it("no certificado con dominio enorme conserva búsqueda limitada", async () => {
    const result = await calculateStandardEstimatedNetToGross(input({ benefits: { ...standardBenefits, annualBonusDays: "365000000" }, searchOptions: { maxEvaluations: 40 } }), context)
    expect(result.provenance.certificationAvailable).toBe(false)
    expect(result.metrics.certifiedClosures).toBe(0)
    expect(result.coverage.state).toBe("limited")
    noFalseProof(result)
  })
  it("puede probar mínimo de dominio sin afirmar unicidad cuando falta la parte superior", async () => {
    const result = await calculateStandardEstimatedNetToGross(input({ searchOptions: { grossRange: { from: "15000.00", to: "50000.00" }, maxEvaluations: 3 } }), context)
    expect(result.exactCandidates.map(c => c.gross)).toContain("15000.00")
    expect(result.coverage.minimumProven).toBe(true)
    expect(result.coverage.uniquenessProven).toBe(false)
    expect(result.coverage.state).toBe("limited")
    noFalseProof(result)
  })
  it("versiones no revisadas desactivan poda y se verifican por enumeración", async () => {
    const real = forwardOperations.calculateStandardEstimatedGrossToNet
    vi.spyOn(forwardOperations, "calculateStandardEstimatedGrossToNet").mockImplementation((v, c) => {
      const r = real(v, c)
      return r.status === "estimated" ? { ...r, provenance: { ...r.provenance, policyVersions: r.provenance.policyVersions.map(p => p.component === "gross-to-net" ? { ...p, version: "future-unreviewed" } : p) } } : r
    })
    const result = await calculateStandardEstimatedNetToGross(input({ searchOptions: { grossRange: { from: "14999.00", to: "15001.00" } } }), context)
    expect(result.provenance.certificationAvailable).toBe(false)
    expect(result.metrics.certifiedClosures).toBe(0)
    expect(result.metrics.exhaustivePoints).toBe(201)
    expect(result.exactCandidates.map(c => c.gross)).toEqual(["15000.00"])
    checkLedger(result)
  })
  it("una política adicional no revisada también impide certificar intervalos", async () => {
    const real = forwardOperations.calculateStandardEstimatedGrossToNet
    vi.spyOn(forwardOperations, "calculateStandardEstimatedGrossToNet").mockImplementation((v, c) => {
      const r = real(v, c)
      return r.status === "estimated" ? { ...r, provenance: { ...r.provenance, policyVersions: [...r.provenance.policyVersions, { component: "future-extra", version: "v1" }] } } : r
    })
    const result = await calculateStandardEstimatedNetToGross(input({ searchOptions: { grossRange: { from: "14999.00", to: "15001.00" } } }), context)
    expect(result.provenance.certificationAvailable).toBe(false)
    expect(result.metrics.certifiedClosures).toBe(0)
    expect(result.metrics.exhaustivePoints).toBe(201)
    expect(result.exactCandidates.map(c => c.gross)).toEqual(["15000.00"])
    checkLedger(result)
  })
  it("umbral IMSS fuera de la rejilla de centavos no usa certificado de precisión", async () => {
    const changed = { ...context, imssConstants: context.imssConstants.map(set => ({ ...set, data: { ...set.data, excessThresholdUmaDailyMultiple: "3.001" } })) }
    const result = await calculateStandardEstimatedNetToGross(input({ searchOptions: { grossRange: { from: "14999.00", to: "15001.00" } } }), changed)
    expect(result.provenance.certificationAvailable).toBe(false)
    expect(result.provenance.certificationReason).toBe("IMSS_EXCESS_BASE_CENT_GRID_NOT_PROVEN")
    expect(result.metrics.exhaustivePoints).toBe(201)
    expect(result.metrics.certifiedClosures).toBe(0)
    checkLedger(result)
  })
  it("errores directos interiores también ceden macrotareas y no certifican cobertura", async () => {
    const real = forwardOperations.calculateStandardEstimatedGrossToNet
    let calls = 0
    vi.spyOn(forwardOperations, "calculateStandardEstimatedGrossToNet").mockImplementation((v, c) => {
      calls++
      if (calls > 3) throw new Error("Injected direct failure")
      return real(v, c)
    })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 0)
    try {
      const result = await calculateStandardEstimatedNetToGross(input({ searchOptions: { signal: controller.signal } }), context)
      expect(result.metrics.stopReason).toBe("aborted")
      expect(result.metrics.directEvaluations).toBe(32)
      expect(result.fiscalDiagnostics.some(d => d.codes.includes("DIRECT_EVALUATION_FAILED"))).toBe(true)
      noFalseProof(result)
    } finally { clearTimeout(timer) }
  })
})

describe("captura, parámetros e inmutabilidad", () => {
  it.each([undefined, null, "", "0", "-1", "1e4", "13,202.64", "0.001", 13202.64])("rechaza objetivo %j", async targetNet => {
    const result = await calculateStandardEstimatedNetToGross({ ...input(), targetNet }, context)
    expect(result.status).toBe("not-determinable")
    expect(result.exactCandidates).toHaveLength(0)
    expect(result.coverage.noExactMatchProven).toBe(false)
  })
  it("máximo técnico no se presenta como límite fiscal", async () => {
    const result = await calculateStandardEstimatedNetToGross(input({ targetNet: "1000000000.01" }), context)
    expect(result.status).toBe("not-supported")
    expect(result.issues[0].code).toBe("TARGET_OUTSIDE_INVERSE_TECHNICAL_DOMAIN")
  })
  it.each([{ from: "15000.00", to: "14999.00" }, { from: "0", to: "1" }, { from: "1", to: "1000000000.01" }])("rechaza dominio %j", async grossRange => {
    const result = await calculateStandardEstimatedNetToGross(input({ searchOptions: { grossRange } }), context)
    expect(result.status).toBe("not-determinable")
    expect(result.coverage.noExactMatchProven).toBe(false)
  })
  it.each([0, -1, 4097, 2.5, NaN])("rechaza presupuesto inválido %j", async maxEvaluations => {
    const result = await calculateStandardEstimatedNetToGross(input({ searchOptions: { maxEvaluations } }), context)
    expect(result.metrics.directEvaluations).toBe(0)
    expect(result.status).toBe("not-determinable")
  })
  it("no admite bruto inicial, calendario o contexto mensual fuera del perfil", async () => {
    const extra = await calculateStandardEstimatedNetToGross({ ...input(), grossPeriodSalary: "15000.00" }, context)
    expect(extra.status).toBe("not-supported")
    const outside = await calculateStandardEstimatedNetToGross(input({ minimumWageCandidateScenario: { kind: "monthly-payments-outside-standard-profile" } }), context)
    expect(outside.status).toBe("not-supported")
    const calendar = await calculateStandardEstimatedNetToGross(input({ profileId: "calendar-context" }), context)
    expect(calendar.status).toBe("not-supported")
  })
  it.each(["uma", "subsidy", "minimumWages", "imssConstants", "isrTariffs", "retentionRuleSources"] as const)("parámetros ausentes %s no permiten certificar ausencia", async key => {
    const result = await calculateStandardEstimatedNetToGross(input(), { ...context, [key]: [] })
    expect(result.status).toBe("not-determinable")
    expect(result.coverage.noExactMatchProven).toBe(false)
    expect(result.coverage.state).toBe("fiscally-incomplete")
  })
  it("prestaciones ausentes, fecha/versión incorrecta y conjunto no verificado se rechazan", async () => {
    for (const patch of [{ benefits: undefined }, { referenceDate: "2026-02-29" }, { fiscalPackageVersion: "another" }]) {
      const result = await calculateStandardEstimatedNetToGross({ ...input(), ...patch }, context)
      expect(result.coverage.noExactMatchProven).toBe(false)
      expect(result.status).not.toBe("estimated")
    }
    const pending = { ...context, uma: context.uma.map(set => ({ ...set, validation: "pending-review" as const })) }
    expect((await calculateStandardEstimatedNetToGross(input(), pending)).status).toBe("not-determinable")
  })
  it("conserva entradas, congela contexto privado y no altera Decimal global", async () => {
    const capture = structuredClone(input({ searchOptions: { grossRange: { from: "14998.00", to: "15002.00" } } }))
    const ctx = structuredClone(context)
    const before = JSON.stringify({ capture, ctx })
    const precision = Decimal.precision, rounding = Decimal.rounding
    try {
      Decimal.set({ precision: 3, rounding: Decimal.ROUND_DOWN })
      const result = await calculateStandardEstimatedNetToGross(capture, ctx)
      expect(result.exactCandidates.map(c => c.gross)).toContain("15000.00")
      expect(Decimal.precision).toBe(3)
      expect(Decimal.rounding).toBe(Decimal.ROUND_DOWN)
      expect(Object.isFrozen(result)).toBe(true)
      expect(Object.isFrozen(result.coverage)).toBe(true)
      expect(Object.isFrozen(result.exactCandidates[0])).toBe(true)
      expect(Object.isFrozen(ctx.uma[0])).toBe(false)
    } finally { Decimal.set({ precision, rounding }) }
    expect(JSON.stringify({ capture, ctx })).toBe(before)
  })
})
