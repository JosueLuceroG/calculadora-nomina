import Decimal from "decimal.js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { calculateStandardEstimatedNetToGross } from "../../domain/payroll/net-to-gross"
import { moneyText } from "../../domain/payroll/money"
import { standardGrossToNetContext2026 } from "../../infrastructure/fiscal/2026"
import { createInitialForm, type CaptureForm } from "./form"
import { createFiscalAdapter, presentInverseFiscalResult, type FiscalCapture, type FiscalAdapter, type MinimumDeclaration } from "./fiscal-adapter"

function capture(patch: Partial<CaptureForm> = {}, area: FiscalCapture["area"] = "general-zone"): FiscalCapture {
  return { form: { ...createInitialForm(), mode: "gross-to-net", amount: "15000.00", period: "monthly", effectiveDate: "2026-02-01", bonusDays: "15", vacationDays: "12", vacationPremium: "25", ...patch }, area }
}
function declaration(month = "2026-02"): MinimumDeclaration {
  return { kind: "only-general-minimum-assumed-for-reference-month", referenceMonth: month, noOtherSalaryPayments: true, acknowledgement: "explicit-standard-simulation-assumption-not-payroll-verification" }
}
function direct(adapter = createFiscalAdapter(), c = capture(), d?: MinimumDeclaration) {
  const p = adapter.prepare(c, d)
  if (!p.ok || p.prepared.mode !== "gross-to-net") throw new Error(JSON.stringify(p))
  return adapter.direct(p.prepared)
}
async function inverse(adapter: FiscalAdapter, c: FiscalCapture, d?: MinimumDeclaration) {
  const p = adapter.prepare(c, d)
  if (!p.ok || p.prepared.mode !== "net-to-gross") throw new Error(JSON.stringify(p))
  return adapter.inverse(p.prepared)
}
// Corrección por evaluaciones deterministas; el rendimiento real ya tiene su suite separada.
beforeEach(() => vi.spyOn(performance, "now").mockReturnValue(0))
afterEach(() => vi.restoreAllMocks())

describe("adaptador: captura exacta sin prestaciones o zona implícitas", () => {
  it("mapea contrato sin dividir prima, mutar captura ni inventar condiciones", () => {
    const c = capture({ amount: "00015000.00", bonusDays: "15.50", vacationPremium: "25.50" })
    const before = JSON.stringify(c)
    const adapter = createFiscalAdapter()
    const p = adapter.prepare(c)
    expect(p.ok).toBe(true)
    if (!p.ok || p.prepared.mode !== "gross-to-net") throw new Error("Preparación fallida")
    expect(p.prepared.input).toMatchObject({ profileId: "standard-estimate-2026-v1", grossPeriodSalary: "15000.00", periodicity: "monthly", referenceDate: "2026-02-01", area: "general-zone", includeWorkerImss: true, benefits: { annualBonusDays: "15.50", annualVacationDays: "12", vacationPremiumPercent: "25.50" }, minimumWageMonthlyScenario: { kind: "unconfirmed" } })
    expect(p.prepared.snapshot.form.amount).toBe("00015000.00")
    expect(p.prepared.snapshot.form.vacationPremium).toBe("25.50")
    expect(Object.isFrozen(p.prepared.input)).toBe(true)
    expect(Object.isFrozen(p.prepared.snapshot.form)).toBe(true)
    expect(JSON.stringify(c)).toBe(before)
    expect(adapter.configuration.fiscalPackageVersion).toBe("mx-fiscal-2026-source-v3")
  })
  it.each([true, false])("prestaciones requeridas incluso con IMSS %s", includeImss => {
    const p = createFiscalAdapter().prepare(capture({ bonusDays: "", vacationDays: "", vacationPremium: "", includeImss }))
    expect(p.ok).toBe(false)
    if (p.ok) throw new Error("No debe preparar")
    expect(p.issues.filter(i => i.code === "REQUIRED_BENEFIT").map(i => i.field)).toEqual(["bonusDays", "vacationDays", "vacationPremium"])
  })
  it("zona no se rellena y el norte no se transforma a general", () => {
    const adapter = createFiscalAdapter()
    const blank = adapter.prepare(capture({}, ""))
    expect(blank.ok).toBe(false)
    if (!blank.ok) expect(blank.issues.some(i => i.field === "area" && i.code === "REQUIRED_SALARY_AREA")).toBe(true)
    const northern = direct(adapter, capture({}, "northern-border-zone"))
    expect(northern.report.status).toBe("not-supported")
    expect(northern.presentation.values.netSalary).toBeNull()
  })
  it.each(["0", "-1", "1e4", "1,000", "1.001", 15000])("rechaza dinero inválido %j", amount => {
    const p = createFiscalAdapter().prepare(capture({ amount: amount as string }))
    expect(p.ok).toBe(false)
    if (!p.ok) expect(p.issues.some(i => i.field === "amount")).toBe(true)
  })
  it("distingue límites técnicos de formato y no recorta el importe", () => {
    const p = createFiscalAdapter().prepare(capture({ amount: "123456789012345678901.00" }))
    expect(p.ok).toBe(false)
    if (!p.ok) expect(p.issues).toContainEqual(expect.objectContaining({ field: "amount", category: "technical", code: "DECIMAL_RANGE" }))
  })
  it("fecha civil inválida no se inventa; una fecha fuera del perfil queda como bloqueo fiscal", () => {
    const adapter = createFiscalAdapter()
    expect(adapter.prepare(capture({ effectiveDate: "2026-02-29" })).ok).toBe(false)
    const outcome = direct(adapter, capture({ effectiveDate: "2024-02-29" }))
    expect(outcome.report.status).toBe("not-supported")
    expect(outcome.presentation.determination).toBe("blocked")
    expect(outcome.presentation.values.netSalary).toBeNull()
  })
  it("los ceros declarados de prestaciones se conservan, con advertencias del motor", () => {
    const outcome = direct(createFiscalAdapter(), capture({ bonusDays: "0", vacationDays: "0", vacationPremium: "0" }))
    expect(outcome.report.status).toBe("estimated")
    expect(outcome.presentation.values.integrationFactor).toBe("1.0000")
    expect(outcome.presentation.warnings.some(w => w.code === "BONUS_BELOW_LEGAL_MINIMUM")).toBe(true)
  })
})

