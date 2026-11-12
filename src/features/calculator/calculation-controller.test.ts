import { beforeAll, describe, expect, it, vi } from "vitest"
import { calculateStandardEstimatedNetToGross } from "../../domain/payroll/net-to-gross"
import { standardGrossToNetContext2026 } from "../../infrastructure/fiscal/2026"
import { createInitialForm, type CaptureForm } from "./form"
import {
  createFiscalAdapter, presentInverseFiscalResult,
  type FiscalAdapter, type FiscalCapture, type InverseFiscalOutcome, type MinimumDeclaration,
} from "./fiscal-adapter"
import { createCalculationController, type CalculationState } from "./calculation-controller"

function capture(patch: Partial<CaptureForm> = {}, area: FiscalCapture["area"] = "general-zone"): FiscalCapture {
  return { form: { ...createInitialForm(), mode: "gross-to-net", amount: "15000.00", period: "monthly", effectiveDate: "2026-02-01", bonusDays: "15", vacationDays: "12", vacationPremium: "25", ...patch }, area }
}
const inverseCapture = () => capture({ mode: "net-to-gross", amount: "13202.64" })
function declaration(month = "2026-02"): MinimumDeclaration {
  return { kind: "only-general-minimum-assumed-for-reference-month", referenceMonth: month, noOtherSalaryPayments: true, acknowledgement: "explicit-standard-simulation-assumption-not-payroll-verification" }
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function flush() { await Promise.resolve(); await Promise.resolve() }
let a: InverseFiscalOutcome, b: InverseFiscalOutcome
beforeAll(async () => {
  const adapter = createFiscalAdapter()
  const requests = [["13202.64", "15000.00"], ["13202.65", "15000.01"]] as const
  const outcomes: InverseFiscalOutcome[] = []
  for (const [amount, gross] of requests) {
    const p = adapter.prepare(capture({ mode: "net-to-gross", amount }))
    if (!p.ok || p.prepared.mode !== "net-to-gross") throw new Error("Preparación fallida")
    const report = await calculateStandardEstimatedNetToGross({ ...p.prepared.input, searchOptions: { grossRange: { from: gross, to: gross } } }, standardGrossToNetContext2026())
    outcomes.push(Object.freeze({ kind: "inverse", report, presentation: presentInverseFiscalResult(report, "2026-02-01") }))
  }
  ;[a, b] = outcomes
})

describe("controlador independiente: ejecución y concurrencia controlada", () => {
  it("el directo real se completa síncronamente y conserva captura exacta", async () => {
    const controller = createCalculationController()
    const states: CalculationState[] = []
    const unsubscribe = controller.subscribe(s => states.push(s))
    const c = capture({ amount: "00015000.00", vacationPremium: "25.00" })
    const before = JSON.stringify(c)
    const job = controller.submit(c)
    expect(job.accepted).toBe(true)
    expect(controller.getState().phase).toBe("result")
    expect(controller.getState().outcome?.presentation.values.netSalary).toBe("13202.64")
    expect(controller.getState().snapshot?.form.amount).toBe("00015000.00")
    expect(controller.getState().snapshot?.form.vacationPremium).toBe("25.00")
    expect(states.map(s => s.phase)).toEqual(["calculating", "result"])
    expect((await job.completion).requestId).toBe(job.requestId)
    expect(Object.isFrozen(controller.getState().snapshot?.form)).toBe(true)
    expect(JSON.stringify(c)).toBe(before)
    expect(controller.getState()).not.toHaveProperty("progress")
    unsubscribe(); controller.dispose()
  })
  it("doble envío comparte solicitud y no duplica la operación inversa", async () => {
    const real = createFiscalAdapter(), pending = deferred<InverseFiscalOutcome>()
    const inverse = vi.fn(() => pending.promise)
    const controller = createCalculationController({ ...real, inverse })
    const first = controller.submit(inverseCapture())
    const second = controller.submit(structuredClone(inverseCapture()))
    expect(first.accepted).toBe(true)
    expect(second.accepted).toBe(false)
    expect(second.reason).toBe("duplicate")
    expect(second.requestId).toBe(first.requestId)
    expect(second.completion).toBe(first.completion)
    expect(inverse).toHaveBeenCalledTimes(1)
    pending.resolve(a)
    await first.completion
    expect(controller.getState().phase).toBe("result")
    expect(controller.getState().outcome).toBe(a)
    controller.dispose()
  })
  it("otra captura válida reemplaza, aborta y protege frente a respuestas fuera de orden", async () => {
    const real = createFiscalAdapter(), one = deferred<InverseFiscalOutcome>(), two = deferred<InverseFiscalOutcome>()
    const signals: AbortSignal[] = []
    const inverse: FiscalAdapter["inverse"] = vi.fn((_p, signal) => { signals.push(signal!); return signals.length === 1 ? one.promise : two.promise })
    const controller = createCalculationController({ ...real, inverse })
    const first = controller.submit(inverseCapture())
    const second = controller.submit(capture({ mode: "net-to-gross", amount: "13202.65" }))
    expect(second.requestId).toBeGreaterThan(first.requestId!)
    expect(signals[0].aborted).toBe(true)
    two.resolve(b); await second.completion
    const current = controller.getState()
    one.resolve(a); await flush(); await first.completion
    expect(controller.getState()).toBe(current)
    expect(controller.getState().outcome).toBe(b)
    expect(controller.getState().snapshot?.form.amount).toBe("13202.65")
    controller.dispose()
  })
  it("una respuesta obsoleta no libera ni reemplaza otra todavía en ejecución", async () => {
    const real = createFiscalAdapter(), one = deferred<InverseFiscalOutcome>(), two = deferred<InverseFiscalOutcome>()
    const inverse = vi.fn().mockReturnValueOnce(one.promise).mockReturnValueOnce(two.promise)
    const controller = createCalculationController({ ...real, inverse })
    controller.submit(inverseCapture())
    const second = controller.submit(capture({ mode: "net-to-gross", amount: "13202.65" }))
    one.resolve(a); await flush()
    expect(controller.getState().phase).toBe("calculating")
    expect(controller.submit(capture({ mode: "net-to-gross", amount: "13202.65" })).reason).toBe("duplicate")
    expect(inverse).toHaveBeenCalledTimes(2)
    two.resolve(b); await second.completion
    expect(controller.getState().outcome).toBe(b)
    controller.dispose()
  })
  it.each(["edit", "clear", "mode", "cancel"] as const)("%s invalida una respuesta que ignora voluntariamente el aborto", async action => {
    const real = createFiscalAdapter(), pending = deferred<InverseFiscalOutcome>()
    let signal: AbortSignal | undefined
    const controller = createCalculationController({ ...real, inverse: (_p, s) => { signal = s; return pending.promise } })
    const job = controller.submit(inverseCapture())
    if (action === "edit") controller.edit(capture({ mode: "net-to-gross", amount: "12000.00" }))
    else if (action === "mode") controller.edit(capture())
    else if (action === "clear") controller.clear()
    else controller.cancel()
    const current = controller.getState()
    expect(signal?.aborted).toBe(true)
    expect(current.requestId).toBeGreaterThan(job.requestId!)
    expect(current.phase).toBe(action === "cancel" ? "cancelled" : "idle")
    if (action === "clear") expect(current.snapshot).toBeNull()
    pending.resolve(a); await flush(); await job.completion
    expect(controller.getState()).toBe(current)
    expect(controller.getState().outcome).toBeNull()
    controller.dispose()
  })
  it("rechazo tardío de una operación obsoleta no publica error", async () => {
    const real = createFiscalAdapter(), pending = deferred<InverseFiscalOutcome>()
    const controller = createCalculationController({ ...real, inverse: () => pending.promise })
    controller.submit(inverseCapture())
    controller.clear()
    pending.reject(new Error("old failure")); await flush()
    expect(controller.getState().phase).toBe("idle")
    expect(controller.getState().error).toBeNull()
    controller.dispose()
  })
  it("disponer aborta, elimina suscripciones y no permite nuevas solicitudes", async () => {
    const real = createFiscalAdapter(), pending = deferred<InverseFiscalOutcome>()
    const inverse = vi.fn(() => pending.promise)
    const controller = createCalculationController({ ...real, inverse })
    const listener = vi.fn()
    controller.subscribe(listener)
    const job = controller.submit(inverseCapture())
    controller.dispose()
    const calls = listener.mock.calls.length
    expect(controller.getState().phase).toBe("disposed")
    expect((await job.completion).phase).toBe("disposed")
    expect(controller.submit(inverseCapture()).reason).toBe("disposed")
    controller.subscribe(listener)
    pending.resolve(a); await flush()
    expect(listener).toHaveBeenCalledTimes(calls)
    expect(inverse).toHaveBeenCalledTimes(1)
  })
  it("un observador puede cancelar antes de iniciar el motor", async () => {
    const real = createFiscalAdapter()
    const inverse = vi.fn(async () => a)
    const controller = createCalculationController({ ...real, inverse })
    controller.subscribe(s => { if (s.phase === "calculating") controller.cancel() })
    const job = controller.submit(inverseCapture())
    expect((await job.completion).phase).toBe("cancelled")
    expect(inverse).not.toHaveBeenCalled()
    controller.dispose()
  })
  it("presupuesto limitado es resultado, no cancelación voluntaria", async () => {
    const real = createFiscalAdapter()
    const p = real.prepare(inverseCapture())
    if (!p.ok || p.prepared.mode !== "net-to-gross") throw new Error("Preparación fallida")
    const report = await calculateStandardEstimatedNetToGross({ ...p.prepared.input, searchOptions: { maxEvaluations: 2 } }, standardGrossToNetContext2026())
    const outcome: InverseFiscalOutcome = { kind: "inverse", report, presentation: presentInverseFiscalResult(report) }
    const controller = createCalculationController({ ...real, inverse: async () => outcome })
    await controller.submit(inverseCapture()).completion
    expect(controller.getState().phase).toBe("result")
    expect(controller.getState().outcome?.presentation.inverse?.coverage).toBe("limited")
    controller.dispose()
  })
  it("excepciones de ejecución y preparación conservan captura sin publicar importes", async () => {
    const real = createFiscalAdapter()
    const controller = createCalculationController({ ...real, direct: () => { throw new Error("internal") } })
    await controller.submit(capture()).completion
    expect(controller.getState().phase).toBe("error")
    expect(controller.getState().snapshot?.form.amount).toBe("15000.00")
    expect(controller.getState().outcome).toBeNull()
    const preparation = createCalculationController({ ...real, prepare: () => { throw new Error("prepare") } })
    expect(preparation.submit(capture()).reason).toBe("error")
    expect(preparation.getState().phase).toBe("error")
    expect(preparation.getState().snapshot?.form.amount).toBe("15000.00")
    controller.dispose(); preparation.dispose()
  })
  it("captura inválida aborta una petición previa y distingue incidencias de entrada", async () => {
    const real = createFiscalAdapter(), pending = deferred<InverseFiscalOutcome>()
    let signal: AbortSignal | undefined
    const controller = createCalculationController({ ...real, inverse: (_p, s) => { signal = s; return pending.promise } })
    controller.submit(inverseCapture())
    const invalid = controller.submit(capture({ bonusDays: "" }))
    expect(invalid.reason).toBe("capture-error")
    expect(signal?.aborted).toBe(true)
    expect(controller.getState().captureIssues.some(i => i.field === "bonusDays")).toBe(true)
    pending.resolve(a); await flush()
    expect(controller.getState().phase).toBe("capture-error")
    controller.dispose()
  })
})

describe("confirmaciones ligadas a captura, no a resultados", () => {
  it("controlador e inverso reales conservan objetivo y alternativas semanales", async () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(0)
    const controller = createCalculationController()
    try {
      const job = controller.submit(capture({ mode: "net-to-gross", period: "weekly", amount: "3076.67" }))
      expect(controller.getState().phase).toBe("calculating")
      const result = await job.completion
      expect(result.outcome?.presentation.inverse?.alternatives.map(c => c.gross)).toEqual(["3499.99", "3500.00"])
      expect(result.outcome?.presentation.values.netSalary).toBe("3076.67")
      expect(result.snapshot?.form.amount).toBe("3076.67")
      expect(result.outcome?.presentation.confirmation).toBeNull()
    } finally { clock.mockRestore(); controller.dispose() }
  }, 20000)
  it("el inverso real reconoce un mínimo relevante y reejecuta hipótesis solo tras afirmación", async () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(0)
    const controller = createCalculationController()
    try {
      await controller.submit(capture({ mode: "net-to-gross", amount: "9451.20" })).completion
      expect(controller.getState().outcome?.presentation.inverse?.minimumProven).toBe(false)
      expect(controller.getState().outcome?.presentation.confirmation?.basis).toBe("inverse-relevant-unresolved-point")
      const job = controller.confirmMinimum(controller.getState().requestId, declaration())
      expect(job.accepted).toBe(true)
      const result = await job.completion
      expect(result.outcome?.presentation.inverse?.recommendedGross).toBe("9451.20")
      expect(result.outcome?.presentation.inverse?.minimumProven).toBe(true)
      expect(result.outcome?.presentation.values.isr).toBe("0.00")
      expect(result.outcome?.presentation.subsidy.applied).toBe("0.00")
    } finally { clock.mockRestore(); controller.dispose() }
  }, 20000)
  it("confirmación explícita usa mes y token actuales, sin presumir la excepción", () => {
    const controller = createCalculationController()
    const c = capture({ amount: "9451.20" })
    controller.submit(c)
    const id = controller.getState().requestId
    expect(controller.getState().outcome?.presentation.values.netSalary).toBeNull()
    expect(controller.confirmMinimum(id - 1, declaration()).accepted).toBe(false)
    expect(controller.confirmMinimum(id, declaration("2026-01")).accepted).toBe(false)
    const confirmed = controller.confirmMinimum(id, declaration())
    expect(confirmed.accepted).toBe(true)
    expect(controller.getState().outcome?.presentation.values.netSalary).toBe("9451.20")
    expect(controller.getState().outcome?.presentation.subsidy.applied).toBe("0.00")
    expect(controller.confirmMinimum(id, declaration()).accepted).toBe(false)
    controller.dispose()
  })
  it.each([
    { amount: "9451.21" }, { period: "weekly" }, { effectiveDate: "2026-03-01" },
    { bonusDays: "16" }, { vacationDays: "13" }, { vacationPremium: "26" },
    { includeImss: false }, { mode: "net-to-gross" },
  ] as const)("cambio fiscal %j invalida la hipótesis incluso si después se restaura el dato", patch => {
    const controller = createCalculationController()
    const c = capture({ amount: "9451.20" })
    controller.submit(c)
    controller.confirmMinimum(controller.getState().requestId, declaration())
    expect(controller.getState().outcome?.presentation.values.netSalary).toBe("9451.20")
    controller.edit(capture({ amount: "9451.20", ...patch }))
    controller.edit(c)
    controller.submit(c)
    expect(controller.getState().outcome?.presentation.values.netSalary).toBeNull()
    expect(controller.getState().outcome?.presentation.confirmation).not.toBeNull()
    controller.dispose()
  })
  it("zona y limpieza invalidan; editar sin cambiar datos conserva la afirmación", () => {
    const controller = createCalculationController()
    const c = capture({ amount: "9451.20" })
    controller.submit(c); controller.confirmMinimum(controller.getState().requestId, declaration())
    controller.edit(structuredClone(c)); controller.submit(c)
    expect(controller.getState().outcome?.presentation.values.netSalary).toBe("9451.20")
    controller.edit(capture({ amount: "9451.20" }, "")); controller.edit(c); controller.submit(c)
    expect(controller.getState().outcome?.presentation.values.netSalary).toBeNull()
    controller.confirmMinimum(controller.getState().requestId, declaration())
    controller.clear(); controller.submit(c)
    expect(controller.getState().outcome?.presentation.values.netSalary).toBeNull()
    controller.dispose()
  })
})

it("cancelación real durante búsqueda cooperativa termina sin respuesta tardía publicada", async () => {
  const real = createFiscalAdapter()
  let running: Promise<InverseFiscalOutcome> | null = null
  const controller = createCalculationController({ ...real, inverse: (p, signal) => { running = real.inverse(p, signal); return running } })
  const timer = setTimeout(() => controller.cancel(), 0)
  try {
    const job = controller.submit(capture({ mode: "net-to-gross", amount: "13202.64", bonusDays: "365000000" }))
    expect((await job.completion).phase).toBe("cancelled")
    const result = await (running as unknown as Promise<InverseFiscalOutcome>)
    expect(result.report.metrics.stopReason).toBe("aborted")
    expect(result.report.metrics.yields).toBeGreaterThan(0)
    expect(controller.getState().phase).toBe("cancelled")
    expect(controller.getState().outcome).toBeNull()
  } finally { clearTimeout(timer); controller.dispose() }
}, 10000)
