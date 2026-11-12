import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "@/app/App"
import { createCalculationController, type CalculationController } from "@/features/calculator/calculation-controller"
import { createFiscalAdapter, type PreparedFiscalRequest } from "@/features/calculator/fiscal-adapter"
import "@/app/styles.css"

if (!import.meta.env.DEV) throw new Error("Verificación exclusiva de desarrollo.")
// Observación pasiva de los inputs que reciben los motores reales. Sin defaults,
// respuestas sustituidas ni cambios a contratos/controlador de producción.
const requests: PreparedFiscalRequest[] = []
let current: CalculationController | undefined
function createController() {
  const real = createFiscalAdapter()
  current = createCalculationController({ ...real,
    direct: request => { requests.push(structuredClone(request)); return real.direct(request) },
    inverse: (request, signal) => { requests.push(structuredClone(request)); return real.inverse(request, signal) },
  })
  return current
}
const verification = { requests, get state() { return current?.getState() } }
declare global { interface Window { __moneyVerification: typeof verification } }
window.__moneyVerification = verification
createRoot(document.getElementById("root")!).render(<StrictMode><App createController={createController} /></StrictMode>)