describe("directo real y modelo de presentación", () => {
  it.each([
    ["monthly", "15000.00", true, "1402.82", "394.54", "13202.64"],
    ["monthly", "15000.00", false, "1402.82", "0.00", "13597.18"],
    ["weekly", "3500.00", true, "331.27", "92.06", "3076.67"],
    ["fortnightly", "7500.00", true, "709.86", "197.27", "6592.87"],
  ] as const)("%s %s / IMSS %s: oráculo de integración real", (period, amount, includeImss, isr, imss, net) => {
    const outcome = direct(createFiscalAdapter(), capture({ period, amount, includeImss }))
    expect(outcome.presentation.values).toMatchObject({ grossSalary: amount, isr, workerImss: imss, netSalary: net, taxableIncome: amount })
    expect(outcome.presentation.determination).toBe("complete-estimate")
    expect(outcome.presentation.confirmation).toBeNull()
  })
  it("mapea FI, SDI y SBC separados sin copiar cantidades de la imagen", () => {
    const outcome = direct()
    expect(outcome.presentation.values).toMatchObject({ dailySalary: "500.00", integrationFactor: "1.0493", integratedDailySalary: "524.66", contributionBaseSalary: "524.66", integratedBenefitDays: "18", integratedVariableIncome: null })
    expect(outcome.presentation.integrationFactorRaw).toMatch(/^1\.049315068/)
    expect(outcome.presentation.variableIncome).toBe("not-applicable-to-ordinary-salary")
    const capped = direct(createFiscalAdapter(), capture({ amount: "300000.00" }))
    expect(capped.presentation.values.integratedDailySalary).toBe("10493.15")
    expect(capped.presentation.values.contributionBaseSalary).toBe("2932.75")
  })
  it("mínimo sin confirmar mantiene retención y aplicado nulos; con hipótesis son ceros determinados", () => {
    const adapter = createFiscalAdapter()
    const c = capture({ amount: "9451.20" })
    const unknown = direct(adapter, c)
    expect(unknown.presentation.values).toMatchObject({ netSalary: null, isr: null, workerImss: "0.00", employmentSubsidy: null })
    expect(unknown.presentation.subsidy.determined).toBe("535.65")
    expect(unknown.presentation.confirmation).toEqual({ referenceMonth: "2026-02", candidateGross: "9451.20", basis: "direct-retention" })
    const assumed = direct(adapter, c, declaration())
    expect(assumed.presentation.values).toMatchObject({ netSalary: "9451.20", isr: "0.00", workerImss: "0.00", employmentSubsidy: "0.00" })
    expect(assumed.presentation.subsidy).toEqual({ determined: "535.65", applied: "0.00", notAppliedDueToNoWithholding: "535.65", excessOverTariffIsrNotDelivered: "0.00" })
    expect(assumed.presentation.confirmation).toBeNull()
  })
  it("bajo mínimo conserva diagnóstico sin crear un neto completo", () => {
    const outcome = direct(createFiscalAdapter(), capture({ amount: "4000.00", includeImss: false }))
    expect(outcome.presentation.fiscalStatus).toBe("not-supported")
    expect(outcome.presentation.values.netSalary).toBeNull()
    expect(outcome.presentation.values.workerImss).toBeNull()
    expect(outcome.presentation.values.isr).toBeNull()
    expect(outcome.presentation.values.taxableIncome).toBe("4000.00")
    expect(outcome.presentation.subsidy.determined).toBe("535.65")
  })
  it("parámetros faltantes permanecen desconocidos sin sustituirlos por cero", () => {
    const ctx = standardGrossToNetContext2026()
    const outcome = direct(createFiscalAdapter({ ...ctx, subsidy: [] }))
    expect(outcome.presentation.fiscalStatus).toBe("not-determinable")
    expect(outcome.presentation.values.netSalary).toBeNull()
    expect(outcome.presentation.subsidy.determined).toBeNull()
    expect(outcome.presentation.values.workerImss).toBe("394.54")
  })
})

