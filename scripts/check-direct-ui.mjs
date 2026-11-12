// Verificación interactiva con herramientas existentes; no instala dependencias.
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"

const root = fileURLToPath(new URL("../", import.meta.url))
const tools = process.env.PLAYWRIGHT_TOOLS_PATH ?? join(tmpdir(), "opencode", "calculadora-nomina-verification")
assert(existsSync(join(tools, "package.json")), "Indica PLAYWRIGHT_TOOLS_PATH con una instalación existente de Playwright; este script no instala paquetes.")
const { chromium } = createRequire(join(tools, "package.json"))("playwright")
const port = process.env.CALCULATOR_TEST_PORT ?? "1432"
const base = `http://127.0.0.1:${port}/`
let occupied = false
try { await fetch(base); occupied = true } catch { /* Puerto de prueba disponible. */ }
assert(!occupied, `El puerto ${port} ya está ocupado; no se reutiliza ni se detiene otro proceso.`)
const server = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", port, "--strictPort"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] })
let serverLog = ""
server.stdout.on("data", v => { serverLog += v.toString() })
server.stderr.on("data", v => { serverLog += v.toString() })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let browser
const checks = [], metrics = [], errors = [], external = []
const ids = ["salary", "period", "effective-date", "bonus-days", "vacation-days", "vacation-premium"]
async function snapshot(page) {
  return { values: await Promise.all(ids.map(id => page.locator(`#${id}`).inputValue())), area: await page.locator("#state").getAttribute("data-salary-area"), imss: await page.locator("#include-imss").isChecked(), mode: await page.getByRole("button", { name: /Bruto a neto/ }).getAttribute("aria-pressed") }
}
async function edit(page) {
  await page.getByRole("button", { name: "Editar datos", exact: true }).focus()
  await page.keyboard.press("Enter")
  await page.waitForFunction(() => document.activeElement?.id === "salary")
  assert.equal(await page.locator(".results-section").count(), 0)
}
async function fill(page, { amount = "15000.00", period = "monthly", imss = true, bonus = "15", vacation = "12", premium = "25", mode = "gross-to-net" } = {}) {
  await page.locator('input[name="fiscal-date-mode"][value="yes"]').check()
  await page.getByRole("button", { name: mode === "gross-to-net" ? /Bruto a neto/ : /Neto a bruto/ }).click()
   for (const [id, value] of [["salary", amount], ["period", period], ["effective-date", "2026-02-01"], ["bonus-days", bonus], ["vacation-days", vacation], ["vacation-premium", premium]]) {
    if (id === "period") await page.locator(`#${id}`).selectOption(value)
    else await page.locator(`#${id}`).fill(value)
  }
  await page.locator(`input[name="worker-imss"][value="${imss ? "yes" : "no"}"]`).check()
}
async function calculate(page) {
  await page.locator("#salary").press("Enter")
  await page.locator(".results-section").waitFor()
  await page.waitForFunction(() => document.activeElement?.id === "results-title")
}
async function checkResult(page, net, isr, imss) {
  assert.equal(await page.locator(".primary-amount").innerText(), net)
  assert.equal(await page.locator(".summary-isr p").innerText(), isr)
  assert.equal(await page.locator(".summary-imss p").innerText(), imss)
  assert.equal(await page.locator(".results-section").getAttribute("data-result-state"), "estimated")
  assert.equal(await page.locator(".minimum-confirmation").count(), 0)
  assert.equal(await page.getByRole("button", { name: "Guardar", exact: true }).count(), 0)
  assert.equal(await page.getByRole("button", { name: "Exportar PDF", exact: true }).isDisabled(), true)
  assert.equal(await page.locator(".fiscal-insights").getAttribute("open"), null)
}
try {
  let ready = false
  for (let i = 0; i < 250; i++) {
    if (server.exitCode !== null) throw new Error(serverLog)
    try { const r = await fetch(base); if (r.ok) { ready = true; break } } catch { /* Esperar arranque. */ }
    await sleep(100)
  }
  assert(ready, serverLog)
  browser = await chromium.launch({ channel: "msedge", headless: true })
  const page = await browser.newPage({ viewport: { width: 1180, height: 760 } })
  await page.addInitScript(() => {
    const Original = window.AbortController
    window.__abortConstructions = 0
    window.AbortController = class extends Original { constructor() { super(); window.__abortConstructions++ } }
    const originalClone = window.structuredClone
    window.__captureClones = 0
    window.structuredClone = function(value, ...options) {
      if (value && typeof value === "object" && value.form && "area" in value) window.__captureClones++
      return originalClone.call(window, value, ...options)
    }
  })
  page.on("pageerror", e => errors.push(e.message))
  page.on("request", r => { if (!r.url().startsWith(base) && !r.url().startsWith("data:")) external.push(r.url()) })
  await page.goto(base, { waitUntil: "networkidle" })
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled)
  assert.equal(await page.locator(".results-section").count(), 0)
   assert.equal(await page.locator("#state").getAttribute("data-salary-area"), "general-zone")
   assert.equal(await page.locator("select#state, #worker-type, .switch-preview, .advanced-panel").count(), 0)
  await page.screenshot({ path: join(tools, "3b2-capture-1180.png") })
   checks.push("arranque, plantilla editable y zona general fija visible; controles sin soporte retirados")

  await page.getByRole("button", { name: /Bruto a neto/ }).click()
  await page.locator('button[type="submit"]').click()
    assert.equal(await page.locator(".field-error").count(), 2)
  await page.waitForFunction(() => document.activeElement?.id === "salary")
  assert.equal(await page.evaluate(() => document.activeElement.id), "salary")
  await fill(page, { bonus: "", vacation: "", premium: "" })
  await page.locator('button[type="submit"]').click()
  assert.equal(await page.locator(".field-error").count(), 3)
  assert.equal(await page.locator(".results-section").count(), 0)
  await fill(page, { bonus: "-1", premium: "25%" })
  await page.locator('button[type="submit"]').click()
  assert.equal(await page.locator(".field-error").count(), 2)
   assert.equal(await page.locator("#state").getAttribute("data-salary-area"), "general-zone")
   checks.push("G/H actualizado: prestaciones borradas/invalidas mantienen errores; perfil general visible")

  await fill(page, { amount: "00015000.00", bonus: "15.00", vacation: "12.0", premium: "25.00" })
  const saved = await snapshot(page)
  const beforeClones = await page.evaluate(() => window.__captureClones)
  await page.locator(".capture-section").evaluate(form => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  })
  await page.waitForFunction(() => document.activeElement?.id === "results-title")
  assert.equal(await page.evaluate(() => window.__captureClones), beforeClones + 1)
  await checkResult(page, "$ 13,202.64", "$ 1,402.82", "$ 394.54")
  assert((await page.locator(".detail-grid").innerText()).includes("$ 15,000.00"))
  assert((await page.locator(".detail-grid").innerText()).includes("1.0493"))
  assert((await page.locator(".detail-grid").innerText()).includes("SBC estimado (no registrado)"))
  assert.equal(await page.locator('[data-subsidy="determined"]').textContent(), "$ 0.00")
  assert.equal(await page.locator('[data-subsidy="applied"]').innerText(), "$ 0.00")
  const normal = await page.evaluate(() => ({ viewport: [innerWidth, innerHeight], document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight], details: [...document.querySelectorAll(".detail-panel")].map(e => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom } }) }))
  metrics.push(normal)
  assert(normal.document[0] <= 1180, "Desbordamiento horizontal en resultados ordinarios")
  assert(normal.document[1] <= 761, `Resultados ordinarios fuera de 1180x760: ${JSON.stringify(normal)}`)
  assert(normal.details.every(d => d.bottom <= 760), "Desglose fuera del viewport")
  await page.screenshot({ path: join(tools, "3b2-results-1180.png") })
  await edit(page)
  assert.deepEqual(await snapshot(page), saved)
  checks.push("A/I: motor real, doble envío protegido, edición exacta y foco por teclado")

  await fill(page, { imss: false }); await calculate(page)
  await checkResult(page, "$ 13,597.18", "$ 1,402.82", "$ 0.00")
  await edit(page)
  checks.push("B: IMSS excluido es 0.00 determinado")
  await fill(page, { amount: "3500.00", period: "weekly" }); await calculate(page)
  await checkResult(page, "$ 3,076.67", "$ 331.27", "$ 92.06")
  await edit(page)
  checks.push("C: semanal real")
  await fill(page, { amount: "7500.00", period: "fortnightly" }); await calculate(page)
  await checkResult(page, "$ 6,592.87", "$ 709.86", "$ 197.27")
  await edit(page)
  checks.push("D: quincenal real")

  await fill(page, { amount: "9451.20" }); await calculate(page)
  assert.equal(await page.locator(".primary-amount").innerText(), "$ —")
  assert.equal(await page.locator(".summary-isr p").innerText(), "$ —")
  assert.equal(await page.locator(".summary-imss p").innerText(), "$ 0.00")
  assert.equal(await page.locator("#minimum-month-ack").isChecked(), false)
  assert.equal(await page.getByRole("button", { name: "Recalcular con hipótesis" }).isDisabled(), true)
  assert.equal(await page.locator('[data-subsidy="determined"]').textContent(), "$ 535.65")
  assert.equal(await page.locator('[data-subsidy="applied"]').innerText(), "—")
  await page.screenshot({ path: join(tools, "3b2-minimum-pending.png") })
  await page.locator("#minimum-month-ack").focus(); await page.keyboard.press("Space")
  assert.equal(await page.locator(".primary-amount").innerText(), "$ —")
  await page.getByRole("button", { name: "Recalcular con hipótesis" }).focus(); await page.keyboard.press("Enter")
  await page.waitForFunction(() => document.activeElement?.id === "results-title")
  await checkResult(page, "$ 9,451.20", "$ 0.00", "$ 0.00")
  assert.equal(await page.locator('[data-subsidy="determined"]').textContent(), "$ 535.65")
  assert.equal(await page.locator('[data-subsidy="applied"]').innerText(), "$ 0.00")
  await page.screenshot({ path: join(tools, "3b2-minimum-confirmed.png") })
  await edit(page)
  await page.locator("#bonus-days").fill("16"); await calculate(page)
  assert.equal(await page.locator(".primary-amount").innerText(), "$ —")
  assert.equal(await page.locator("#minimum-month-ack").isChecked(), false)
  await edit(page)
  checks.push("E/K/L: hipótesis explícita por teclado, subsidio det./aplicado, null/0.00 e invalidación")

  await fill(page, { amount: "9451.19", imss: false }); await calculate(page)
  assert.equal(await page.locator(".results-section").getAttribute("data-result-state"), "blocked")
  assert((await page.locator("#result-message").innerText()).includes("inferior al mínimo"))
  assert.equal(await page.locator(".primary-amount").innerText(), "$ —")
  assert.equal(await page.locator(".summary-imss p").innerText(), "$ —")
  assert.equal(await page.locator(".minimum-confirmation").count(), 0)
  await edit(page)
  checks.push("F: bajo mínimo bloqueado incluso con descuento IMSS desactivado")

   await fill(page, { mode: "net-to-gross", amount: "6592.87", period: "fortnightly" })
  const beforeAbort = await page.evaluate(() => window.__abortConstructions)
  await calculate(page)
   await page.waitForFunction(() => document.querySelector(".results-section")?.getAttribute("aria-busy") === "false")
   assert.equal(await page.locator(".primary-amount").innerText(), "$ 7,500.00")
   assert.equal(await page.locator('[data-inverse="obtained"]').innerText(), "$ 6,592.87")
   assert.equal(await page.evaluate(() => window.__abortConstructions), beforeAbort + 1)
  await edit(page)
   checks.push("J actualizado 3B.3: cambio de modo descarta directo y ejecuta solo el inverso")

  await fill(page, { bonus: "0", vacation: "0", premium: "0" }); await calculate(page)
  await page.locator(".fiscal-insights > summary").click()
  assert((await page.locator(".fiscal-insights").innerText()).includes("aguinaldo"))
  await edit(page)
  checks.push("prestaciones explícitas inferiores conservan advertencias")

  await fill(page, { amount: "99999999999999999999.99" }); await calculate(page)
  assert.equal(await page.locator(".results-section").getAttribute("data-result-state"), "estimated")
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Importe grande desborda horizontalmente")
  await edit(page)
  assert.equal(await page.locator("#salary").inputValue(), "99,999,999,999,999,999,999.99")
  checks.push("importe grande exacto sin conversión binaria ni recorte horizontal")

  await page.setViewportSize({ width: 900, height: 600 })
  await fill(page); await calculate(page)
  const small = await page.evaluate(() => ({ viewport: [innerWidth, innerHeight], document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight], panels: [...document.querySelectorAll(".detail-panel")].map(e => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom } }) }))
  metrics.push(small)
  assert(small.document[0] <= 900, "Scroll horizontal en ventana mínima")
  await page.locator(".fiscal-insights").scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(tools, "3b2-results-900.png"), fullPage: true })
  checks.push("1180x760 sin scroll ordinario y 900x600 con desplazamiento natural")
  await edit(page)
  await page.getByRole("button", { name: "Limpiar", exact: true }).click()
   assert.equal(await page.locator("#state").getAttribute("data-salary-area"), "general-zone")
  assert.equal(await page.locator("#salary").inputValue(), "")
   assert.equal(await page.locator("#bonus-days").inputValue(), "15")
  assert.equal(await page.locator(".results-section").count(), 0)
  assert.deepEqual(errors, [])
  assert.deepEqual(external, [])
  console.log(JSON.stringify({ tool: "Edge headless / Playwright existente", nativeTauri: false, checks, metrics, screenshotsDirectory: tools, errors, external }, null, 2))
} finally {
  if (browser) await browser.close()
  server.kill()
}
