import { createRoot } from "react-dom/client"
import { ResultsSection } from "@/features/calculator/components/results-section"
import { visualResultFixture } from "@/features/calculator/demo/results.fixture"
import type { CalculationMode } from "@/features/calculator/form"
import "@/app/styles.css"

if (!import.meta.env.DEV) throw new Error("El fixture visual es exclusivo de desarrollo.")

const mode: CalculationMode = new URLSearchParams(location.search).get("mode") === "gross-to-net" ? "gross-to-net" : "net-to-gross"

// Isolated Vite entry; no form, capture state or import from the normal App.
createRoot(document.getElementById("root")!).render(
  <main className="development-results-preview">
    <ResultsSection mode={mode} demonstration={{ ...visualResultFixture, mode }} />
  </main>,
)