describe("inverso real, cobertura y candidato recomendado", () => {
  it.each([
    ["weekly", "3076.67", ["3499.99", "3500.00"]],
    ["monthly", "10500.00", ["11093.07", "11714.44"]],
  ] as const)("%s %s conserva alternativas verificadas", async (period, amount, roots) => {
    const outcome = await inverse(createFiscalAdapter(), capture({ mode: "net-to-gross", period, amount }))
    expect(outcome.presentation.inverse?.alternatives.map(c => c.gross)).toEqual(roots)
    expect(outcome.presentation.values.netSalary).toBe(amount)
    expect(outcome.presentation.values.grossSalary).toBe(roots[0])
    expect(outcome.presentation.inverse).toMatchObject({ match: "exact", minimumProven: true, uniquenessProven: false, coverage: "complete" })
  }, 20000)
  it("un diagnóstico de prevalidación del mínimo irrelevante no activa confirmación", async () => {
    const outcome = await inverse(createFiscalAdapter(), capture({ mode: "net-to-gross", amount: "13202.64" }))
    expect(outcome.report.fiscalDiagnostics.some(d => d.codes.includes("MONTHLY_MINIMUM_CONFIRMATION_REQUIRED"))).toBe(true)
    expect(outcome.presentation.confirmation).toBeNull()
    expect(outcome.presentation.inverse?.uniquenessProven).toBe(true)
  }, 20000)
  it("mínimo irresuelto relevante activa confirmación y la hipótesis condicional resuelve el punto", async () => {
    const adapter = createFiscalAdapter()
    const c = capture({ mode: "net-to-gross", amount: "9451.20" })
    const unknown = await inverse(adapter, c)
    expect(unknown.presentation.confirmation).toEqual({ referenceMonth: "2026-02", candidateGross: "9451.20", basis: "inverse-relevant-unresolved-point" })
    expect(unknown.presentation.inverse).toMatchObject({ minimumProven: false, uniquenessProven: false, coverage: "fiscally-incomplete" })
    const assumed = await inverse(adapter, c, declaration())
    expect(assumed.presentation.values.grossSalary).toBe("9451.20")
    expect(assumed.presentation.values.netSalary).toBe("9451.20")
    expect(assumed.presentation.inverse?.minimumProven).toBe(true)
    expect(assumed.presentation.confirmation).toBeNull()
    const p = adapter.prepare(c, declaration())
    if (!p.ok || p.prepared.mode !== "net-to-gross") throw new Error("Preparación fallida")
    expect(p.prepared.input.minimumWageCandidateScenario).toEqual({ kind: "conditional-for-exact-minimum", declaration: declaration() })
  }, 20000)
  it("aproximación real: no muestra el objetivo como neto obtenido", async () => {
    const p = createFiscalAdapter().prepare(capture({ mode: "net-to-gross", period: "fortnightly", amount: "5557.04" }))
    if (!p.ok || p.prepared.mode !== "net-to-gross") throw new Error("Preparación fallida")
    const report = await calculateStandardEstimatedNetToGross({ ...p.prepared.input, searchOptions: { grossRange: { from: "6216.15", to: "6216.16" } } }, standardGrossToNetContext2026())
    const view = presentInverseFiscalResult(report, "2026-02-01")
    expect(view.inverse).toMatchObject({ targetNet: "5557.04", obtainedNet: "5557.03", difference: "-0.01", absoluteDifference: "0.01", match: "approximate", noExactMatchProven: true })
    expect(view.values.netSalary).toBe("5557.03")
    expect(view.values.grossSalary).toBe("6216.15")
    expect(view.values.taxableIncome).toBe("6216.15")
  })
  it("presupuesto limitado real conserva incertidumbre y candidato verificado", async () => {
    const p = createFiscalAdapter().prepare(capture({ mode: "net-to-gross", amount: "13202.64" }))
    if (!p.ok || p.prepared.mode !== "net-to-gross") throw new Error("Preparación fallida")
    const report = await calculateStandardEstimatedNetToGross({ ...p.prepared.input, searchOptions: { maxEvaluations: 2 } }, standardGrossToNetContext2026())
    const view = presentInverseFiscalResult(report)
    expect(view.inverse).toMatchObject({ coverage: "limited", uniquenessProven: false, noExactMatchProven: false, exactSetComplete: false })
    expect(view.values.netSalary).toBe(report.recommendedForwardResult?.net.amount)
    expect(view.warnings.some(w => w.code === "INVERSE_SEARCH_LIMITED")).toBe(true)
    expect(view.confirmation).toBeNull()
  })
  it("sin candidato no inventa importes ni mes, pero el ejecutor puede aportar la fecha declarada", async () => {
    const p = createFiscalAdapter().prepare(capture({ mode: "net-to-gross", amount: "9451.20" }))
    if (!p.ok || p.prepared.mode !== "net-to-gross") throw new Error("Preparación fallida")
    const report = await calculateStandardEstimatedNetToGross({ ...p.prepared.input, searchOptions: { grossRange: { from: "9451.20", to: "9451.20" } } }, standardGrossToNetContext2026())
    const unknownDate = presentInverseFiscalResult(report)
    expect(unknownDate.values.netSalary).toBeNull()
    expect(unknownDate.values.grossSalary).toBeNull()
    expect(unknownDate.confirmation).toBeNull()
    expect(presentInverseFiscalResult(report, p.prepared.input.referenceDate).confirmation?.referenceMonth).toBe("2026-02")
  })
  it("rechaza reporte directo ajeno, candidato incoherente y afirmaciones de cobertura falsas", async () => {
    const outcome = await inverse(createFiscalAdapter(), capture({ mode: "net-to-gross", amount: "13202.64" }))
    const report = outcome.report
    if (!report.recommended || !report.recommendedForwardResult) throw new Error("Candidato ausente")
    expect(() => presentInverseFiscalResult({ ...report, recommendedForwardResult: null })).toThrow()
    expect(() => presentInverseFiscalResult({ ...report, recommended: { ...report.recommended!, gross: moneyText("15001") } })).toThrow()
    expect(() => presentInverseFiscalResult({ ...report, recommended: { ...report.recommended!, difference: moneyText("0.01") } })).toThrow()
    expect(() => presentInverseFiscalResult({ ...report, coverage: { ...report.coverage, state: "limited" } })).toThrow()
    expect(() => presentInverseFiscalResult({ ...report, coverage: { ...report.coverage, uniquenessProven: false } })).toThrow()
    expect(() => presentInverseFiscalResult({ ...report, coverage: { ...report.coverage, pendingIntervals: [{ from: moneyText("15000.00"), to: moneyText("15001.00") }] } })).toThrow()
  }, 20000)
})

it("preserva parámetros y configuración decimal global durante preparación y ejecución", () => {
  const ctx = structuredClone(standardGrossToNetContext2026())
  const before = JSON.stringify(ctx)
  const precision = Decimal.precision, rounding = Decimal.rounding
  try {
    Decimal.set({ precision: 3, rounding: Decimal.ROUND_DOWN })
    const outcome = direct(createFiscalAdapter(ctx))
    expect(outcome.presentation.values.netSalary).toBe("13202.64")
    expect(Decimal.precision).toBe(3)
    expect(Decimal.rounding).toBe(Decimal.ROUND_DOWN)
    expect(Object.isFrozen(ctx.uma[0])).toBe(false)
  } finally { Decimal.set({ precision, rounding }) }
  expect(JSON.stringify(ctx)).toBe(before)
})
