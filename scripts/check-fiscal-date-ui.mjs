// Reloj de calendario simulado; temporizadores y performance del motor reales.
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync, spawn } from "node:child_process"

const root = fileURLToPath(new URL("../", import.meta.url))
const tools = process.env.PLAYWRIGHT_TOOLS_PATH ?? join(tmpdir(), "opencode", "calculadora-nomina-verification")
const { chromium } = createRequire(join(tools, "package.json"))("playwright")
const isNative = process.argv.includes("--native")
const checkMoney = process.argv.includes("--5b3")
const checkCapture = checkMoney || process.argv.includes("--5b2")
const mode = isNative ? "native" : "edge"
const port = isNative ? 1420 : 1432
const base = `http://127.0.0.1:${port}/`
const out = join(root, "docs", "evidence", checkMoney ? "5b3" : checkCapture ? "5b2" : "5b1")
mkdirSync(out, { recursive: true })
const report = { mode, nativeTauri: isNative, checks: [], metrics: [], errors: [], consoleErrors: [], failures: [] }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let occupied = false
try { await fetch(base); occupied = true } catch { /* Disponible. */ }
assert(!occupied, `Puerto ${port} ocupado: no se reutiliza un servidor ajeno`)
if (isNative) {
  const count = execFileSync("pwsh", ["-NoProfile", "-Command", "@(Get-Process -Name 'calculadora-nomina' -ErrorAction SilentlyContinue).Count"], { encoding: "utf8" }).trim()
  assert.equal(count, "0", "No se toca una ventana personal abierta")
  let cdpOccupied = false
  try { await fetch("http://127.0.0.1:9225/json/version"); cdpOccupied = true } catch { /* Disponible. */ }
  assert(!cdpOccupied)
}
const server = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] })
let log = "", app, browser, page, nativePid = 0
server.stdout.on("data", b => { log += b.toString() })
server.stderr.on("data", b => { log += b.toString() })
function native(action, more = []) {
  return JSON.parse(execFileSync("pwsh", ["-NoProfile", "-File", join(root, "scripts", "native-window.ps1"), "-Action", action, ...(nativePid ? ["-ProcessId", String(nativePid)] : []), ...more], { encoding: "utf8", timeout: 30000 }))
}
function simulatedClock() {
  const OriginalDate = Date
  window.__dateEpoch = new OriginalDate(2026, 0, 31, 12, 0, 0).getTime()
  window.__setCivilClock = (year, month, day, hour = 12, minute = 0) => { window.__dateEpoch = new OriginalDate(year, month - 1, day, hour, minute, 0).getTime() }
  window.Date = class extends OriginalDate {
    constructor(...args) { if (args.length) super(...args); else super(window.__dateEpoch) }
    static now() { return window.__dateEpoch }
  }
  const clone = window.structuredClone
  window.__capturePackets = []
  window.structuredClone = function(value, ...options) {
    if (value && typeof value === "object" && value.form && "area" in value) window.__capturePackets.push(clone.call(window, value))
    return clone.call(window, value, ...options)
  }
}
async function fill({ amount = "15000.00", period = "monthly", direction = "gross-to-net" } = {}) {
  await page.getByRole("button", { name: direction === "gross-to-net" ? /Bruto a neto/ : /Neto a bruto/ }).click()
  for (const [id, value] of [["salary", amount], ["period", period], ["bonus-days", "15"], ["vacation-days", "12"], ["vacation-premium", "25"]]) {
    if (id === "period") await page.locator(`#${id}`).selectOption(value)
    else await page.locator(`#${id}`).fill(value)
  }
}
const yes = () => page.locator('input[name="fiscal-date-mode"][value="yes"]')
const no = () => page.locator('input[name="fiscal-date-mode"][value="no"]')
async function manual(date) { await yes().check(); await page.locator('input#effective-date').fill(date) }
async function calculate() {
  await page.locator("#salary").press("Enter")
  await page.locator(".results-section").waitFor()
  await page.waitForFunction(() => document.querySelector(".results-section")?.getAttribute("aria-busy") === "false")
  await page.waitForFunction(() => document.activeElement?.id === "results-title")
}
async function edit() {
  await page.getByRole("button", { name: "Editar datos", exact: true }).click()
  await page.waitForFunction(() => document.activeElement?.id === "salary")
  assert.equal(await page.locator(".results-section").count(), 0)
}
async function screenshot(name) {
  if (isNative) native("capture", ["-OutputPath", join(out, `${mode}-${name}.png`)])
  else await page.screenshot({ path: join(out, `${mode}-${name}.png`), fullPage: true })
}
async function measure(name) {
  await page.evaluate(() => scrollTo(0, 0))
  const metrics = await page.evaluate(name => ({ name, viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, panels: [...document.querySelectorAll(".detail-panel")].map(e => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom } }) }), name)
  assert(metrics.scrollWidth <= metrics.clientWidth, "Desbordamiento horizontal")
  if (metrics.viewport[0] === 1180) {
    assert(metrics.scrollHeight <= metrics.clientHeight, `Exceso de alto: ${JSON.stringify(metrics)}`)
    assert(metrics.panels.every(p => p.bottom <= metrics.clientHeight))
  }
  report.metrics.push(metrics)
}
try {
  let ready = false
  for (let i = 0; i < 200; i++) {
    if (server.exitCode !== null) throw new Error(log)
    try { if ((await fetch(base)).ok) { ready = true; break } } catch { /* Arranque. */ }
    await sleep(100)
  }
  assert(ready)
  if (isNative) {
    app = spawn(join(root, "src-tauri", "target", "debug", "calculadora-nomina.exe"), [], { cwd: root, env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9225 --remote-debugging-address=127.0.0.1", WEBVIEW2_USER_DATA_FOLDER: join(tools, `3b4-profile-5b1-${Date.now()}`) }, stdio: "ignore" })
    for (let i = 0; i < 120; i++) {
      try { browser = await chromium.connectOverCDP("http://127.0.0.1:9225"); break } catch { await sleep(250) }
    }
    assert(browser)
    for (let i = 0; i < 100; i++) {
      page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith(base))
      if (page) break
      await sleep(100)
    }
    assert(page, "No se encontró el frontend de desarrollo en WebView2")
    const initial = native("inspect")
    nativePid = initial.pid
    report.nativeWindow = initial
    assert.deepEqual(initial.clientLogical, [1180, 760])
  } else {
    browser = await chromium.launch({ channel: "msedge", headless: true })
    page = await browser.newPage({ viewport: { width: 1180, height: 760 }, timezoneId: "America/Mexico_City" })
  }
  page.on("pageerror", e => report.errors.push(e.message))
  page.on("console", e => { if (e.type() === "error") report.consoleErrors.push(e.text()) })
  await page.addInitScript(simulatedClock)
  await page.goto(base, { waitUntil: "networkidle" })
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled)
  if (isNative) assert(await page.evaluate(() => typeof window.__TAURI_INTERNALS__ === "object"))
  assert.equal(await page.locator("output#effective-date").getAttribute("data-reference-date"), "2026-01-31")
  assert.equal(await no().isChecked(), true)
  assert.equal(await page.locator('input[type="date"]').count(), 0)
  await expectTemplate()
  const help = page.getByRole("button", { name: "Ayuda sobre Fecha de referencia fiscal" })
  await help.focus(); await page.keyboard.press("Enter")
  assert((await page.locator("#fiscal-date-help").innerText()).includes("No necesariamente coincide con el día de pago"))
  await page.keyboard.press("Escape")
  assert.equal(await help.getAttribute("aria-expanded"), "false")
  await measure("captura automática")
  await screenshot("capture-auto")
  report.checks.push("fecha local automática; plantilla visible y zona general; ayuda Enter/Escape")
  if (checkCapture) {
    await simplifiedCaptureChecks()
    await page.goto(base, { waitUntil: "networkidle" })
    await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled)
  }

  await fill({ amount: "10000.00" }); await calculate()
  assert.equal(await page.locator(".primary-amount").innerText(), "$ 9,556.74")
  const originalTiming = await page.locator(".capture-summary-timing").innerText()
  assert.equal(await page.locator(".capture-summary-timing").getAttribute("data-package-id"), "mx-fiscal-2026-source-v3")
  await page.evaluate(() => window.__setCivilClock(2026, 2, 1))
  assert.equal(await page.locator(".capture-summary-timing").innerText(), originalTiming)
  await edit()
  assert.equal(await no().isChecked(), true)
  assert.equal(await page.locator("output#effective-date").getAttribute("data-reference-date"), "2026-01-31")
  await calculate()
  assert.equal(await page.locator(".primary-amount").innerText(), "$ 9,556.74")
  assert((await page.locator(".capture-summary-timing").innerText()).includes("2026-02-01"))
  report.checks.push("enero automático; resultado inmutable; editar conserva fecha/modo; realización separada")

  await edit(); await manual("2026-02-01"); await calculate()
  assert.equal(await page.locator(".primary-amount").innerText(), "$ 9,557.42")
  assert.equal(await page.locator(".capture-summary-timing").getAttribute("data-date-mode"), "manual")
  await edit(); assert.equal(await page.locator('input#effective-date').inputValue(), "2026-02-01")
  await page.evaluate(() => window.__setCivilClock(2026, 10, 16))
  await no().check()
  assert.equal(await page.locator("output#effective-date").getAttribute("data-reference-date"), "2026-10-16")
  await fill(); await calculate()
  assert.equal(await page.locator(".primary-amount").innerText(), "$ 13,202.64")
  await measure("directo ordinario")
  await screenshot("results-direct")
  report.checks.push("manual enero/febrero cambia parámetros; No resuelve hoy; directo real sin regresión")

  await edit(); await manual("2026-02-01")
  await fill({ direction: "net-to-gross", amount: "6592.87", period: "fortnightly" })
  assert.equal(await yes().isChecked(), true)
  assert.equal(await page.locator('input#effective-date').inputValue(), "2026-02-01")
  await calculate()
  assert.equal(await page.locator(".primary-amount").innerText(), "$ 7,500.00")
  await measure("inverso ordinario")
  await screenshot("results-inverse")
  if (isNative) native("resize", ["-Width", "900", "-Height", "600"])
  else await page.setViewportSize({ width: 900, height: 600 })
  await page.waitForFunction(() => innerWidth === 900)
  await measure("inverso ventana mínima")
  await screenshot("results-900")
  if (checkCapture) {
    await edit()
    await measure("captura simplificada ventana mínima")
    await screenshot("capture-900")
    await page.locator('button[type="submit"]').scrollIntoViewIfNeeded()
    const button = await page.locator('button[type="submit"]').boundingBox()
    assert(button.y >= 0 && button.y + button.height <= 601)
  }
  if (isNative) native("resize", ["-Width", "1180", "-Height", "760"])
  else await page.setViewportSize({ width: 1180, height: 760 })
  if (checkCapture) await calculate()
  report.checks.push("cambio de sentido conserva fecha/modo; inverso real y captura accesible en ambas ventanas")

  await edit(); await fill({ amount: "9451.20" }); await manual("2026-01-31"); await calculate()
  assert.equal(await page.locator("#minimum-month-ack").isChecked(), false)
  await page.locator("#minimum-month-ack").check()
  await page.getByRole("button", { name: "Recalcular con hipótesis" }).click()
  assert.equal(await page.locator(".primary-amount").innerText(), "$ 9,451.20")
  await edit(); await manual("2026-02-01"); await calculate()
  assert.equal(await page.locator("#minimum-month-ack").isChecked(), false)
  assert.equal(await page.locator(".primary-amount").innerText(), "$ —")
  assert((await page.locator(".minimum-confirmation").innerText()).includes("2026-02"))
  report.checks.push("cambio de fecha invalida hipótesis previa y solicita mes vigente sin marcar")

  await page.evaluate(() => window.__setCivilClock(2026, 12, 31, 23, 59))
  await page.getByRole("button", { name: "Limpiar", exact: true }).click()
  assert.equal(await no().isChecked(), true)
  assert.equal(await page.locator("output#effective-date").getAttribute("data-reference-date"), "2026-12-31")
  await fill()
  await page.evaluate(() => window.__setCivilClock(2027, 1, 1, 0, 1))
  await page.locator("#salary").press("Enter")
  await page.locator(".date-refresh").waitFor()
  assert.equal(await page.locator(".results-section").count(), 0)
  assert.equal(await page.locator('button[type="submit"]').isDisabled(), true)
  await page.getByRole("button", { name: "Usar fecha de hoy" }).click()
  assert.equal(await page.locator("output#effective-date").getAttribute("data-reference-date"), "2027-01-01")
  assert((await page.locator("#effective-date-error").innerText()).includes("No hay parámetros compatibles"))
  await screenshot("no-coverage")
  await yes().check()
  assert.equal(await page.locator('input#effective-date').inputValue(), "")
  await page.locator('button[type="submit"]').click()
  await page.waitForFunction(() => document.activeElement?.id === "effective-date")
  assert.equal(await page.locator('input#effective-date').getAttribute("aria-invalid"), "true")
  await page.locator('input#effective-date').fill("2026-02-01")
  await calculate()
  assert.equal(await page.locator(".primary-amount").innerText(), "$ 13,202.64")
  await page.getByRole("button", { name: "Limpiar", exact: true }).click()
  assert.equal(await page.locator("output#effective-date").getAttribute("data-reference-date"), "2027-01-01")
  assert.equal(await no().isChecked(), true)
  assert.equal(await page.locator('button[type="submit"]').isDisabled(), true)
  report.checks.push("medianoche 2026→2027: bloqueo, actualización explícita, sin fallback; manual válida y nuevo inicio real")

  await page.goto(`${base}dev/inverse.html?case=deferred`, { waitUntil: "networkidle" })
  await fill({ direction: "net-to-gross", amount: "13202.64" })
  await page.locator("#salary").press("Enter")
  await page.getByRole("button", { name: "Editar datos", exact: true }).waitFor()
  await edit(); await manual("2026-02-01"); await fill(); await calculate()
  await page.evaluate(() => window.__inverseVerification.resolve(0))
  assert.equal(await page.locator(".primary-amount").innerText(), "$ 13,202.64")
  assert.equal(await page.locator(".capture-summary-timing").getAttribute("data-date-mode"), "manual")
  assert((await page.locator(".capture-summary-values").innerText()).includes("1 de febrero de 2026"))
  report.checks.push("fecha modificada aborta petición previa; respuesta de enero tardía no cambia resultado/fecha de febrero")
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.consoleErrors, [])
  if (isNative) { native("close"); report.closedByWindowMessage = true }
} catch (error) {
  report.failures.push(error.stack ?? String(error)); process.exitCode = 1
} finally {
  if (browser) await browser.close().catch(() => {})
  if (app?.exitCode === null) { try { execFileSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "pipe" }) } catch { /* Ya finalizó. */ } }
  server.kill()
  writeFileSync(join(out, `${mode}-date-ui.json`), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}

