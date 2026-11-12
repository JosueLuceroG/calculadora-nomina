import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const isr = JSON.parse(readFileSync(fileURLToPath(new URL("../src/infrastructure/fiscal/parameters/2026/isr.json", import.meta.url)), "utf8"))
const categories = ["Tarifas ISR", "UMA", "Salarios mínimos", "Subsidio al empleo", "Cuotas IMSS", "Prestaciones", "Criterios del simulador"]
export async function checkParameterCases({ page, report, fill, calculate, edit, screenshot, native, isNative, base, out, mode }) {
  const external = []
  const observe = request => { if (/^https?:/.test(request.url()) && !request.url().startsWith(base) && !request.url().startsWith("http://ipc.localhost/")) external.push(request.url()) }
  page.context().on("request", observe)
  const nav = name => page.getByRole("navigation", { name: "Navegación principal" }).getByRole("button", { name, exact: true })
  async function parameters() {
    await nav("Parámetros").click()
    await page.locator("#parameters-title").waitFor({ state: "visible" })
    assert.equal(await nav("Parámetros").getAttribute("aria-current"), "page")
    assert.equal(await page.locator("#calculator-workspace").isVisible(), false)
  }
  async function calculator() {
    await nav("Calcular").click()
    await page.locator("#calculator-workspace").waitFor({ state: "visible" })
    assert.equal(await nav("Calcular").getAttribute("aria-current"), "page")
  }
  async function category(label) {
    await page.getByRole("group", { name: "Categorías de parámetros" }).getByRole("button", { name: label, exact: true }).click()
    assert.equal(await page.locator("#parameter-category-title").innerText(), label)
  }
  async function fresh(scenario) {
    await page.goto(scenario ? `${base}dev/inverse.html?case=${scenario}` : `${base}dev/money.html`, { waitUntil: "networkidle" })
    await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled)
  }
  async function measure(name) {
    const metrics = await page.evaluate(name => ({ name, viewport: [innerWidth, innerHeight], dpr: devicePixelRatio,
      scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight,
      scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
      tables: [...document.querySelectorAll("#parameters-workspace table")].map(e => ({ width: e.getBoundingClientRect().width, scrollWidth: e.scrollWidth, clientWidth: e.clientWidth, font: getComputedStyle(e).fontSize })),
    }), name)
    report.metrics.push(metrics)
    assert(metrics.scrollWidth <= metrics.clientWidth, `Horizontal: ${name}`)
    assert(metrics.tables.every(table => table.scrollWidth <= table.clientWidth), `Tabla desbordada: ${name}`)
  }
  async function preserveState() {
    await page.evaluate(() => { window.__savedParameterState = JSON.stringify(window.__moneyVerification.state); window.__savedParameterCalls = window.__moneyVerification.requests.length })
  }
  async function sameState() {
    assert.equal(await page.evaluate(() => JSON.stringify(window.__moneyVerification.state) === window.__savedParameterState), true, "Consultar parámetros no altera el cálculo")
    assert.equal(await page.evaluate(() => window.__moneyVerification.requests.length === window.__savedParameterCalls), true, "Consultar parámetros no ejecuta el motor")
  }
  async function table(period, label) {
    await page.getByRole("group", { name: "Periodicidad de la tarifa ISR" }).getByRole("button", { name: label, exact: true }).click()
    const rows = await page.locator("#isr-tariff-table tbody tr").evaluateAll(rows => rows.map(row => [...row.querySelectorAll("td")].map(td => td.textContent.replace(/[$,\s%]/g, ""))))
    assert.equal(rows.length, 11)
    assert.deepEqual(rows, isr[period].map(row => [row.lower, row.upper ?? "Enadelante", row.fixedFee, row.ratePercent]))
    assert.equal(await page.locator("#isr-tariff-table").getAttribute("data-parameter-id"), `mx-isr-2026-${period}`)
    report.fiscal.push({ table: period, rowsVerified: rows.length, cellsVerified: rows.length * 4, lastUpper: await page.locator("#isr-tariff-table tbody tr").last().locator("td").nth(1).innerText() })
    // Captura completa del contenido del WebView, desde arriba: evita que la
    // barra sticky cubra el encabezado al centrar automáticamente una tabla alta.
    await page.evaluate(() => scrollTo(0, 0))
    await page.screenshot({ path: join(out, `${mode}-parameters-isr-${period}-full.png`), fullPage: true })
  }

  if (!process.argv.includes("--links-only")) {
  await fill("15000.50", "gross-to-net", "monthly", false)
  for (const [id, value] of [["bonus-days", "18.50"], ["vacation-days", "20.25"], ["vacation-premium", "30.50"], ["effective-date", "2026-01-31"]]) await page.locator(`#${id}`).fill(value)
  await page.locator("#salary").focus(); await page.keyboard.press("End"); await page.keyboard.type("0")
  await page.keyboard.press("Home"); await page.keyboard.press("ArrowRight"); await page.keyboard.press("Shift+ArrowRight")
  await page.evaluate(() => { const e = document.querySelector("#salary"); window.__savedMoneySelection = [e.selectionStart, e.selectionEnd] })
  await preserveState()
  await page.evaluate(() => { window.__savedMoneyNode = document.querySelector("#salary") })
  await parameters()
  assert.equal(await page.locator(".parameters-header").innerText().then(t => t.includes("2026")), true)
  assert((await page.locator(".parameter-context").innerText()).includes("31/01/2026"))
  await page.evaluate(() => scrollTo(0, 0)); await screenshot("parameters-overview-1180")
  for (const [period, label] of [["weekly", "Semanal"], ["fortnightly", "Quincenal"], ["monthly", "Mensual"]]) await table(period, label)
  report.checks.push("33 filas ISR / 132 celdas cotejadas con JSON productivo; once tramos y En adelante, tres periodicidades")
  await sameState()
  await calculator()
  assert.equal(await page.evaluate(() => window.__savedMoneyNode === document.querySelector("#salary")), true)
  assert.equal(await page.locator("#salary").inputValue(), "15,000.500")
  assert.equal(await page.evaluate(() => { const e = document.querySelector("#salary"); return JSON.stringify([e.selectionStart, e.selectionEnd]) === JSON.stringify(window.__savedMoneySelection) }), true)
  await page.locator("#salary").focus(); await page.keyboard.press("Control+Z")
  assert.equal(await page.locator("#salary").inputValue(), "15,000.50", "La pila monetaria sobrevive a la navegación")
  for (const [id, value] of [["bonus-days", "18.50"], ["vacation-days", "20.25"], ["vacation-premium", "30.50"], ["effective-date", "2026-01-31"]]) assert.equal(await page.locator(`#${id}`).inputValue(), value)
  assert.equal(await page.locator("#exclude-imss").isChecked(), true)
  report.checks.push("navegación conserva nodo monetario, texto canónico, undo, fecha manual, prestaciones e IMSS; cero recálculos")

  await parameters(); await preserveState()
  await category("UMA")
  let text = await page.locator("#parameter-category-panel").innerText()
  for (const value of ["113.14", "3,439.46", "41,273.52", "117.31", "3,566.22", "42,794.64", "31/01/2026", "01/02/2026"]) assert(text.includes(value), value)
  await measure("UMA 1180")
  await category("Salarios mínimos")
  text = await page.locator("#parameter-category-panel").innerText()
  for (const value of ["315.04", "9,451.20", "9,582.47", "hallazgo 4B.1", "no está resuelto", "artículo 96", "Esta versión solo realiza cálculos para la zona salarial general"]) assert(text.includes(value), value)
  await screenshot("parameters-minimum")
  await category("Subsidio al empleo")
  text = await page.locator("#parameter-category-panel").innerText()
  for (const value of ["11,492.66", "15.59%", "15.02%", "536.211814", "535.646244", "536.21", "535.65", "30.4", "536.22 como cifra explicativa", "Determinado no significa aplicado"]) assert(text.includes(value), value)
  await category("Cuotas IMSS")
  const rates = await page.locator("[data-imss-branch]").evaluateAll(rows => rows.map(row => row.querySelector("td").textContent))
  assert.deepEqual(rates, ["0.375%", "0.25%", "0.625%", "1.125%", "0.4%"])
  text = await page.locator("#parameter-category-panel").innerText()
  for (const value of ["3 UMA", "25 UMA", "2,828.50", "2,932.75", "no registrado", "artículo 36", "transitorio XIX"]) assert(text.includes(value), value)
  await category("Prestaciones")
  text = await page.locator("#parameter-category-panel").innerText()
  assert(text.includes("no corresponden universalmente")); assert(text.includes("editable")); assert(text.includes("solo su prima incrementa"))
  await category("Criterios del simulador")
  text = await page.locator("#parameter-category-panel").innerText()
  for (const value of ["Semanal 7", "quincenal 15", "mensual 30", "365", "50 dígitos", "CONTPAQi Nóminas", "acumulados", "Neto a Bruto"]) assert(text.includes(value), value)
  await sameState()
  report.checks.push("siete categorías: vigencias UMA/subsidio, mínimo mensual pendiente, cinco tasas IMSS, prestaciones editables y convenciones separadas")

  await category("Tarifas ISR")
  await page.locator(".parameter-sources > summary").focus(); await page.keyboard.press("Enter")
  text = await page.locator(".parameter-sources").innerText()
  assert(text.includes("Verificación del paquete")); assert(text.includes("mismo original de 4B.1")); assert(text.includes("Anexo 8")); assert(text.includes("2025"))
  assert.equal(await page.locator(".parameters-section input, .parameters-section textarea, .parameters-section select, .parameters-section form, .parameters-section [contenteditable]").count(), 0)
  assert.equal(external.length, 0, "No hay consultas externas automáticas")
  report.checks.push("fuentes con autoridad/documento/publicación/apartado/verificación; sin formularios ni modificación normativa ni peticiones externas automáticas")

  await page.context().setOffline(true)
  for (const label of categories) { await category(label); await measure(`offline ${label}`) }
  await calculator(); assert.equal(await page.locator("#salary").inputValue(), "15,000.50")
  await parameters(); assert.equal(await page.locator(".parameters-section").isVisible(), true)
  await page.context().setOffline(false)
  await sameState()
  report.checks.push("offline real con red desactivada: siete categorías y regreso a Calcular, sin depender de documentos externos")

  for (const c of [
    { amount: "15000.00", direction: "gross-to-net", period: "monthly", imss: true, expected: "$ 13,202.64" },
    { amount: "15000.00", direction: "gross-to-net", period: "monthly", imss: false, expected: "$ 13,597.18" },
    { amount: "3500.00", direction: "gross-to-net", period: "weekly", imss: true, expected: "$ 3,076.67" },
    { amount: "13202.64", direction: "net-to-gross", period: "monthly", imss: true, expected: "$ 15,000.00" },
  ]) {
    await fresh(); await fill(c.amount, c.direction, c.period, c.imss); await calculate()
    assert.equal(await page.locator(".primary-amount").innerText(), c.expected)
    if (c.direction === "net-to-gross") {
      await page.locator(".fiscal-insights > summary").click()
      await page.locator(".technical-result-details > summary").click()
    }
    await page.evaluate(() => { window.__savedResultNode = document.querySelector(".results-section"); window.__savedResultHtml = window.__savedResultNode.outerHTML })
    await preserveState(); await parameters(); await category("UMA"); await sameState(); await calculator()
    assert.equal(await page.evaluate(() => window.__savedResultNode === document.querySelector(".results-section") && window.__savedResultHtml === window.__savedResultNode.outerHTML), true)
    assert.equal(await page.locator(".primary-amount").innerText(), c.expected)
    report.fiscal.push({ ...c, obtainedAfterNavigation: await page.locator(".primary-amount").innerText() })
  }
  report.checks.push("cuatro regresiones fiscales: mismo nodo/HTML/reporte/snapshot/requestId al ir a Parámetros y regresar, sin recalcular")

  await fresh(); await fill("9451.20"); await calculate()
  await page.locator("#minimum-month-ack").check(); await preserveState(); await parameters(); await category("Salarios mínimos"); await calculator()
  await sameState(); assert.equal(await page.locator("#minimum-month-ack").isChecked(), true)
  report.checks.push("confirmación mensual local marcada se conserva sin aplicarse ni resetearse al consultar el hallazgo del mínimo")

  await fresh("deferred"); await fill("13202.64", "net-to-gross"); await page.locator("#salary").press("Enter")
  await page.getByRole("button", { name: "Cancelar", exact: true }).waitFor()
  await parameters()
  assert.equal(await page.evaluate(() => window.__inverseVerification.state.calls), 1)
  assert.equal(await page.evaluate(() => window.__inverseVerification.state.pending[0].aborted), false)
  await category("Cuotas IMSS")
  await page.evaluate(() => window.__inverseVerification.resolve(0))
  assert.equal(await page.locator(".parameters-section").isVisible(), true)
  assert.equal(await page.evaluate(() => document.activeElement?.id === "results-title"), false)
  await calculator()
  assert.equal(await page.locator(".primary-amount").innerText(), "$ 15,000.00")
  assert.equal(await page.evaluate(() => window.__inverseVerification.state.calls), 1)
  report.checks.push("inverso pendiente no abortado: completa mientras se leen parámetros, mantiene sección/foco y conserva resultado al volver")

  await fresh(); await fill("15000.00")
  await page.locator("input#effective-date").fill("2027-01-01")
  await preserveState(); await parameters()
  assert((await page.locator(".parameter-context").innerText()).includes("fuera de la cobertura de este catálogo 2026"))
  assert((await page.locator(".parameter-context").innerText()).includes("01/01/2027"))
  await calculator(); await sameState()
  assert.equal(await page.locator("input#effective-date").inputValue(), "2027-01-01")
  assert.equal(await page.locator('button[type="submit"]').isDisabled(), true)
  report.checks.push("captura 2027 distinta del catálogo 2026 se identifica expresamente; regreso conserva fecha y bloqueo sin fallback")

  await fresh(); await parameters(); await category("Tarifas ISR")
  if (isNative) report.resizes.push(native("resize", ["-Width", "900", "-Height", "600"]))
  else await page.setViewportSize({ width: 900, height: 600 })
  await page.waitForFunction(() => innerWidth === 900)
  for (const label of categories) { await category(label); await measure(`mínimo 900 ${label}`) }
  await category("Tarifas ISR"); await page.evaluate(() => scrollTo(0, 0)); await screenshot("parameters-overview-900")
  await table("monthly", "Mensual")
  if (isNative) report.resizes.push(native("resize", ["-Width", "1180", "-Height", "760"]))
  else await page.setViewportSize({ width: 1180, height: 760 })
  await page.waitForFunction(() => innerWidth === 1180)
  report.checks.push("1180×760 y 900×600: siete categorías sin horizontal, tablas a 14px y scroll vertical natural")
  } else {
    await fresh(); await parameters(); await category("Tarifas ISR")
  }

  await page.locator(".parameter-sources > summary").focus(); await page.keyboard.press("Space")
  const link = page.locator('a[data-official-source*="Anexo-8-RMF-2026"]')
  assert.equal(await link.getAttribute("target"), "_blank")
  assert((await link.getAttribute("rel")).includes("noopener"))
  if (isNative) {
    await page.evaluate(() => {
      // invoke es de solo lectura en Tauri 2. Observar el transporte fetch real
      // conserva el comando y su respuesta, sin sustituir el runtime nativo.
      const original = window.fetch
      window.__officialSourceAudit = []
      window.fetch = async function(input, options) {
        const result = await original.call(this, input, options)
        if (String(input).includes("/open_official_source")) window.__officialSourceAudit.push({ command: "open_official_source", url: JSON.parse(options.body).url, completed: result.headers.get("Tauri-Response") === "ok", response: await result.clone().text() })
        return result
      }
    })
    await link.focus(); await page.keyboard.press("Enter")
    await page.waitForFunction(() => window.__officialSourceAudit.length === 1)
    report.linkOpening = { method: "Windows ShellExecuteW mediante comando Tauri real", native: await page.evaluate(() => window.__officialSourceAudit[0]), mainUrl: page.url(), externalRequests: external.slice() }
    assert.equal(report.linkOpening.native.completed, true, report.linkOpening.native.response)
    assert.equal(await page.locator(".parameter-sources [role=alert]").count(), 0)
  } else {
    const popupPromise = page.context().waitForEvent("page", { timeout: 12000 })
    await link.focus(); await page.keyboard.press("Enter")
    const popup = await popupPromise
    report.linkOpening = { popup: Boolean(popup), externalRequests: external.slice(), mainUrl: page.url() }
    await popup.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {})
    report.linkOpening.popupUrl = popup.url(); await popup.close().catch(() => {})
  }
  assert(page.url().startsWith(base), "Abrir una fuente no sustituye la aplicación")
  assert.equal(await page.locator(".parameters-section").isVisible(), true)
  report.checks.push("enlace oficial SAT por teclado abre fuera de la página actual, únicamente por acción del usuario")
  page.context().off("request", observe)
}
