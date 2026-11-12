import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { App } from "@/app/App"
import { CaptureSection, paymentDateError } from "./capture-section"
import { CaptureSummary } from "./capture-summary"
import { ResultsSection } from "./results-section"
import { referenceDailySalary } from "./result-presentation"
import { createInitialForm } from "../form"
import { decodeFiscalSnapshot, encodeFiscalSnapshot } from "@/features/storage/snapshot"
import originals from "../../../../src-tauri/src/storage/fixtures-v2.json"
import * as directModule from "@/domain/payroll/gross-to-net"
import * as inverseModule from "@/domain/payroll/net-to-gross"

describe("V1-UI: ajustes de captura y desglose, sin cambios fiscales", () => {
  it("retira el auxiliar diario y deja los metadatos técnicos en Parámetros", () => {
    const html = renderToStaticMarkup(<App />)
    expect(html).not.toMatch(/Desde cuota diaria|SBC mixto|comparación del recibo|mx-fiscal-2026-source-v3/)
    expect(html).not.toContain('id="payment-date"')
    expect(html).not.toContain('id="effective-date"')
  })

  it.each([true, false, true])("IMSS %s: solo automático y captura manual deshabilitada, sin campo ficticio", includeImss => {
    const html = renderToStaticMarkup(<CaptureSection form={{ ...createInitialForm(), includeImss }} onFormChange={() => {}} onValidated={() => {}} />)
    expect(html).toContain("¿Descontar IMSS al trabajador?")
    const selected = html.match(new RegExp(`<input[^>]*id="${includeImss ? "include-imss" : "exclude-imss"}"[^>]*>`))?.[0]
    expect(selected).toContain('checked=""')
    expect(selected).toContain(`value="${includeImss ? "yes" : "no"}"`)
    expect(html).not.toContain("Zona salarial:")
    expect(html).not.toContain('id="imss-method"')
    expect(html).not.toContain('id="payment-date"')
    expect(html).not.toContain('id="effective-date"')
    if (includeImss) {
      expect(html).toContain('aria-expanded="false"')
      expect(html).toContain("Mostrar opciones IMSS")
    } else {
      expect(html).not.toContain("Mostrar opciones IMSS")
      expect(html).toContain('class="capture-dates-toggle"')
      expect(html).toContain("no representa una exención legal")
    }
    expect(html).not.toContain("Importe de IMSS a descontar")
  })

  it.each([
    ["", undefined], ["2026-02-28", undefined], ["2028-02-29", undefined],
    ["2026-02-29", "Elige una fecha de pago válida."], ["2026-13-01", "Elige una fecha de pago válida."], ["incorrecta", "Elige una fecha de pago válida."],
  ])("fecha de pago opcional %s: %s", (date, error) => expect(paymentDateError(date)).toBe(error))

  it("cerrar opciones no introduce la nota de pago en la captura fiscal", () => {
    const form = { ...createInitialForm(), amount: "15000.00", effectiveDate: "2026-02-01" }, before = structuredClone(form)
    const html = renderToStaticMarkup(<CaptureSection form={form} paymentDate="2026-02-15" onPaymentDateChange={() => {}} onFormChange={() => {}} onValidated={() => {}} />)
    expect(html).not.toContain('id="effective-date"')
    expect(html).not.toContain('id="payment-date"')
    const summary = renderToStaticMarkup(<CaptureSummary form={form} paymentDate="2026-02-15" onEdit={() => {}} />)
    expect(summary).toContain("Fecha de pago · solo sesión")
    expect(summary).toContain("15 de febrero de 2026")
    expect(form).toEqual(before)
    expect(form).not.toHaveProperty("paymentDate")
  })

  it.each([
    ["3794.35", "weekly", "542.05"], ["15000.00", "fortnightly", "1000.00"],
    ["15000.50", "monthly", "500.02"], ["0.15", "monthly", "0.01"],
    ["0.00", "weekly", "0.00"], [null, "monthly", null], ["15000.00", "", null],
    ["99999999999999999999.99", "weekly", "14285714285714285714.28"],
  ] as const)("referencia informativa %s / %s = %s sin float ni cero supuesto", (gross, period, daily) => {
    expect(referenceDailySalary(gross, period)).toBe(daily)
  })

  it.each(["direct-manual", "inverse-exact"])("%s: diario dentro del desglose, sin mutar reporte ni recalcular", name => {
    const wire = originals.find(item => item.name === name)!.payload, snapshot = decodeFiscalSnapshot(wire)
    const direct = vi.spyOn(directModule, "calculateStandardEstimatedGrossToNet").mockImplementation(() => { throw Error("UI recalculation") })
    const inverse = vi.spyOn(inverseModule, "calculateStandardEstimatedNetToGross").mockImplementation(() => { throw Error("UI recalculation") })
    try {
      const html = renderToStaticMarkup(<ResultsSection mode={snapshot.capture.form.mode} period={snapshot.capture.form.period} presentation={snapshot.outcome.presentation} report={snapshot.outcome.report} phase="result" />)
      const breakdown = html.split("Desglose del cálculo")[1].split("IMSS e integración salarial")[0]
      expect(breakdown).toContain("Salario diario bruto</dt>")
      expect(breakdown).toContain("Salario diario neto</dt>")
      expect(breakdown).toContain(name === "direct-manual" ? "$ 500.02" : "$ 500.00")
      expect(breakdown).not.toContain("Bruto ÷")
      expect(breakdown).not.toContain("No es SBC ni SDI")
      expect(encodeFiscalSnapshot(snapshot)).toBe(wire)
      expect(direct).not.toHaveBeenCalled(); expect(inverse).not.toHaveBeenCalled()
    } finally { vi.restoreAllMocks() }
  })
})
