import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const src = resolve(dirname(fileURLToPath(import.meta.url)), "..")
describe("5D.2a fronteras y superficie acotada", () => {
  it("contratos/resolución son puros y proveedores no importan motores", () => {
    for (const folder of ["domain/fiscal-runtime", "infrastructure/fiscal"]) {
      for (const name of readdirSync(resolve(src, folder)).filter(p => p.endsWith(".ts") && !p.endsWith(".test.ts"))) {
        if (folder === "infrastructure/fiscal" && ["2026.ts", "sources.ts"].includes(name)) continue
        const content = readFileSync(resolve(src, folder, name), "utf8")
        expect(content).not.toMatch(/from ["'](?:react|@tauri|node:)|fetch\s*\(|\binvoke\s*\(|calculateStandardEstimated(?:GrossToNet|NetToGross)\s*\(/)
        expect(content).not.toMatch(/features\/(?:storage|history|pdf)|eval\s*\(|new Function/)
      }
    }
  })
  it("nuevos contratos fuera de la huella aritmética; ninguna capacidad2027", () => {
    expect(existsSync(resolve(src, "domain/fiscal-runtime/contracts.ts"))).toBe(true)
    expect(existsSync(resolve(src, "domain/payroll/fiscal-runtime.ts"))).toBe(false)
    const registry = readFileSync(resolve(src, "infrastructure/fiscal/engine-capabilities.ts"), "utf8")
    expect(registry).not.toMatch(/exercise:\s*2027|certified:\s*true|minimumProven:\s*true/)
    expect(readFileSync(resolve(src, "features/calculator/fiscal-adapter.ts"), "utf8")).toContain("new WeakMap<PreparedFiscalRequest, Readonly<{ adapter: FiscalAdapter; provenance: ExecutionDocumentProvenance }>>()")
  })
})
