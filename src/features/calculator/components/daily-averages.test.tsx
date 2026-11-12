import { renderToStaticMarkup } from "react-dom/server"
import { expect, it, describe, vi } from "vitest"
import { createContextualFiscalAdapter, createFiscalAdapter, presentInverseFiscalResult, type FiscalAdapter } from "../fiscal-adapter"
import { calculateStandardEstimatedNetToGross } from "@/domain/payroll/net-to-gross"
import { standardGrossToNetContext2026 } from "@/infrastructure/fiscal/2026"
import { createInitialForm, type CaptureForm } from "../form"
import { serializeStorageValue } from "@/features/storage/serialization"
import { formatMxn } from "../format"
import { ResultsSection } from "./results-section"

// Independent integer-cent oracle for the existing positive half-up policy.
function daily(amount: string, days: number) {
  const cents = BigInt(amount.replace(".", "")), divisor = BigInt(days)
  const rounded = ((2n * cents + divisor) / (2n * divisor)).toString().padStart(3, "0")
  return formatMxn(`${rounded.slice(0, -2)}.${rounded.slice(-2)}`)
}
function prepare(adapter: FiscalAdapter, mode: CaptureForm["mode"], period: CaptureForm["period"], amount: string) {
  const result = adapter.prepare({ area: "general-zone", form: { ...createInitialForm(), mode, period, amount, effectiveDate: "2026-02-01" } })
  if (!result.ok) throw Error("Invalid test capture")
  return result.prepared
}

describe("promedios diarios: presentación de importes finales", () => {
  it.each(([['weekly', 7, '3500.00'], ['fortnightly', 15, '15000.00'], ['monthly', 30, '15000.00']] as const)
    .flatMap(([period, days, gross]) => (["gross-to-net", "net-to-gross"] as const).map(mode => ({ period, days, gross, mode }))))("$period / $mode: dos filas juntas y reporte intacto", async ({ period, days, gross, mode }) => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(0)
    try {
      const adapter = createContextualFiscalAdapter(), directRequest = prepare(adapter, "gross-to-net", period, gross)
      if (directRequest.mode !== "gross-to-net") throw Error("Expected direct")
      const forward = adapter.direct(directRequest)
      if (forward.presentation.values.netSalary === null) throw Error("Missing net")
      const request = prepare(adapter, mode, period, mode === "gross-to-net" ? gross : forward.presentation.values.netSalary)
      const outcome = request.mode === "gross-to-net" ? adapter.direct(request) : await adapter.inverse(request)
      const before = serializeStorageValue(outcome), values = outcome.presentation.values
      if (values.grossSalary === null || values.netSalary === null) throw Error("Missing final amounts")
      const html = renderToStaticMarkup(<ResultsSection mode={mode} period={period} presentation={outcome.presentation} report={outcome.report} phase="result" />)
      expect(html).toContain(`Salario diario bruto</dt><dd>${daily(values.grossSalary, days)}</dd>`)
      expect(html).toContain(`Salario diario neto</dt><dd class="daily-net-amount">${daily(values.netSalary, days)}</dd>`)
      expect(html).toMatch(/Salario bruto<\/dt><dd>[^<]+<\/dd><\/div><div class="detail-row"><dt>Salario diario bruto<\/dt><dd>[^<]+<\/dd><\/div><div class="detail-row"><dt>Salario diario neto/)
      expect(html).not.toContain("Bruto ÷")
      expect(serializeStorageValue(outcome)).toBe(before)
    } finally { clock.mockRestore() }
  }, 20000)

  it("inverso aproximado usa el neto obtenido, no el solicitado", async () => {
    const adapter = createFiscalAdapter(), request = prepare(adapter, "net-to-gross", "monthly", "13202.64")
    if (request.mode !== "net-to-gross") throw Error("Expected inverse")
    const report = await calculateStandardEstimatedNetToGross({ ...request.input, searchOptions: { grossRange: { from: "16000.00", to: "16000.01" } } }, standardGrossToNetContext2026())
    const outcome = { report, presentation: presentInverseFiscalResult(report, "2026-02-01") }
    const obtained = outcome.presentation.values.netSalary
    expect(outcome.presentation.inverse?.match).toBe("approximate")
    if (obtained === null) throw Error("Missing obtained net")
    expect(daily(obtained, 30)).not.toBe(daily("13202.64", 30))
    const html = renderToStaticMarkup(<ResultsSection mode="net-to-gross" period="monthly" presentation={outcome.presentation} report={outcome.report} phase="result" />)
    expect(html).toContain(`Salario diario neto</dt><dd class="daily-net-amount">${daily(obtained, 30)}</dd>`)
  })

  it("sin importes finales conserva desconocidos, sin cero ni verde de resultado", () => {
    const html = renderToStaticMarkup(<ResultsSection mode="net-to-gross" period="monthly" />)
    expect(html).toContain("Salario diario bruto</dt><dd>—</dd>")
    expect(html).toContain("Salario diario neto</dt><dd>—</dd>")
    expect(html).not.toContain('class="daily-net-amount"')
  })
})
