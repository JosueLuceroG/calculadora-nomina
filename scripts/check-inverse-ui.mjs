// Aplicación React real y entrada de desarrollo aislada. Sin paquetes nuevos.
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"

const root = fileURLToPath(new URL("../", import.meta.url))
const tools = process.env.PLAYWRIGHT_TOOLS_PATH ?? join(tmpdir(), "opencode", "calculadora-nomina-verification")
assert(existsSync(join(tools, "package.json")), "Indica PLAYWRIGHT_TOOLS_PATH con una instalación existente de Playwright.")
const { chromium } = createRequire(join(tools, "package.json"))("playwright")
const port = process.env.CALCULATOR_TEST_PORT ?? "1432"
const base = `http://127.0.0.1:${port}/`
let occupied = false
try { await fetch(base); occupied = true } catch { /* Puerto disponible. */ }
assert(!occupied, `El puerto ${port} está ocupado; no se reutiliza otro proceso.`)
const server = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", port, "--strictPort"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] })
let log = "", browser
server.stdout.on("data", v => { log += v.toString() })
server.stderr.on("data", v => { log += v.toString() })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const checks = [], metrics = [], errors = [], external = []
async function fill(page, { amount = "13202.64", period = "monthly", bonus = "15", vacation = "12", premium = "25", date = "2026-02-01" } = {}) {
  await page.locator('input[name="fiscal-date-mode"][value="yes"]').check()
  for (const [id, value] of [["salary", amount], ["period", period], ["bonus-days", bonus], ["vacation-days", vacation], ["vacation-premium", premium], ["effective-date", date]]) {
    if (id === "period") await page.locator(`#${id}`).selectOption(value)
    else await page.locator(`#${id}`).fill(value)
  }
}
async function calculate(page) {
  await page.locator("#salary").press("Enter")
  await page.locator(".results-section").waitFor()
  await page.waitForFunction(() => document.activeElement?.id === "results-title")
}
async function done(page) {
  await page.waitForFunction(() => document.querySelector(".results-section")?.getAttribute("aria-busy") === "false")
}
async function edit(page) {
  await page.getByRole("button", { name: "Editar datos", exact: true }).focus()
  await page.keyboard.press("Enter")
  await page.waitForFunction(() => document.activeElement?.id === "salary")
  assert.equal(await page.locator(".results-section").count(), 0)
}
async function measure(page, name) {
  const metric = await page.evaluate(name => ({ name, viewport: [innerWidth, innerHeight], document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight], panels: [...document.querySelectorAll(".detail-panel")].map(e => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom } }) }), name)
  metrics.push(metric)
  assert(metric.document[0] <= metric.viewport[0], `Desbordamiento horizontal: ${JSON.stringify(metric)}`)
  if (metric.viewport[0] === 1180) {
    assert(metric.document[1] <= 761, `Scroll ordinario a 1180x760: ${JSON.stringify(metric)}`)
    assert(metric.panels.every(p => p.bottom <= 760), "Paneles fuera de ventana ordinaria")
  }
}
async function emptyAmounts(page) {
  assert.equal(await page.locator('.results-section [aria-label="Sin resultado"]').count(), 4)
}
async function open(page, scenario) {
  await page.goto(scenario ? `${base}dev/inverse.html?case=${scenario}` : base, { waitUntil: "networkidle" })
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled)
}
async function currentTask(page) { return page.evaluate(() => window.__inverseVerification.state.pending.length - 1) }
async function assertAborted(page, index) { assert.equal(await page.evaluate(index => window.__inverseVerification.state.pending[index].aborted, index), true) }
try {
  let ready = false
  for (let i = 0; i < 250; i++) {
    if (server.exitCode !== null) throw new Error(log)
    try { if ((await fetch(base)).ok) { ready = true; break } } catch { /* Arranque Vite. */ }
    await sleep(100)
  }
  assert(ready, log)
  browser = await chromium.launch({ channel: "msedge", headless: true })
  const page = await browser.newPage({ viewport: { width: 1180, height: 760 } })
  page.on("pageerror", e => errors.push(e.message))
  page.on("request", r => { if (!r.url().startsWith(base) && !r.url().startsWith("data:")) external.push(r.url()) })
  await page.addInitScript(() => {
    window.__calculatingFrames = 0
    window.__inverseStarts = 0
    const Original = window.AbortController
    window.AbortController = class extends Original { constructor() { super(); window.__inverseStarts++ } }
    function frame() {
      const section = document.querySelector('.results-section[data-result-state="calculating"]')
      if (section?.getBoundingClientRect().height > 0 && document.querySelector("#result-message")?.textContent.includes("Calculando")) window.__calculatingFrames++
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })

  await open(page)
  assert.equal(await page.locator("#state").getAttribute("data-salary-area"), "general-zone")
  await page.locator('button[type="submit"]').click()
  assert.equal(await page.locator(".field-error").count(), 2)
  await page.waitForFunction(() => document.activeElement?.id === "salary")
  assert.equal(await page.locator("select#state").count(), 0)
  checks.push("captura inversa: plantilla visible, dos campos pendientes y zona general explícita, sin bruto inicial")

  await fill(page, { amount: "3076.67", period: "weekly" })
  const before = await page.evaluate(() => window.__inverseStarts)
  await page.locator(".capture-section").evaluate(form => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  })
  await done(page)
  assert.equal(await page.evaluate(() => window.__inverseStarts), before + 1)
  assert((await page.evaluate(() => window.__calculatingFrames)) >= 2, "No hubo dos oportunidades de pintado del estado Calculando")
  assert.equal(await page.locator(".primary-amount").innerText(), "$ 3,499.99")
  assert.equal(await page.locator('[data-inverse="obtained"]').innerText(), "$ 3,076.67")
  assert.equal(await page.locator('[data-inverse="difference"]').innerText(), "$ 0.00")
  assert.equal(await page.locator(".minimum-confirmation").count(), 0)
  assert.equal(await page.locator(".fiscal-insights").getAttribute("open"), null)
  await measure(page, "semanal exacto, alternativas cerradas")
  await page.screenshot({ path: join(tools, "3b3-weekly-1180.png") })
  await page.locator(".fiscal-insights > summary").click()
  await page.locator(".verified-alternatives > summary").click()
  assert((await page.locator('[aria-label="Brutos exactos verificados"]').innerText()).includes("$ 3,500.00"))
  assert.equal(await page.locator('.inverse-search-details button, .inverse-search-details input, .inverse-search-details select').count(), 0)
  assert.equal(await page.locator(".primary-amount").innerText(), "$ 3,499.99")
  await edit(page)
  checks.push("semanal real 3499.99/3500.00, doble submit único, Calculando pintable y alternativas informativas")

  await fill(page, { amount: "10500.00" }); await calculate(page); await done(page)
  assert.equal(await page.locator(".primary-amount").innerText(), "$ 11,093.07")
  assert.equal(await page.locator('[data-inverse="obtained"]').innerText(), "$ 10,500.00")
  await measure(page, "mensual múltiples, alternativas cerradas")
  await page.locator(".fiscal-insights > summary").click()
  await page.locator(".verified-alternatives > summary").click()
  assert((await page.locator('[aria-label="Brutos exactos verificados"]').innerText()).includes("$ 11,714.44"))
  await edit(page)
  await fill(page, { amount: "6592.87", period: "fortnightly" }); await calculate(page); await done(page)
  assert.equal(await page.locator(".primary-amount").innerText(), "$ 7,500.00")
  await measure(page, "quincenal exacto, detalles cerrados")
  await page.setViewportSize({ width: 900, height: 600 })
  await measure(page, "quincenal exacto, ventana mínima")
  await page.locator(".fiscal-insights").scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(tools, "3b3-results-900.png"), fullPage: true })
  await page.setViewportSize({ width: 1180, height: 760 })
  await edit(page)
  checks.push("mensual real con dos brutos, quincenal real y medidas 1180x760/900x600")

  await fill(page, { amount: "13597.18" })
  await page.locator("#exclude-imss").focus(); await page.keyboard.press("Space")
  await calculate(page); await done(page)
  assert.equal(await page.locator(".primary-amount").innerText(), "$ 15,000.00")
  assert.equal(await page.locator(".summary-imss p").innerText(), "$ 0.00")
  await edit(page)
  await page.locator("#include-imss").focus(); await page.keyboard.press("Space")
  checks.push("inverso real con IMSS excluido: cero determinado")

  await fill(page, { amount: "9451.20" }); await calculate(page); await done(page)
  assert.equal(await page.locator(".primary-result h3").innerText(), "Bruto encontrado")
  assert((await page.locator("#result-message").innerText()).includes("mínimo no demostrado"))
  assert.equal(await page.locator("#minimum-month-ack").isChecked(), false)
  assert.equal(await page.getByRole("button", { name: "Recalcular con hipótesis" }).isDisabled(), true)
  await page.screenshot({ path: join(tools, "3b3-minimum-pending.png"), fullPage: true })
  const priorGross = await page.locator(".primary-amount").innerText()
  await page.locator("#minimum-month-ack").focus(); await page.keyboard.press("Space")
  assert.equal(await page.locator(".primary-amount").innerText(), priorGross)
  await page.getByRole("button", { name: "Recalcular con hipótesis" }).focus(); await page.keyboard.press("Enter")
  await done(page)
  assert.equal(await page.locator(".primary-amount").innerText(), "$ 9,451.20")
  assert.equal(await page.locator('[data-inverse="obtained"]').innerText(), "$ 9,451.20")
  assert.equal(await page.locator(".summary-isr p").innerText(), "$ 0.00")
  assert.equal(await page.locator(".summary-imss p").innerText(), "$ 0.00")
  assert.equal(await page.locator('[data-subsidy="determined"]').textContent(), "$ 535.65")
  assert.equal(await page.locator('[data-subsidy="applied"]').innerText(), "$ 0.00")
  await page.screenshot({ path: join(tools, "3b3-minimum-confirmed.png"), fullPage: true })
  await edit(page)
  await page.locator("#effective-date").fill("2026-03-01"); await calculate(page); await done(page)
  assert.equal(await page.locator("#minimum-month-ack").isChecked(), false)
  assert((await page.locator(".minimum-confirmation").innerText()).includes("2026-03"))
  checks.push("hipótesis relevante, voluntaria y contextual; cambio de mes invalida sin contaminar candidatos ordinarios")

  await open(page)
  await fill(page, { bonus: "365000000" }); await calculate(page)
  await page.getByRole("button", { name: "Cancelar", exact: true }).click()
  assert.equal(await page.locator(".results-section").getAttribute("data-result-state"), "cancelled")
  await emptyAmounts(page)
  await edit(page)
  assert.equal(await page.locator("#bonus-days").inputValue(), "365000000")
  checks.push("cancelación de búsqueda cooperativa real conserva captura y no muestra importes")

  for (const [scenario, amount, period] of [["approximate", "5557.04", "fortnightly"], ["limited", "13202.64", "monthly"], ["time-limited", "13202.64", "monthly"], ["empty-limited", "1.00", "monthly"], ["unresolved", "9451.20", "monthly"], ["error", "13202.64", "monthly"]]) {
    await open(page, scenario)
    await fill(page, { amount, period }); await calculate(page); await done(page)
    assert.equal(await page.getByRole("button", { name: "Guardar", exact: true }).count(), 0)
    assert.equal(await page.getByRole("button", { name: "Exportar PDF", exact: true }).isDisabled(), true)
    if (scenario === "approximate") {
      assert.equal(await page.locator(".primary-result h3").innerText(), "Bruto aproximado")
      assert.equal(await page.locator('[data-inverse="obtained"]').innerText(), "$ 5,557.03")
      assert.equal(await page.locator('[data-inverse="difference"]').innerText(), "−$ 0.01")
      await page.locator(".fiscal-insights > summary").click()
      await page.locator(".technical-result-details > summary").click()
      assert((await page.locator(".inverse-search-details").innerText()).includes("únicamente dentro del dominio"))
      await page.screenshot({ path: join(tools, "3b3-approximate.png"), fullPage: true })
    } else if (scenario === "limited" || scenario === "time-limited" || scenario === "empty-limited") {
      assert.equal(await page.locator(".results-section").getAttribute("data-result-state"), "limited")
      if (scenario === "limited") assert.equal(await page.locator(".primary-amount").innerText(), "$ 15,000.00")
      if (scenario === "empty-limited") await emptyAmounts(page)
      await page.locator(".fiscal-insights > summary").click()
      await page.locator(".technical-result-details > summary").click()
      assert((await page.locator(".inverse-search-details").innerText()).includes(scenario === "time-limited" ? "presupuesto de tiempo" : "presupuesto de evaluaciones"))
    } else {
      await emptyAmounts(page)
      if (scenario === "unresolved") assert.equal(await page.locator("#minimum-month-ack").isChecked(), false)
      else assert.equal(await page.locator(".results-section").getAttribute("data-result-state"), "error")
    }
    checks.push(`entrada aislada con App/controlador reales: ${scenario}`)
  }

  for (const action of ["cancel-resolve", "cancel-reject", "clear", "mode-resolve", "mode-reject", "old-first", "new-first", "current-reject", "unmount"]) {
    await open(page, "deferred")
    assert.deepEqual(await page.evaluate(() => [window.__inverseVerification.state.mounts, window.__inverseVerification.state.disposals]), [2, 1])
    await fill(page, { amount: "00013202.64", premium: "25.00" })
    await calculate(page)
    const first = await currentTask(page)
    assert.equal(first, 0)
    await page.waitForFunction(() => window.__calculatingFrames >= 2)
    await emptyAmounts(page)
    if (action === "cancel-resolve") await page.screenshot({ path: join(tools, "3b3-calculating.png") })
    if (action.startsWith("cancel")) {
      await page.getByRole("button", { name: "Cancelar", exact: true }).focus(); await page.keyboard.press("Enter")
      await page.waitForFunction(() => document.activeElement?.id === "results-title")
      await assertAborted(page, first)
      if (action.endsWith("resolve")) await page.evaluate(index => window.__inverseVerification.resolve(index), first)
      else await page.evaluate(index => window.__inverseVerification.reject(index), first)
      assert.equal(await page.locator(".results-section").getAttribute("data-result-state"), "cancelled")
      await emptyAmounts(page)
      if (action === "cancel-resolve") await page.screenshot({ path: join(tools, "3b3-cancelled.png") })
      await edit(page)
      assert.equal(await page.locator("#salary").inputValue(), "00,013,202.64")
      assert.equal(await page.locator("#vacation-premium").inputValue(), "25.00")
    } else if (action === "clear") {
      await page.getByRole("button", { name: "Limpiar", exact: true }).click()
      await assertAborted(page, first)
      await page.evaluate(index => window.__inverseVerification.resolve(index), first)
      assert.equal(await page.locator("#salary").inputValue(), "")
      assert.equal(await page.locator("#state").getAttribute("data-salary-area"), "general-zone")
      assert.equal(await page.locator(".results-section").count(), 0)
    } else if (action.startsWith("mode")) {
      await edit(page); await assertAborted(page, first)
      await page.getByRole("button", { name: /Bruto a neto/ }).click()
      await page.locator("#salary").fill("15000.00"); await calculate(page)
      if (action.endsWith("resolve")) await page.evaluate(index => window.__inverseVerification.resolve(index), first)
      else await page.evaluate(index => window.__inverseVerification.reject(index), first)
      assert.equal(await page.locator(".results-section").getAttribute("data-result-state"), "estimated")
      assert.equal(await page.locator(".primary-amount").innerText(), "$ 13,202.64")
    } else if (action === "old-first" || action === "new-first") {
      await edit(page); await assertAborted(page, first)
      await page.locator("#salary").fill("13202.65"); await calculate(page)
      const second = await currentTask(page)
      assert.equal(second, 1)
      await page.evaluate(index => window.__inverseVerification.resolve(index), action === "old-first" ? first : second)
      if (action === "old-first") {
        assert.equal(await page.locator(".results-section").getAttribute("data-result-state"), "calculating")
        await emptyAmounts(page)
      } else {
        await done(page)
        assert.equal(await page.locator(".primary-amount").innerText(), "$ 15,000.01")
      }
      await page.evaluate(index => window.__inverseVerification.resolve(index), action === "old-first" ? second : first)
      await done(page)
      assert.equal(await page.locator(".primary-amount").innerText(), "$ 15,000.01")
      assert.equal(await page.locator('[data-inverse="target"]').innerText(), "$ 13,202.65")
    } else if (action === "current-reject") {
      await page.evaluate(index => window.__inverseVerification.reject(index), first)
      await done(page); await emptyAmounts(page)
      assert.equal(await page.locator(".results-section").getAttribute("data-result-state"), "error")
      await edit(page)
      assert.equal(await page.locator("#salary").inputValue(), "00,013,202.64")
    } else {
      await page.evaluate(() => window.__inverseVerification.unmount())
      await assertAborted(page, first)
      await page.evaluate(index => window.__inverseVerification.resolve(index), first)
      assert.equal(await page.locator(".results-section").count(), 0)
      assert.equal(await page.evaluate(() => window.__inverseVerification.state.disposals), 2)
    }
    checks.push(`concurrencia React / StrictMode: ${action}`)
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(external, [])
  console.log(JSON.stringify({ tool: "Edge headless / Playwright existente", nativeTauri: false, checks, metrics, screenshotsDirectory: tools, errors, external }, null, 2))
} finally {
  if (browser) await browser.close()
  server.kill()
}
