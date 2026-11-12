import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { FISCAL_PARAMETERS_2026, selectFiscalParameters2026 } from "../../infrastructure/fiscal/2026"
import { FISCAL_SOURCES } from "../../infrastructure/fiscal/sources"
import { STANDARD_CONVENTIONS } from "../../domain/payroll/simulation-conventions"
import { calculateStandardEstimatedEmploymentSubsidy } from "../../domain/payroll/employment-subsidy"
import { standardEmploymentSubsidyContext2026 } from "../../infrastructure/fiscal/2026"
import { getParameterCatalog2026, findCatalogSourceReview } from "./parameter-catalog"
import { IsrTariffTable, ParameterContent, ParameterSection, parameterCategories } from "./parameter-section"
import { nativeOfficialSourceOpener } from "./official-source-link"

const catalog = getParameterCatalog2026()
describe("5B.5: catálogo del repositorio, exacto e inmutable", () => {
  it("devuelve la misma proyección congelada y los mismos conjuntos de ISR del motor", () => {
    expect(getParameterCatalog2026()).toBe(catalog)
    expect(catalog.isrTariffs).toBe(FISCAL_PARAMETERS_2026.isrTariffs)
    expect(catalog.exercise).toBe(2026)
    expect(catalog.packageVersion).toBe("mx-fiscal-2026-source-v3")
    expect(catalog.supportedDates).toEqual({ from: "2026-01-01", through: "2026-12-31" })
    expect(Object.isFrozen(catalog)).toBe(true)
    expect(Object.isFrozen(catalog.isrTariffs[0].data.rows)).toBe(true)
    expect(() => { (catalog.isrTariffs[0].data.rows[0] as unknown as { lower: string }).lower = "999" }).toThrow()
    expect(FISCAL_PARAMETERS_2026.isrTariffs[0].data.rows[0].lower).toBe("0.01")
  })
  it.each(["weekly", "fortnightly", "monthly"] as const)("%s: once tramos y cuatro columnas coinciden con la selección productiva", period => {
    const actual = catalog.isrTariffs.find(set => set.data.periodicity === period)!
    const engine = selectFiscalParameters2026("2026-02-01", period).isrTariff
    expect(actual).toBe(engine)
    expect(actual.data.rows).toHaveLength(11)
    expect(actual.data.rows.at(-1)?.upper).toBeNull()
    const html = renderToStaticMarkup(<IsrTariffTable tariff={actual} label={period} />)
    expect(html.match(/data-isr-row=/g)).toHaveLength(11)
    expect(html.match(/<td>/g)).toHaveLength(44)
    expect(html.match(/scope="col"/g)).toHaveLength(4)
    const rows = [...html.matchAll(/<tr[^>]*data-isr-row="\d+">(.*?)<\/tr>/g)].map(match => [...match[1].matchAll(/<td>(.*?)<\/td>/g)].map(cell => cell[1].replace(/[$,\s%]/g, "")))
    expect(rows).toEqual(engine.data.rows.map(row => [row.lower, row.upper ?? "Enadelante", row.fixedFee, row.ratePercent]))
  })
  it.each([
    [0, 2025, "113.14", "3439.46", "41273.52", "2026-01-01", "2026-01-31"],
    [1, 2026, "117.31", "3566.22", "42794.64", "2026-02-01", "2026-12-31"],
  ] as const)("UMA %s conserva año, tres valores y aplicación correcta en 2026", (index, year, daily, monthly, annual, from, through) => {
    expect(catalog.uma[index].parameters).toBe(FISCAL_PARAMETERS_2026.uma[index])
    expect(catalog.uma[index].parameters.data).toMatchObject({ valueYear: year, daily, monthly, annual })
    expect(catalog.uma[index]).toMatchObject({ applicationFrom: from, applicationThrough: through })
  })
  it("separa diario oficial, mes simulado y mes CONASAMI sin cambiar el paquete", () => {
    const item = catalog.minimumWages[0]
    expect(item.parameters).toBe(FISCAL_PARAMETERS_2026.minimumWages[0])
    expect(item.parameters.data.general).toEqual({ daily: "315.04", publishedMonthlyReference: "9582.47" })
    expect(item.simulatedMonthlyGeneral).toBe("9451.20")
    expect(item.simulatedMonthlyDays).toBe(FISCAL_PARAMETERS_2026.contractualDivisors[0].data.monthly)
    const html = renderToStaticMarkup(<ParameterContent category="minimum" catalog={catalog} />)
    expect(html).toContain("Esta versión solo realiza cálculos para la zona salarial general")
    expect(html).toContain("Si falta información compatible, la retención y el neto no se determinan")
    expect(html).toContain("La región de análisis no es un piso legal")
    expect(html).toContain("artículo 96")
    expect(html).toContain("$ 9,451.20")
    expect(html).toContain("$ 9,582.47")
  })
  it.each([
    [0, "15.59", "536.211814", "536.21", "123.47", "264.58"],
    [1, "15.02", "535.646244", "535.65", "123.34", "264.30"],
  ] as const)("subsidio %s: fórmula y proporcionalidad exactas del repositorio", (index, rate, raw, rounded, weekly, fortnightly) => {
    const item = catalog.subsidy[index]
    expect(item.parameters).toBe(FISCAL_PARAMETERS_2026.subsidy[index])
    expect(item.parameters.data.monthlyIncomeLimit).toBe("11492.66")
    expect(item.parameters.data.submonthlyDivisor).toBe("30.4")
    expect(item.ratePercent).toBe(rate)
    expect(item.monthlyQuota).toMatchObject({ raw, amount: rounded })
    expect(item.periodQuotas.map(q => q.amount)).toEqual([weekly, fortnightly])
    expect(item.uma.data.valueYear).toBe(item.parameters.data.umaMonthlyValueYear)
    const actual = calculateStandardEstimatedEmploymentSubsidy({ profileId: STANDARD_CONVENTIONS.id, grossPeriodSalary: "10000.00", referenceDate: item.parameters.effectiveFrom, periodicity: "monthly" }, standardEmploymentSubsidyContext2026())
    expect(actual.amounts.subsidyDetermined).toBe(item.monthlyQuota.amount)
  })
  it.each([
    ["pensioner-medical", "0.375", "25"], ["cash-benefits", "0.25", "107"],
    ["disability-life", "0.625", "147"], ["unemployment-old-age", "1.125", "168"],
    ["excess-medical", "0.4", "106"],
  ])("IMSS %s: porcentaje y referencia, sin copiar tasas en React", (id, rate, article) => {
    const item = catalog.imss[0].branches.find(branch => branch.id === id)!
    expect(item.ratePercent).toBe(rate)
    expect(item.legalReference).toContain(article)
    expect(item.rateProportion).toBe(FISCAL_PARAMETERS_2026.imssConstants[0].data.workerRates[item.id])
  })
  it("umbrales 3 UMA y 25 UMA se derivan de las dos vigencias", () => {
    expect(catalog.uma.map(item => [item.excessThreshold, item.sbcCeiling])).toEqual([["339.42", "2828.50"], ["351.93", "2932.75"]])
    expect(catalog.imss[0].branches).toHaveLength(5)
  })
  it("referencias de prestaciones y políticas conservan las fuentes originales", () => {
    expect(catalog.benefits).toBe(FISCAL_PARAMETERS_2026.laborBenefitMinima)
    expect(catalog.conventions).toBe(STANDARD_CONVENTIONS)
    expect(catalog.integrationRules.annualizationDays).toBe("365")
    expect(catalog.imssPolicy.allocationPriority).toBe("legal-absorption-before-simulation-switch")
    expect(catalog.conventions.suaEquivalence).toBe("not-validated")
  })
  it("las doce consultas de fuentes son específicas, oficiales y conservan originales 4B.1", () => {
    expect(catalog.sourceReview.records).toHaveLength(12)
    for (const record of catalog.sourceReview.records) {
      expect(record.status).toBe("verified")
      expect(record.unchangedFrom4b1).toBe(true)
      expect(record.sha256).toBe(record.previousSha256)
      expect(new URL(record.url).protocol).toBe("https:")
      expect(record.url).toMatch(/(?:\.pdf|\/docFuente\/\d+)$/)
    }
    for (const source of Object.values(FISCAL_SOURCES)) expect(findCatalogSourceReview(source.url)?.status).toBe("verified")
  })
  it("la puerta de lectura no invoca motores ni conoce controlador o captura", () => {
    const text = readFileSync(fileURLToPath(new URL("./parameter-catalog.ts", import.meta.url)), "utf8")
    expect(text).not.toMatch(/calculate\w+\s*\(/)
    expect(text).not.toMatch(/createCalculationController|fiscal-adapter|CaptureForm|fetch\s*\(/)
    const component = readFileSync(fileURLToPath(new URL("./parameter-section.tsx", import.meta.url)), "utf8")
    expect(component).not.toMatch(/(?:0\.00375|0\.0025|0\.00625|0\.01125|315\.04|9582\.47|113\.14|117\.31)/)
  })
})

describe("5B.5: presentación de consulta accesible y offline", () => {
  it.each(parameterCategories)("$label contiene datos y no controles de edición normativa", ({ id }) => {
    const html = renderToStaticMarkup(<ParameterContent category={id} catalog={catalog} />)
    expect(html).toContain(`data-category="${id}"`)
    expect(html).toContain("Fuentes oficiales y verificación")
    expect(html).not.toMatch(/<(?:input|textarea|select|form)\b/)
    expect(html).not.toContain("contenteditable")
    expect(html).toContain('target="_blank" rel="noopener noreferrer"')
    expect(html).toContain("Verificación del paquete")
    expect(html).toContain("mismo original de 4B.1")
  })
  it("el catálogo consulta todas las vigencias y distingue una captura de 2027", () => {
    const html = renderToStaticMarkup(<ParameterSection referenceDate="2027-01-01" simulationPackage={null} />)
    expect(html).toContain("fuera de la cobertura de este catálogo 2026")
    expect(html).toContain("01/01/2027")
    expect(html).toContain("aún no determinado")
    expect(html).toContain("no cambia esos datos ni recalcula")
    expect(html).toContain("consulta de solo lectura".replace("consulta", "Consulta"))
  })
  it("distingue el paquete de una simulación histórica del catálogo consultado", () => {
    const html = renderToStaticMarkup(<ParameterSection referenceDate="2026-01-31" simulationPackage="paquete-de-simulacion-conservado" />)
    expect(html).toContain("mx-fiscal-2026-source-v3")
    expect(html).toContain("paquete-de-simulacion-conservado")
    expect(html).toContain("31/01/2026")
  })
  it("vacaciones no se universalizan; factor y plantilla se explican como editables", () => {
    const html = renderToStaticMarkup(<ParameterContent category="benefits" catalog={catalog} />)
    expect(html).toContain("no corresponden universalmente")
    expect(html).toContain("editable")
    expect(html).toContain("Artículo 76")
    expect(html).toContain("Artículo 80")
    expect(html).toContain("Artículo 87")
    expect(html).toContain("solo su prima incrementa el factor")
  })
  it("SBC, absorción y exclusión no se confunden con registro o exención", () => {
    const html = renderToStaticMarkup(<ParameterContent category="imss" catalog={catalog} />)
    expect(html).toContain("estimado, no registrado ante el IMSS")
    expect(html).toContain("no es una exención legal")
    expect(html).toContain("artículo 36")
    expect(html).toContain("transitorio XIX")
  })
  it("cuota narrativa no sustituye fórmula y el aplicado no se suma dos veces", () => {
    const html = renderToStaticMarkup(<ParameterContent category="subsidy" catalog={catalog} />)
    expect(html).toContain("536.211814")
    expect(html).toContain("535.646244")
    expect(html).toContain("536.22 como cifra explicativa")
    expect(html).toContain("No sustituye los porcentajes")
    expect(html).toContain("Determinado no significa aplicado")
    expect(html).toContain("ni vuelve a sumarse al neto")
  })
  it("consulta y renderizado no necesitan peticiones ni una conexión", () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline"))
    try {
      for (const { id } of parameterCategories) expect(renderToStaticMarkup(<ParameterContent category={id} catalog={getParameterCatalog2026()} />)).toContain("data-category")
      expect(fetch).not.toHaveBeenCalled()
    } finally { fetch.mockRestore() }
  })
  it("la apertura nativa solo invoca el comando explícito con la URL del documento", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("window", { __TAURI_INTERNALS__: { invoke } })
    try {
      const open = nativeOfficialSourceOpener()!
      expect(invoke).not.toHaveBeenCalled()
      await open(FISCAL_SOURCES.isrSat.url)
      expect(invoke).toHaveBeenCalledExactlyOnceWith("open_official_source", { url: FISCAL_SOURCES.isrSat.url })
    } finally { vi.unstubAllGlobals() }
  })
  it("en navegador normal conserva el enlace estándar sin IPC", () => {
    vi.stubGlobal("window", {})
    try { expect(nativeOfficialSourceOpener()).toBeUndefined() } finally { vi.unstubAllGlobals() }
  })
})