async function expectTemplate() {
  for (const [id, value] of [["bonus-days", "15"], ["vacation-days", "12"], ["vacation-premium", "25"]]) assert.equal(await page.locator(`#${id}`).inputValue(), value)
  assert.equal(await page.locator('#state').getAttribute('data-salary-area'), "general-zone")
  assert.equal(await page.locator('#include-imss').isChecked(), true)
}
async function workerImss(value) { await page.locator(`input[name="worker-imss"][value="${value ? "yes" : "no"}"]`).check() }
async function simplifiedCaptureChecks() {
  report.fiscal = []
  assert.equal(await page.locator(".advanced-panel, #worker-type, .switch-preview, select#state").count(), 0)
  assert((await page.locator("#state").innerText()).includes("Zona salarial: General"))
  assert((await page.locator("#salary-area-note").innerText()).includes("únicamente"))
  assert((await page.locator("#vacation-days-hint").innerText()).includes("antigüedad"))
  assert((await page.locator("#worker-imss-note").innerText()).includes("no representa una exención legal"))
  await page.getByRole("button", { name: /Bruto a neto/ }).click()
  await page.locator("#salary").fill("15000.00")
  await page.locator("#period").selectOption("monthly")
  await manual("2026-02-01")
  await screenshot("simplified-capture")
  for (const [id, restore] of [["bonus-days", "15"], ["vacation-days", "12"], ["vacation-premium", "25"]]) {
    await page.locator(`#${id}`).fill("")
    await page.evaluate(() => { window.__capturePackets = [] })
    await page.locator('button[type="submit"]').click()
    assert.equal(await page.locator(".results-section").count(), 0)
    assert.equal(await page.locator(`#${id}`).inputValue(), "")
    assert.equal(await page.locator(`#${id}`).getAttribute("aria-invalid"), "true")
    assert.equal(await page.evaluate(() => window.__capturePackets.length), 0)
    await page.locator(`#${id}`).fill(restore)
  }
  report.checks.push("5B.2: perfil visible, controles retirados, tres prestaciones borradas bloquean sin default oculto")
  await page.evaluate(() => { window.__capturePackets = [] })
  await calculate()
  assert.equal(await page.locator(".primary-amount").innerText(), "$ 13,202.64")
  const packet = await page.evaluate(() => window.__capturePackets[0])
  assert.equal(packet.area, "general-zone")
  assert.deepEqual([packet.form.bonusDays, packet.form.vacationDays, packet.form.vacationPremium, packet.form.includeImss], ["15", "12", "25", true])
  report.fiscal.push({ case: "mensual con IMSS", expected: "$ 13,202.64", obtained: await page.locator(".primary-amount").innerText(), explicitCapture: packet })
  report.checks.push("5B.2: plantilla transmitida explícitamente por adaptador; bruto15000 neto13202.64")
  await edit()
  const custom = [["salary", "00015000.50"], ["bonus-days", "18.50"], ["vacation-days", "20.25"], ["vacation-premium", "30.50"]]
  for (const [id, value] of custom) await page.locator(`#${id}`).fill(value)
  await workerImss(false)
  await page.evaluate(() => { window.__capturePackets = [] })
  await calculate()
  assert.equal(await page.locator(".summary-imss p").innerText(), "$ 0.00")
  assert.equal(await page.evaluate(() => window.__capturePackets[0].form.includeImss), false)
  await edit()
  for (const [id, value] of custom) assert.equal(await page.locator(`#${id}`).inputValue(), id === "salary" ? "00,015,000.50" : value)
  assert.equal(await page.locator('input#effective-date').inputValue(), "2026-02-01")
  assert.equal(await yes().isChecked(), true)
  assert.equal(await page.locator('#exclude-imss').isChecked(), true)
  assert.equal(await page.locator(".results-section").count(), 0)
  await page.evaluate(() => window.__setCivilClock(2026, 10, 16))
  await page.getByRole("button", { name: "Limpiar", exact: true }).click()
  await expectTemplate()
  assert.equal(await page.locator('#salary').inputValue(), "")
  assert.equal(await no().isChecked(), true)
  assert.equal(await page.locator('output#effective-date').getAttribute('data-reference-date'), "2026-10-16")
  report.checks.push("5B.2: editar conserva textos/fecha/manual/IMSS; Limpiar restaura15/12/25, Sí y hoy automático")
  for (const c of [
    { name: "mensual sin IMSS", amount: "15000.00", period: "monthly", imss: false, direction: "gross-to-net", expected: "$ 13,597.18" },
    { name: "semanal", amount: "3500.00", period: "weekly", imss: true, direction: "gross-to-net", expected: "$ 3,076.67" },
    { name: "inverso mensual", amount: "13202.64", period: "monthly", imss: true, direction: "net-to-gross", expected: "$ 15,000.00" },
  ]) {
    if (await page.locator('.results-section').count()) await edit()
    await fill(c); await manual("2026-02-01"); await workerImss(c.imss)
    await calculate()
    const obtained = await page.locator('.primary-amount').innerText()
    assert.equal(obtained, c.expected)
    report.fiscal.push({ case: c.name, expected: c.expected, obtained })
  }
  report.checks.push("5B.2: regresiones reales sin IMSS, semanal e inverso mensual")
  await edit()
  await page.locator('#include-imss').focus(); await page.keyboard.press("ArrowRight")
  assert.equal(await page.locator('#exclude-imss').isChecked(), true)
  await page.keyboard.press("ArrowLeft")
  assert.equal(await page.locator('#include-imss').isChecked(), true)
  await fill({ amount: "9451.20" }); await manual("2026-02-01"); await calculate()
  await page.locator('#minimum-month-ack').check()
  await page.getByRole('button', { name: 'Recalcular con hipótesis' }).click()
  assert.equal(await page.locator('.primary-amount').innerText(), "$ 9,451.20")
  await page.getByRole('button', { name: 'Limpiar', exact: true }).click()
  await expectTemplate()
  await fill({ amount: "9451.20" }); await manual("2026-02-01"); await calculate()
  assert.equal(await page.locator('#minimum-month-ack').isChecked(), false)
  assert.equal(await page.locator('.primary-amount').innerText(), "$ —")
  report.checks.push("5B.2: IMSS por flechas y nueva simulación invalida confirmación del mínimo")
  await page.goto(`${base}dev/inverse.html?case=deferred`, { waitUntil: "networkidle" })
  await fill({ direction: "net-to-gross", amount: "13202.64" }); await manual("2026-02-01")
  await page.locator('#salary').press('Enter')
  await page.getByRole('button', { name: 'Editar datos', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Limpiar', exact: true }).click()
  await page.evaluate(() => window.__inverseVerification.resolve(0))
  await expectTemplate()
  assert.equal(await page.locator('#salary').inputValue(), "")
  assert.equal(await no().isChecked(), true)
  assert.equal(await page.locator('.results-section').count(), 0)
  report.checks.push("5B.2: Limpiar inverso pendiente restaura plantilla y descarta respuesta obsoleta")
}
