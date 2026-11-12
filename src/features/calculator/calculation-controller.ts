import {
  createFiscalAdapter, createContextualFiscalAdapter, fiscalCaptureFingerprint, snapshotFiscalCapture,
  type AdapterIssue, type FiscalAdapter, type FiscalCapture, type FiscalOutcome, type MinimumDeclaration,
} from "./fiscal-adapter"
import { bindExecutionReceipt, type ExecutionDocumentProvenance } from "../documents/provenance"

export type CalculationPhase = "idle" | "calculating" | "capture-error" | "result" | "cancelled" | "error" | "disposed"
export type CalculationState = Readonly<{
  phase: CalculationPhase
  requestId: number
  snapshot: FiscalCapture | null
  outcome: FiscalOutcome | null
  captureIssues: readonly AdapterIssue[]
  error: Readonly<{ code: string; message: string }> | null
  executionProvenance?: ExecutionDocumentProvenance
}>
export type CalculationSubmission = Readonly<{
  accepted: boolean
  requestId: number | null
  reason: "started" | "duplicate" | "capture-error" | "error" | "disposed" | "stale-or-incompatible-confirmation"
  completion: Promise<CalculationState>
}>
export type CalculationController = Readonly<{
  getState: () => CalculationState
  subscribe: (listener: (state: CalculationState) => void) => () => void
  submit: (capture: FiscalCapture) => CalculationSubmission
  edit: (capture: FiscalCapture) => void
  cancel: () => void
  clear: () => void
  confirmMinimum: (requestId: number, declaration: MinimumDeclaration) => CalculationSubmission
  dispose: () => void
}>
type Task = {
  id: number
  fingerprint: string
  abort: AbortController | null
  completion: Promise<CalculationState>
  resolve: (state: CalculationState) => void
  provenance: ExecutionDocumentProvenance | null
}
type Confirmation = Readonly<{ fingerprint: string; declaration: MinimumDeclaration }>

