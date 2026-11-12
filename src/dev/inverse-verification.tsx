import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "@/app/App"
import { createCalculationController } from "@/features/calculator/calculation-controller"
import { createFiscalAdapter, presentInverseFiscalResult, type InverseFiscalOutcome, type PreparedInverse } from "@/features/calculator/fiscal-adapter"
import { calculateStandardEstimatedNetToGross } from "@/domain/payroll/net-to-gross"
import type { StandardNetToGrossInput } from "@/domain/payroll/net-to-gross-contracts"
import { standardGrossToNetContext2026 } from "@/infrastructure/fiscal/2026"
import "@/app/styles.css"

if (!import.meta.env.DEV) throw new Error("Verificación exclusiva de desarrollo.")

// Entrada aislada: App/controlador reales; dominios técnicos y promesas solo aquí.
const scenario = new URLSearchParams(location.search).get("case")
const real = createFiscalAdapter(scenario === "missing-parameters" ? { ...standardGrossToNetContext2026(), subsidy: [] } : undefined)
type Pending = { request: PreparedInverse; signal?: AbortSignal; resolve: (outcome: InverseFiscalOutcome) => void; reject: (error: Error) => void }
const pending: Pending[] = []
let calls = 0, mounts = 0, disposals = 0
async function execute(request: PreparedInverse, searchOptions?: StandardNetToGrossInput["searchOptions"]): Promise<InverseFiscalOutcome> {
  const report = await calculateStandardEstimatedNetToGross({ ...request.input, searchOptions }, standardGrossToNetContext2026())
  return { kind: "inverse", report, presentation: presentInverseFiscalResult(report, request.input.referenceDate) }
}
function createController() {
  mounts++
  const controller = createCalculationController({ ...real, inverse: async (request, signal) => {
    calls++
    if (scenario === "deferred") return new Promise<InverseFiscalOutcome>((resolve, reject) => pending.push({ request, signal, resolve, reject }))
    if (scenario === "error") throw new Error("Fallo controlado de verificación")
    if (scenario === "approximate") return execute(request, { grossRange: { from: "6216.15", to: "6216.16" }, signal })
    if (scenario === "limited") return execute(request, { grossRange: { from: "15000.00", to: "50000.00" }, maxEvaluations: 3, signal })
    if (scenario === "time-limited") return execute(request, { maxDurationMs: 1, signal })
    if (scenario === "empty-limited") return execute(request, { maxEvaluations: 1, signal })
    if (scenario === "unresolved") return execute(request, { grossRange: { from: "9451.20", to: "9451.20" }, signal })
    return real.inverse(request, signal)
  } })
  return { ...controller, dispose: () => { disposals++; controller.dispose() } }
}
const root = createRoot(document.getElementById("root")!)
const verification = {
  get state() { return { calls, mounts, disposals, pending: pending.map(p => ({ amount: p.request.input.targetNet, aborted: p.signal?.aborted ?? false })) } },
  async resolve(index: number) {
    const task = pending[index]
    // Ignora deliberadamente el aborto para verificar el descarte del controlador.
    const result = await execute(task.request, { grossRange: { from: "15000.00", to: "15000.01" } })
    task.resolve(result)
  },
  reject(index: number) { pending[index].reject(new Error("Rechazo controlado, posiblemente obsoleto")) },
  unmount() { root.unmount() },
}
declare global { interface Window { __inverseVerification: typeof verification } }
window.__inverseVerification = verification
root.render(<StrictMode><App createController={createController} /></StrictMode>)
