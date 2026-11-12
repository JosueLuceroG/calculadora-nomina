import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
const fixture = JSON.parse(readFileSync(new URL("../src/tests/fixtures/operational-4b1.expected.json", import.meta.url), "utf8"))
const on = fixture.direct.find(item => item.id === "M01-on")
const off = fixture.direct.find(item => item.id === "M01-off")
const weekly = fixture.inverse.find(item => item.id === "M09-week")
const targets = { isr: "Tarifas ISR", uma: "UMA", subsidy: "Subsidio al empleo", imss: "Cuotas IMSS", minimum: "Salarios mínimos", benefits: "Prestaciones", policies: "Criterios del simulador" }
export async function checkHelpCases({ page, report, fill, calculate, screenshot, native, isNative, base }) {
  const nav = name => page.getByRole("navigation", { name: "Navegación principal" }).getByRole("button", { name, exact: true })
  async function fresh(scenario) {
    await page.goto(scenario ? `${base}dev/inverse.html?case=${scenario}` : `${base}dev/money.html`, { waitUntil: "networkidle" })
    await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled)
  }
  async function help() {
    await nav("Ayuda").click(); await page.locator("#help-title").waitFor({ state: "visible" })
    assert.equal(await nav("Ayuda").getAttribute("aria-current"), "page")
    assert.equal(await page.locator("#calculator-workspace").isVisible(), false)
  }
  async function calculator() { await nav("Calcular").click(); await page.locator("#calculator-workspace").waitFor({ state: "visible" }) }
  async function openTopics() {
    for (const summary of await page.locator(".help-topic > summary").all()) {
      if (await summary.locator("..").getAttribute("open") === null) { await summary.focus(); await page.keyboard.press("Enter") }
    }
  }
  async function target(category) {
    await openTopics()
    await page.locator(`[data-help-parameter="${category}"]`).first().focus(); await page.keyboard.press("Enter")
    await page.waitForFunction(category => document.querySelector('#parameters-workspace:not([hidden]) #parameter-category-panel')?.getAttribute("data-category") === category, category)
    assert.equal(await page.locator("#parameter-category-title").innerText(), targets[category])
    await page.waitForFunction(() => document.activeElement?.id === "parameter-category-title")
  }
  async function save() {
    await page.evaluate(() => { window.__beforeHelpState = JSON.stringify(window.__moneyVerification.state); window.__beforeHelpCalls = window.__moneyVerification.requests.length })
  }
  async function same() {
    assert.equal(await page.evaluate(() => JSON.stringify(window.__moneyVerification.state) === window.__beforeHelpState), true)
    assert.equal(await page.evaluate(() => window.__moneyVerification.requests.length === window.__beforeHelpCalls), true)
  }
  async function measure(name) {
    const metrics = await page.evaluate(name => ({ name, viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, font: getComputedStyle(document.querySelector(".help-topic-body")).fontSize }), name)
    assert(metrics.scrollWidth <= metrics.clientWidth, `Horizontal: ${name}`)
    report.metrics.push(metrics)
  }
  const outbound = []
  const observe = r => { if (/^https?:/.test(r.url()) && !r.url().startsWith(base) && !r.url().startsWith("http://ipc.localhost/")) outbound.push(r.url()) }
  page.context().on("request", observe)

  await fill("15000.50", "gross-to-net", "monthly", false)
  for (const [id, value] of [["bonus-days", "18.50"], ["vacation-days", "20.25"], ["vacation-premium", "30.50"], ["effective-date", "2026-01-31"]]) await page.locator(`#${id}`).fill(value)
  await page.locator("#salary").focus(); await page.keyboard.press("End"); await page.keyboard.type("0")
  await page.keyboard.press("Home"); await page.keyboard.press("ArrowRight"); await page.keyboard.press("Shift+ArrowRight")
  await page.evaluate(() => { const e = document.querySelector("#salary"); window.__helpMoneyNode = e; window.__helpSelection = [e.selectionStart, e.selectionEnd] })
  await save(); await help()
  await page.evaluate(() => scrollTo(0, 0)); await measure("Ayuda inicial 1180"); await screenshot("help-1180")
  assert.equal(await page.locator(".help-topic").count(), 10)
  assert.equal(await page.locator(".help-topic[open]").count(), 0)
  assert.equal(await page.locator(".help-important-note").evaluate(e => e.closest("details") === null), true)
  assert((await page.locator(".help-important-note").innerText()).includes("no hay una excepción automática de ISR"))
  const amounts = await page.locator(".help-example-amounts dd").allTextContents()
  assert.deepEqual(amounts.map(v => v.replace(/[$,\s]/g, "")), [on.expected.components.gross, on.expected.components.isrWithheld, on.expected.components.imssDeducted, on.expected.components.net])
  assert((await page.locator(".help-example-steps").innerText()).includes(off.expected.components.net.replace(/(\d)(?=(\d{3})+\.)/g, "$1,")))
  assert((await page.locator(".help-example-body").innerText()).includes("no se suma el subsidio otra vez al neto"))
  await same()
  report.checks.push("Ayuda funcional: diez conceptos plegados, ejemplo M01-on/M01-off exacto y condición artículo 96 visible sin abrir detalles")

  for (const summary of await page.locator(".help-topic > summary").all()) {
    await summary.focus(); await page.keyboard.press("Enter")
    assert.equal(await summary.locator("..").getAttribute("open"), "")
    await page.keyboard.press("Space"); assert.equal(await summary.locator("..").getAttribute("open"), null)
    await page.keyboard.press("Enter")
  }
  await page.locator("#help-topic-gross > summary").focus(); await page.keyboard.press("Tab")
  assert.equal(await page.evaluate(() => document.activeElement?.matches('#help-topic-gross [data-help-parameter="isr"]')), true)
  await page.keyboard.press("Shift+Tab")
  assert.equal(await page.evaluate(() => document.activeElement?.matches("#help-topic-gross > summary")), true)
  const all = await page.locator(".help-section").innerText()
  for (const phrase of ["Neto = Bruto", "No son tres descuentos", "no constituye una exención legal", "SBC efectivamente registrado", "no un valor universal", "fecha civil local", "no necesariamente es la fecha de pago", "2027", "no está resuelto", "no está homologado", "CFDI"]) assert(all.includes(phrase), phrase)
  const alternatives = await page.locator(".help-inverse-example").innerText()
  for (const candidate of weekly.expectedCandidates) assert(alternatives.includes(candidate.gross.replace(/(\d)(?=(\d{3})+\.)/g, "$1,")))
  assert(alternatives.includes("no aseguran unicidad ni cobertura global"))
  assert.equal(await page.locator(".help-section table, .help-section input, .help-section select, .help-section form").count(), 0)
  await measure("Ayuda desplegada 1180")
  report.checks.push("Enter/Espacio/Tab/Shift+Tab en desplegables y controles, conceptos y garantías correctos; ejemplo semanal M09-week sin unicidad/cobertura global ni tablas duplicadas")

  await page.evaluate(() => { window.__helpNode = document.querySelector(".help-section") })
  for (const category of Object.keys(targets)) {
    await target(category)
    await same()
    if (category === "isr") {
      await page.locator(".parameter-sources > summary").focus(); await page.keyboard.press("Space")
      assert((await page.locator(".parameter-sources").innerText()).includes("Verificación del paquete"))
    }
    await help()
    assert.equal(await page.evaluate(() => window.__helpNode === document.querySelector(".help-section")), true)
    assert.equal(await page.locator(".help-topic[open]").count(), 10)
  }
  // Repetir un destino después de cambiarlo en Parámetros no conserva una ruta vieja.
  await target("isr"); await page.getByRole("group", { name: "Categorías de parámetros" }).getByRole("button", { name: "UMA", exact: true }).click()
  await help(); await target("isr")
  await calculator(); await same()
  assert.equal(await page.evaluate(() => { const e = document.querySelector("#salary"); return e === window.__helpMoneyNode && JSON.stringify([e.selectionStart, e.selectionEnd]) === JSON.stringify(window.__helpSelection) }), true)
  await page.locator("#salary").focus(); await page.keyboard.press("Control+Z"); assert.equal(await page.locator("#salary").inputValue(), "15,000.50")
  await help(); await target("benefits"); await calculator()
  await page.locator("#salary").focus(); await page.keyboard.press("Control+Y"); assert.equal(await page.locator("#salary").inputValue(), "15,000.500")
  for (const [id, value] of [["bonus-days", "18.50"], ["vacation-days", "20.25"], ["vacation-premium", "30.50"], ["effective-date", "2026-01-31"]]) assert.equal(await page.locator(`#${id}`).inputValue(), value)
  assert.equal(await page.locator("#exclude-imss").isChecked(), true)
  report.checks.push("siete destinos internos abren su categoría/fuentes, incluso al repetir; navegación conserva nodos, selección, undo/redo, fecha y prestaciones sin cálculos")

  await page.locator("#salary").press("Enter")
  assert.equal(await page.locator("#salary").getAttribute("aria-invalid"), "true")
  const error = await page.locator("#salary-error").innerText()
  await help(); await target("subsidy"); await calculator()
  assert.equal(await page.locator("#salary-error").innerText(), error)
  report.checks.push("errores de captura y borradores inválidos sobreviven a consultar Ayuda y Parámetros")

  await fresh(); await fill("15000.00"); await save(); await help()
  await page.context().setOffline(true)
  for (const category of Object.keys(targets)) { await openTopics(); await target(category); await help() }
  await calculator(); await same()
  await page.context().setOffline(false)
  assert.equal(outbound.length, 0)
  report.checks.push("offline con red desactivada: contenido y siete accesos internos disponibles, sin peticiones externas ni motor nuevo")

  for (const c of [
    { amount: "15000.00", direction: "gross-to-net", period: "monthly", imss: true, net: "$ 13,202.64" },
    { amount: "15000.00", direction: "gross-to-net", period: "monthly", imss: false, net: "$ 13,597.18" },
    { amount: "3500.00", direction: "gross-to-net", period: "weekly", imss: true, net: "$ 3,076.67" },
    { amount: "13202.64", direction: "net-to-gross", period: "monthly", imss: true, net: "$ 15,000.00" },
  ]) {
    await fresh(); await fill(c.amount, c.direction, c.period, c.imss); await calculate()
    assert.equal(await page.locator(".primary-amount").innerText(), c.net)
    await page.locator(".fiscal-insights > summary").click(); await page.locator(".technical-result-details > summary").click()
    await page.evaluate(() => { window.__helpResult = document.querySelector(".results-section"); window.__helpResultHtml = window.__helpResult.outerHTML })
    await save(); await help(); await target("uma"); await help(); await calculator(); await same()
    assert.equal(await page.evaluate(() => window.__helpResult === document.querySelector(".results-section") && window.__helpResult.outerHTML === window.__helpResultHtml), true)
    assert.equal(await page.locator(".primary-amount").innerText(), c.net)
    report.fiscal.push({ ...c, afterNavigation: await page.locator(".primary-amount").innerText() })
  }
  report.checks.push("cuatro regresiones fiscales tras tres secciones: mismo resultado, HTML, detalles abiertos, snapshot, fecha y requestId; cero centavos de diferencia")

  await fresh(); await fill("9451.20"); await calculate(); await page.locator("#minimum-month-ack").check(); await save()
  await help(); await target("minimum"); await calculator(); await same()
  assert.equal(await page.locator("#minimum-month-ack").isChecked(), true)
  report.checks.push("hipótesis mensual marcada se conserva sin aplicarse al consultar la explicación del artículo 96")

  await fresh("deferred"); await fill("13202.64", "net-to-gross"); await page.locator("#salary").press("Enter")
  await page.getByRole("button", { name: "Cancelar", exact: true }).waitFor(); await help(); await target("isr")
  assert.equal(await page.evaluate(() => window.__inverseVerification.state.pending[0].aborted), false)
  assert.equal(await page.evaluate(() => window.__inverseVerification.state.calls), 1)
  await page.evaluate(() => window.__inverseVerification.resolve(0))
  assert.equal(await page.locator(".parameters-section").isVisible(), true)
  assert.equal(await page.evaluate(() => document.activeElement?.id === "results-title"), false)
  await help(); await calculator(); assert.equal(await page.locator(".primary-amount").innerText(), "$ 15,000.00")
  assert.equal(await page.evaluate(() => window.__inverseVerification.state.calls), 1)
  report.checks.push("inverso pendiente continúa en Ayuda/Parámetros, completa sin robar foco y se conserva al regresar")

  for (const action of ["Cancelar", "Limpiar"]) {
    await fresh("deferred"); await fill("13202.64", "net-to-gross"); await page.locator("#salary").press("Enter")
    await page.getByRole("button", { name: "Cancelar", exact: true }).waitFor(); await help(); await target("isr"); await calculator()
    await page.getByRole("button", { name: action, exact: true }).click(); await help()
    await page.evaluate(() => window.__inverseVerification.resolve(0)); await calculator()
    if (action === "Cancelar") { assert.equal(await page.locator(".results-section").getAttribute("data-result-state"), "cancelled"); assert.equal(await page.locator(".primary-amount").innerText(), "$ —") }
    else { assert.equal(await page.locator(".results-section").count(), 0); assert.equal(await page.locator("#salary").inputValue(), "") }
  }
  report.checks.push("cancelación y limpieza explícitas después de navegar siguen descartando respuestas tardías; el ejemplo nunca repuebla resultados")

  await fresh(); await fill("15000.00"); await page.locator("input#effective-date").fill("2027-01-01"); await save()
  await help(); await target("uma"); assert((await page.locator(".parameter-context").innerText()).includes("fuera de la cobertura"))
  await calculator(); await same(); assert.equal(await page.locator('button[type="submit"]').isDisabled(), true)
  assert.equal(await page.locator("input#effective-date").inputValue(), "2027-01-01")
  report.checks.push("ejemplo histórico 2026 no sustituye fecha 2027 de captura ni elimina el bloqueo por falta de cobertura")

  await fresh(); await help(); await page.evaluate(() => scrollTo(0, 0)); await measure("Ayuda final 1180")
  if (isNative) report.resizes.push(native("resize", ["-Width", "900", "-Height", "600"]))
  else await page.setViewportSize({ width: 900, height: 600 })
  await page.waitForFunction(() => innerWidth === 900)
  await page.evaluate(() => scrollTo(0, 0)); await measure("Ayuda inicial 900"); await screenshot("help-900")
  await openTopics(); await measure("Ayuda desplegada 900")
  await page.locator(".help-footer").scrollIntoViewIfNeeded()
  report.checks.push("Ayuda 1180×760 y 900×600: contenido/categorías accesibles por teclado, fuente 14px y scroll natural sin horizontal")
  report.externalRequests = outbound
  assert.deepEqual(outbound, [])
  page.context().off("request", observe)
}