/** Coordinador por instancia: no importa React, no calcula impuestos y no toca el formulario. */
export function createCalculationController(adapter: FiscalAdapter = createFiscalAdapter()): CalculationController {
  let sequence = 0
  let disposed = false
  let active: Task | null = null
  let confirmation: Confirmation | null = null
  let state: CalculationState = Object.freeze({ phase: "idle", requestId: 0, snapshot: null, outcome: null, captureIssues: Object.freeze([]), error: null })
  const listeners = new Set<(state: CalculationState) => void>()
  function publish(phase: CalculationPhase, snapshot: FiscalCapture | null, outcome: FiscalOutcome | null = null, captureIssues: readonly AdapterIssue[] = Object.freeze([]), error: CalculationState["error"] = null, provenance: ExecutionDocumentProvenance | null = null): CalculationState {
    const next: CalculationState = Object.freeze({ phase, requestId: sequence, snapshot, outcome, captureIssues, error, ...(provenance ? { executionProvenance: provenance } : {}) })
    if (provenance) bindExecutionReceipt(next, provenance)
    state = next
    for (const listener of [...listeners]) listener(next)
    return next
  }
  function transition(phase: CalculationPhase, snapshot: FiscalCapture | null, captureIssues: readonly AdapterIssue[] = Object.freeze([])): void {
    const previous = active
    active = null
    sequence++
    previous?.abort?.abort()
    const next = publish(phase, snapshot, null, captureIssues)
    previous?.resolve(next)
  }
  function current(task: Task): boolean { return !disposed && active?.id === task.id && sequence === task.id && !task.abort?.signal.aborted }
  function reject(reason: CalculationSubmission["reason"]): CalculationSubmission {
    return Object.freeze({ accepted: false, requestId: active?.id ?? null, reason, completion: active?.completion ?? Promise.resolve(state) })
  }
  function finish(task: Task, outcome: FiscalOutcome): void {
    if (!current(task)) { task.resolve(state); return }
    active = null
    const cancelledByEngine = outcome.kind === "inverse" && outcome.presentation.inverse?.stopReason === "aborted"
    const next = publish(cancelledByEngine ? "cancelled" : "result", state.snapshot, cancelledByEngine ? null : outcome, Object.freeze([]), null, cancelledByEngine ? null : task.provenance)
    task.resolve(next)
  }
  function fail(task: Task, error: unknown): void {
    if (!current(task)) { task.resolve(state); return }
    active = null
    const next = publish("error", state.snapshot, null, Object.freeze([]), Object.freeze({
      code: error instanceof Error && error.name === "FiscalPresentationError" ? "FISCAL_PRESENTATION_CONTRACT_ERROR" : "UNEXPECTED_CALCULATION_ERROR",
      message: error instanceof Error && error.name === "FiscalPresentationError" ? error.message : "No se pudo completar el cálculo. La captura se conserva; no se presentan importes supuestos.",
    }))
    task.resolve(next)
  }
  function submit(capture: FiscalCapture): CalculationSubmission {
    if (disposed) return reject("disposed")
    let fingerprint: string | null = null
    try { fingerprint = fiscalCaptureFingerprint(capture) } catch { /* La preparación devuelve incidencias tipadas. */ }
    if (confirmation && confirmation.fingerprint !== fingerprint) confirmation = null
    let prepared: ReturnType<FiscalAdapter["prepare"]>
    let provenance: ExecutionDocumentProvenance | null = null
    try { prepared = adapter.prepare(capture, confirmation?.declaration); if (prepared.ok) provenance = adapter.executionProvenance?.(prepared.prepared) ?? null }
    catch {
      const previous = active
      active = null
      sequence++
      previous?.abort?.abort()
      let snapshot = state.snapshot
      try { snapshot = snapshotFiscalCapture(capture) } catch { /* Conservar último snapshot disponible. */ }
      const next = publish("error", snapshot, null, Object.freeze([]), Object.freeze({ code: "UNEXPECTED_PREPARATION_ERROR", message: "No se pudo preparar el cálculo. No se ejecutó una petición con valores supuestos." }))
      previous?.resolve(next)
      return Object.freeze({ accepted: false, requestId: sequence, reason: "error", completion: Promise.resolve(next) })
    }
    if (!prepared.ok) {
      transition("capture-error", prepared.snapshot, prepared.issues)
      return Object.freeze({ accepted: false, requestId: sequence, reason: "capture-error", completion: Promise.resolve(state) })
    }
    if (active && active.fingerprint === prepared.prepared.fingerprint) return reject("duplicate")
    const previous = active
    active = null
    sequence++
    previous?.abort?.abort()
    let resolve!: (state: CalculationState) => void
    const completion = new Promise<CalculationState>(done => { resolve = done })
    const task: Task = { id: sequence, fingerprint: prepared.prepared.fingerprint, abort: prepared.prepared.mode === "net-to-gross" ? new AbortController() : null, completion, resolve, provenance }
    active = task
    const calculating = publish("calculating", prepared.prepared.snapshot, null, Object.freeze([]), null, task.provenance)
    previous?.resolve(calculating)
    const submission: CalculationSubmission = Object.freeze({ accepted: true, requestId: task.id, reason: "started", completion })
    // Un observador puede cancelar o disponer durante la notificación inicial.
    if (!current(task)) return submission
    try {
      if (prepared.prepared.mode === "gross-to-net") finish(task, adapter.direct(prepared.prepared))
      else void adapter.inverse(prepared.prepared, task.abort!.signal).then(outcome => finish(task, outcome), error => fail(task, error))
    } catch (error) { fail(task, error) }
    return submission
  }
  function edit(capture: FiscalCapture): void {
    if (disposed) return
    const snapshot = snapshotFiscalCapture(capture)
    if (confirmation?.fingerprint !== fiscalCaptureFingerprint(snapshot)) confirmation = null
    transition("idle", snapshot)
  }
  function cancel(): void {
    if (disposed || !active) return
    transition("cancelled", state.snapshot)
  }
  function clear(): void {
    if (disposed) return
    confirmation = null
    transition("idle", null)
  }
  function confirmMinimum(requestId: number, declaration: MinimumDeclaration): CalculationSubmission {
    if (disposed) return reject("disposed")
    const prompt = state.outcome?.presentation.confirmation
    const report=state.outcome?.report,context=report?.operation==='gross-to-net'?report.retention.assessment?.context:report?.provenance.retentionContext
    const contextual=declaration?.kind==='contextual-retention-2026-v2'
    if (active || state.phase !== "result" || state.requestId !== requestId || !state.snapshot
      || !declaration || declaration.referenceMonth !== (contextual?context?.referenceMonth:prompt?.referenceMonth)
      || (contextual?!context:!prompt||Boolean(prompt.contextual)||declaration.kind !== "only-general-minimum-assumed-for-reference-month"||declaration.noOtherSalaryPayments !== true || declaration.acknowledgement !== "explicit-standard-simulation-assumption-not-payroll-verification")) {
      return reject("stale-or-incompatible-confirmation")
    }
    confirmation = Object.freeze({ fingerprint: fiscalCaptureFingerprint(state.snapshot), declaration: Object.freeze(structuredClone(declaration)) })
    return submit(state.snapshot)
  }
  function dispose(): void {
    if (disposed) return
    disposed = true
    confirmation = null
    transition("disposed", null)
    listeners.clear()
  }
  return Object.freeze({
    getState: () => state,
    subscribe: listener => { if (disposed) return () => {}; listeners.add(listener); return () => { listeners.delete(listener) } },
    submit, edit, cancel, clear, confirmMinimum, dispose,
  })
}
export const createContextualCalculationController=()=>createCalculationController(createContextualFiscalAdapter())
