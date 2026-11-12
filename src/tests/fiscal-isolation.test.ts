import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import * as foundation from "../domain/payroll/index"
import { selectFiscalParameters2026, standardEmploymentSubsidyContext2026, standardGrossToNetContext2026, standardIsrTariffContext2026, standardSbcContext2026 } from "../infrastructure/fiscal/2026"

const src = resolve(dirname(fileURLToPath(import.meta.url)), "..")
function references(path: string): string[] {
  // Type-only edges are erased; documentary contracts may name report types
  // without acquiring a runtime entry to calculators or parameter providers.
  const content = readFileSync(path, "utf8").replace(/import\s+type\s+[\s\S]*?\s+from\s+["'][^"']+["']/g, "")
  return [...content.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g)].map(match => match[1])
}
function resolveImport(path: string, reference: string): string {
  const modulePath = reference.split("?")[0]
  const absolute = modulePath.startsWith("@/") ? resolve(src, modulePath.slice(2)) : resolve(dirname(path), modulePath)
  if (/\.(?:ts|tsx|json|css|ttf)$/.test(absolute)) return absolute
  return [`${absolute}.ts`, `${absolute}.tsx`].find(existsSync) ?? `${absolute}.ts`
}

describe("frontera del núcleo fiscal y puerta visual autorizada, Hito 3B.3", () => {
  it("ejecuta utilidades y selección de datos en Node sin React ni Tauri", () => {
    expect(foundation.addDecimals("0.01", "0.02").value).toBe("0.03")
    expect(selectFiscalParameters2026("2026-02-01", "monthly").uma.data.daily).toBe("117.31")
    expect(Object.keys(foundation).filter(name => !["calculateStandardEstimatedGrossToNet", "calculateStandardEstimatedNetToGross"].includes(name)).some(name => /grossToNet|netToGross|calculateIsr|calculateImss|applySubsidy|absorbWorkerQuota/i.test(name))).toBe(false)
    expect(typeof foundation.calculateStandardSalaryIntegration).toBe("function")
    expect(typeof foundation.calculateStandardEstimatedSbc).toBe("function")
    expect(typeof foundation.calculateStandardEstimatedWorkerImss).toBe("function")
    expect(typeof foundation.calculateStandardEstimatedIsrByTariff).toBe("function")
    expect(typeof foundation.calculateStandardEstimatedEmploymentSubsidy).toBe("function")
    expect(typeof foundation.calculateStandardEstimatedGrossToNet).toBe("function")
    expect(typeof foundation.calculateStandardEstimatedNetToGross).toBe("function")
  })

  it("el grafo de producción del núcleo solo depende de decimal.js y módulos fiscales", () => {
    const visited = new Set<string>()
    function visit(path: string) {
      if (visited.has(path) || path.endsWith(".json")) return
      visited.add(path)
      for (const reference of references(path)) {
        if (!reference.startsWith(".")) { expect(reference).toBe("decimal.js"); continue }
        const target = resolveImport(path, reference)
        expect(target.startsWith(resolve(src, "domain", "payroll")) || target.startsWith(resolve(src, "infrastructure", "fiscal"))).toBe(true)
        visit(target)
      }
    }
    visit(resolve(src, "domain", "payroll", "index.ts"))
    visit(resolve(src, "infrastructure", "fiscal", "2026.ts"))
    expect(visited.size).toBeGreaterThan(6)
  })

  it("la aplicación visual solo accede al núcleo por cálculo autorizado o proyección de lectura", () => {
    const visited = new Set<string>()
    function visit(path: string) {
      if (visited.has(path) || /\.(?:json|css|ttf)$/.test(path)) return
      visited.add(path)
      for (const reference of references(path)) {
        if (!reference.startsWith(".") && !reference.startsWith("@/")) continue
        const target = resolveImport(path, reference)
        const fiscal = target.startsWith(resolve(src, "domain")) || target.startsWith(resolve(src, "infrastructure", "fiscal"))
        if(target===resolve(src,"infrastructure","fiscal","external-provider.ts")){
          expect(path).toBe(resolve(src,"features","calculator","prepared-external-execution.ts"))
          visit(target) // Narrow data-only port, still inspect every runtime edge.
          continue
        }
        if ([resolve(src, "infrastructure", "fiscal", "document-producer.json"), resolve(src, "infrastructure", "fiscal", "document-producer-0.1.1-rc.1.json"), resolve(src, "infrastructure", "fiscal", "embedded-document-policy.json")].includes(target)) {
          expect([resolve(src, "features", "documents", "provenance.ts"), resolve(src, "features", "documents", "provenance-compat-v1.ts"), resolve(src, "features", "documents", "embedded-document-registry.ts")]).toContain(path)
          continue // compiled metadata only, not another runtime calculator gate
        }
        if ([resolve(src, "domain", "payroll", "civil-date.ts"), resolve(src, "domain", "payroll", "money.ts")].includes(target)) continue
        if (fiscal) expect([resolve(src, "features", "calculator", "fiscal-adapter.ts"), resolve(src, "features", "parameters", "parameter-catalog.ts"), resolve(src, "features", "documents", "provenance-compat-v1.ts")]).toContain(path)
        else visit(target)
      }
    }
    visit(resolve(src, "main.tsx"))
    expect(visited.size).toBeGreaterThan(8)
    expect(visited.has(resolve(src, "features", "calculator", "fiscal-adapter.ts"))).toBe(true)
  })

  it("App conecta ambos modos al controlador y no ejecuta motores fiscales desde React", () => {
    const app = readFileSync(resolve(src, "app", "App.tsx"), "utf8")
    expect(app).not.toMatch(/calculateStandardEstimated(?:GrossToNet|NetToGross)\s*\(/)
    expect(app).not.toContain('if (form.mode === "net-to-gross")')
    expect(app).toContain('controller.current?.edit({ form, area })')
    expect(app).toContain('current.submit({ form, area })')
    expect(app).toContain('controller.current?.cancel()')
  })

  it("no usa parseFloat, toNumber ni Date con zona horaria en fundamentos", () => {
    const money = readFileSync(resolve(src, "domain", "payroll", "money.ts"), "utf8")
    const dates = readFileSync(resolve(src, "domain", "payroll", "civil-date.ts"), "utf8")
    expect(money).not.toMatch(/parseFloat\s*\(|\.toNumber\s*\(|Number\s*\(/)
    expect(dates).not.toMatch(/new Date\s*\(|Date\.UTC|Date\.parse/)
    for (const file of ["salary-integration.ts", "standard-profile-validation.ts", "sbc.ts", "worker-imss.ts", "isr-tariff.ts", "employment-subsidy.ts", "gross-to-net.ts", "net-to-gross.ts", "net-to-gross-certificate.ts"]) {
      const integration = readFileSync(resolve(src, "domain", "payroll", file), "utf8")
      expect(integration).not.toMatch(/parseFloat\s*\(|\.toNumber\s*\(|Number\s*\(|Decimal\.set\s*\(/)
    }
  })

  it("ejecuta cuotas en Node sin activar ISR, subsidio ni bruto/neto", () => {
    const result = foundation.calculateStandardEstimatedWorkerImss({
      profileId: foundation.STANDARD_CONVENTIONS.id, grossPeriodSalary: "15000.00", area: "general-zone",
      periodicity: "monthly", referenceDate: "2026-02-01", includeWorkerImss: true,
      benefits: { annualBonusDays: "15", annualVacationDays: "12", vacationPremiumPercent: "25" },
    }, standardSbcContext2026())
    expect(result.status).toBe("estimated")
    expect(result.quotas.calculated).toBe("394.54")
    expect(result).not.toHaveProperty("net")
    expect(result).not.toHaveProperty("isr")
    expect(result).not.toHaveProperty("subsidy")
  })

  it("ejecuta ISR por tarifa en Node y mantiene pendientes subsidio y retención final", () => {
    const result = foundation.calculateStandardEstimatedIsrByTariff({
      profileId: foundation.STANDARD_CONVENTIONS.id, grossPeriodSalary: "15000.00",
      periodicity: "monthly", referenceDate: "2026-02-01",
    }, standardIsrTariffContext2026())
    expect(result.status).toBe("estimated")
    expect(result.isrByTariff).toBe("1402.82")
    if (result.status !== "estimated") throw new Error("ISR por tarifa no determinado")
    expect(result.data.subsidy.amount).toBeNull()
    expect(result.data.finalWithholding.amount).toBeNull()
    expect(result).not.toHaveProperty("net")
  })

  it("ejecuta subsidio estimado e ISR provisional en Node sin determinar retención final o neto", () => {
    const result = foundation.calculateStandardEstimatedEmploymentSubsidy({
      profileId: foundation.STANDARD_CONVENTIONS.id, grossPeriodSalary: "9451.20",
      periodicity: "monthly", referenceDate: "2026-02-01",
    }, standardEmploymentSubsidyContext2026())
    expect(result.status).toBe("estimated")
    expect(result.amounts.subsidyDetermined).toBe("535.65")
    expect(result.amounts.isrAfterSubsidyProvisional).toBe("133.66")
    if (result.status !== "estimated") throw new Error("Subsidio no determinado")
    expect(result.data.finalWithholding.amount).toBeNull()
    expect(result).not.toHaveProperty("net")
  })

  it("ejecuta bruto a neto en Node sin activar cálculo inverso o frontend", () => {
    const result = foundation.calculateStandardEstimatedGrossToNet({
      profileId: foundation.STANDARD_CONVENTIONS.id, grossPeriodSalary: "15000.00",
      periodicity: "monthly", referenceDate: "2026-02-01", area: "general-zone", includeWorkerImss: true,
      benefits: { annualBonusDays: "15", annualVacationDays: "12", vacationPremiumPercent: "25" },
      minimumWageMonthlyScenario: { kind: "unconfirmed" },
    }, standardGrossToNetContext2026())
    expect(result.status).toBe("estimated")
    expect(result.net.amount).toBe("13202.64")
    expect(result).not.toHaveProperty("inverse")
  })

  it("ejecuta inverso asíncrono en Node sin React ni Tauri", async () => {
    const result = await foundation.calculateStandardEstimatedNetToGross({
      profileId: foundation.STANDARD_CONVENTIONS.id, fiscalPackageVersion: "mx-fiscal-2026-source-v3",
      targetNet: "13202.64", periodicity: "monthly", referenceDate: "2026-02-01", area: "general-zone", includeWorkerImss: true,
      benefits: { annualBonusDays: "15", annualVacationDays: "12", vacationPremiumPercent: "25" },
      minimumWageCandidateScenario: { kind: "unconfirmed" }, searchOptions: { grossRange: { from: "15000.00", to: "15000.00" } },
    }, standardGrossToNetContext2026())
    expect(result.match).toBe("exact")
    expect(result.smallestFound?.gross).toBe("15000.00")
    expect(result.coverage.uniquenessProven).toBe(true)
  })
})
