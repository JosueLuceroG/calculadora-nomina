import { describe, expect, it } from "vitest"
import type { FiscalParameterSet, FiscalSource } from "./contracts"
import { FiscalFoundationError, type FoundationErrorCode } from "./errors"
import { selectByEffectiveDate, validateFiscalSource, validateParameterTimeline } from "./parameters"

const source: FiscalSource = {
  authority: "INEGI", document: "UMA", url: "https://www.inegi.org.mx/temas/uma/",
  locator: "Cuadro oficial", publicationDate: "2026-01-08", verifiedOn: "2026-10-13",
}
const coverage = { from: "2026-01-01", through: "2026-12-31" }
function set(id: string, from: string, through: string | null): FiscalParameterSet<string> {
  return { id, kind: "uma", key: "test-uma", version: "test-v1", effectiveFrom: from, effectiveThrough: through, validation: "source-verified", validationScope: "source-data-only", sources: [source], data: id }
}
const complete = [set("january", "2025-02-01", "2026-01-31"), set("february", "2026-02-01", "2026-12-31")]
function expectCode(callback: () => unknown, code: FoundationErrorCode) {
  try { callback(); throw new Error("Se esperaba un error de fundamentos") }
  catch (error) { expect(error).toBeInstanceOf(FiscalFoundationError); expect((error as FiscalFoundationError).code).toBe(code) }
}

describe("selección temporal estricta", () => {
  it.each([
    ["2026-01-01", "january"], ["2026-01-31", "january"],
    ["2026-02-01", "february"], ["2026-12-31", "february"],
  ])("selecciona %s sin sustituir por cercanía", (date, expected) => {
    expect(selectByEffectiveDate([...complete].reverse(), date, coverage).data).toBe(expected)
  })

  it.each(["2025-12-31", "2027-01-01"])("rechaza fecha no soportada %s aunque un registro sea anterior", date => {
    expectCode(() => selectByEffectiveDate(complete, date, coverage), "UNSUPPORTED_DATE")
  })

  it("rechaza fecha civil inválida y parámetros ausentes", () => {
    expectCode(() => selectByEffectiveDate(complete, "2026-02-29", coverage), "INVALID_DATE")
    expectCode(() => selectByEffectiveDate([], "2026-01-01", coverage), "MISSING_PARAMETER")
  })

  it("detecta huecos interiores, al inicio y al final del paquete", () => {
    for (const records of [
      [set("a", "2026-01-01", "2026-01-30"), complete[1]],
      [set("a", "2026-01-02", "2026-12-31")],
      [set("a", "2026-01-01", "2026-12-30")],
    ]) expectCode(() => validateParameterTimeline(records, coverage), "COVERAGE_GAP")
    // Even a covered request must not silently accept an incomplete declared pack.
    expectCode(() => selectByEffectiveDate([complete[0]], "2026-01-15", coverage), "COVERAGE_GAP")
  })

  it("rechaza solapamientos inclusivos y rangos abiertos que se crucen", () => {
    for (const records of [
      [complete[0], set("b", "2026-01-31", "2026-12-31")],
      [set("a", "2026-01-01", null), complete[1]],
    ]) expectCode(() => validateParameterTimeline(records, coverage), "OVERLAPPING_INTERVALS")
  })

  it("permite un último intervalo abierto y no modifica el orden del proveedor", () => {
    const records = [set("b", "2026-02-01", null), complete[0]]
    expect(selectByEffectiveDate(records, "2026-10-13", coverage).id).toBe("b")
    expect(records[0].id).toBe("b")
  })

  it.each(["pending-review", "rejected"] as const)("rechaza estado documental %s", validation => {
    expectCode(() => selectByEffectiveDate([{ ...complete[0], validation }, complete[1]], "2026-01-01", coverage), "UNVERIFIED_PARAMETER")
  })

  it("detecta intervalos invertidos, identidades mezcladas y duplicados", () => {
    expectCode(() => validateParameterTimeline([set("a", "2026-02-01", "2026-01-01")], coverage), "INVALID_INTERVAL")
    expectCode(() => validateParameterTimeline([complete[0], { ...complete[1], key: "other" }], coverage), "INCOMPATIBLE_PARAMETERS")
    expectCode(() => validateParameterTimeline([complete[0], { ...complete[1], id: "january" }], coverage), "INCOMPATIBLE_PARAMETERS")
  })
})

describe("trazabilidad documental", () => {
  it("no acepta metadatos vacíos ni fuentes comerciales", () => {
    expectCode(() => validateFiscalSource({ ...source, url: "https://example.com/uma" }), "INVALID_METADATA")
    expectCode(() => validateParameterTimeline([{ ...complete[0], sources: [] }], coverage), "INVALID_METADATA")
    expectCode(() => validateFiscalSource({ ...source, locator: "" }), "INVALID_METADATA")
  })

  it("rechaza verificación anterior a publicación y texto futuro", () => {
    expectCode(() => validateFiscalSource({ ...source, verifiedOn: "2025-12-31" }), "INVALID_METADATA")
    expectCode(() => validateFiscalSource({ ...source, currentTextAsOf: "2027-01-01" }), "INVALID_METADATA")
  })
})
