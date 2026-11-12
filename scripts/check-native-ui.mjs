// Automatiza la ventana Windows Tauri y SU WebView2 por CDP. No lanza Edge.
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { spawn, execFileSync } from "node:child_process"

const root = fileURLToPath(new URL("../", import.meta.url))
const tools = process.env.PLAYWRIGHT_TOOLS_PATH ?? join(tmpdir(), "opencode", "calculadora-nomina-verification")
assert(existsSync(join(tools, "package.json")), "Se requiere Playwright existente; no se instalan paquetes.")
const { chromium } = createRequire(join(tools, "package.json"))("playwright")
const built = process.argv.includes("--built")
const smoke = process.argv.includes("--smoke")
const mode = built ? "built" : "dev"
const evidence = join(root, "docs", "evidence", "3b4")
mkdirSync(evidence, { recursive: true })
const profile = join(tools, `3b4-profile-${Date.now()}`)
const endpoint = "http://127.0.0.1:9225"
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const report = { mode, nativeTauri: true, started: new Date().toISOString(), checks: [], fiscal: [], extraFiscal: [], metrics: [], timings: [], errors: [], consoleErrors: [], httpErrors: [], external: [], failures: [], native: [], lifecycle: {} }
function hash(path) { return createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase() }
function protectedFiles(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? protectedFiles(join(folder, entry.name)) : /\.(ts|json)$/.test(entry.name) && !entry.name.includes(".test.") ? [join(folder, entry.name)] : [])
}
const protectedPaths = [join(root, "design", "UI_APROBADA.png"), ...protectedFiles(join(root, "src", "domain", "payroll")), ...protectedFiles(join(root, "src", "infrastructure", "fiscal"))]
report.hashesBefore = Object.fromEntries(protectedPaths.map(path => [relative(root, path).replaceAll("\\", "/"), hash(path)]))
function native(action = "inspect", extra = []) {
  return JSON.parse(execFileSync("pwsh", ["-NoProfile", "-File", join(root, "scripts", "native-window.ps1"), "-Action", action, ...extra], { encoding: "utf8", timeout: 30000 }))
}
async function capture(name) {
  const result = native("capture", ["-OutputPath", join(evidence, `${mode}-${name}.png`)])
  report.native.push({ phase: name, ...result })
}
for (const port of built ? [9225] : [1420, 9225]) {
  let occupied = false
  try { await fetch(`http://127.0.0.1:${port}`); occupied = true } catch { /* Puerto disponible. */ }
  assert(!occupied, `Puerto ${port} ocupado; no se reutilizan procesos ajenos.`)
}
const previous = execFileSync("pwsh", ["-NoProfile", "-Command", "@(Get-Process -Name 'calculadora-nomina' -ErrorAction SilentlyContinue).Count"], { encoding: "utf8" }).trim()
assert.equal(previous, "0", "Hay una ventana de nómina previa; no se toca una instancia ajena.")
const args = built ? [] : ["/d", "/s", "/c", "npm run tauri -- dev --no-watch"]
const program = built ? join(root, "src-tauri", "target", "debug", "calculadora-nomina.exe") : process.env.ComSpec ?? "cmd.exe"
const app = spawn(program, args, { cwd: root, env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9225 --remote-debugging-address=127.0.0.1", WEBVIEW2_USER_DATA_FOLDER: profile }, stdio: ["ignore", "pipe", "pipe"] })
let log = "", browser, page
const pendingRequests = new Set()
app.stdout.on("data", v => { log += v.toString() })
app.stderr.on("data", v => { log += v.toString() })
try {
  let ready = false
  for (let i = 0; i < 900; i++) {
    if (app.exitCode !== null) throw new Error(`Tauri terminó antes de abrir: ${log}`)
    try { if ((await fetch(`${endpoint}/json/version`)).ok) { ready = true; break } } catch { /* Compilación y apertura nativa. */ }
    await delay(500)
  }
  assert(ready, `No se abrió WebView2 nativo: ${log}`)
  report.cdpVersion = await (await fetch(`${endpoint}/json/version`)).json()
  browser = await chromium.connectOverCDP(endpoint)
  for (let i = 0; i < 100; i++) {
    page = browser.contexts().flatMap(context => context.pages()).find(p => built ? p.url().includes("tauri.localhost") : p.url().startsWith("http://127.0.0.1:1420"))
    if (page) break
    await delay(100)
  }
  assert(page, "No se identificó la página del WebView2 embebido.")
  await page.addInitScript(installProbe)
  report.url = page.url()
  page.on("pageerror", e => report.errors.push(e.message))
  page.on("console", e => { if (e.type() === "error") report.consoleErrors.push({ text: e.text(), location: e.location() }) })
  page.on("response", response => { if (response.status() >= 400) report.httpErrors.push({ url: response.url(), status: response.status() }) })
  page.on("request", r => { pendingRequests.add(r); if (!/^(?:https?:\/\/(?:127\.0\.0\.1|tauri\.localhost|ipc\.localhost)(?::\d+)?\/|data:|ipc:)/.test(r.url())) report.external.push({ url: r.url(), method: r.method() }) })
  page.on("requestfinished", r => pendingRequests.delete(r))
  page.on("requestfailed", r => pendingRequests.delete(r))
  page.on("websocket", ws => { if (!/^wss?:\/\/127\.0\.0\.1(?::\d+)?\//.test(ws.url())) report.external.push({ url: ws.url(), type: "websocket" }) })
  await page.reload({ waitUntil: "networkidle" })
  await page.locator("#salary").waitFor()
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled)
  const initial = native()
  report.executableSha256 = hash(initial.executable)
  report.assets = Object.fromEntries(readdirSync(join(root, "dist", "assets")).filter(name => /\.(js|css)$/.test(name)).map(name => [name, hash(join(root, "dist", "assets", name))]))
  report.native.push({ phase: "initial", ...initial })
  assert(initial.visible && initial.responding && !initial.hung && !initial.maximized)
  assert.deepEqual(initial.clientLogical, [1180, 760])
  assert.deepEqual(initial.minimumClientLogical, [900, 600])
  assert(initial.webviewProcesses.some(p => p.commandLine.includes("--embedded-browser-webview=1")), "Falta evidencia de WebView2 embebido")
  report.lifecycle.opened = true
  await capture("capture-inverse")
  if (!smoke) await runChecks(page)
  report.hashesAfter = Object.fromEntries(protectedPaths.map(path => [relative(root, path).replaceAll("\\", "/"), hash(path)]))
  assert.deepEqual(report.hashesAfter, report.hashesBefore, "Cambió un motor, parámetro o imagen protegido")
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.consoleErrors, [])
  assert.deepEqual(report.httpErrors, [])
  assert.deepEqual(report.external, [])
  report.pendingHttpRequests = [...pendingRequests].map(r => r.url())
  assert.deepEqual(report.pendingHttpRequests, [])
  const close = native("close")
  assert(close.posted)
  for (let i = 0; i < 100; i++) {
    const alive = execFileSync("pwsh", ["-NoProfile", "-Command", `@(Get-Process -Id ${initial.pid} -ErrorAction SilentlyContinue).Count`], { encoding: "utf8" }).trim()
    if (alive === "0") { report.lifecycle.closedByWindowMessage = true; break }
    await delay(100)
  }
  assert(report.lifecycle.closedByWindowMessage, "La ventana no cerró normalmente")
  assert(!/panicked at|thread .*panicked|unhandled exception/i.test(log), "Error nativo en salida de Tauri")
} catch (error) {
  report.failures.push(error.stack ?? String(error))
  process.exitCode = 1
} finally {
  if (browser) await browser.close().catch(() => {})
  if (app.exitCode === null) {
    try { execFileSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "pipe" }) } catch { /* Ya finalizado. */ }
  }
  report.finished = new Date().toISOString()
  writeFileSync(join(evidence, `${mode}-report.json`), JSON.stringify(report, null, 2))
  writeFileSync(join(evidence, `${mode}-tauri.log`), log)
  console.log(JSON.stringify({ mode, nativeTauri: true, lifecycle: report.lifecycle, checks: report.checks, fiscal: report.fiscal.map(c => ({ id: c.id, primary: c.obtained.primary, net: c.obtained.net, isr: c.obtained.isr, imss: c.obtained.imss, alternatives: c.obtained.alternatives })), extraFiscal: report.extraFiscal, metrics: report.metrics, timings: report.timings, errors: report.errors, consoleErrors: report.consoleErrors, httpErrors: report.httpErrors, external: report.external, failures: report.failures, evidence }, null, 2))
}

function installProbe() {
  window.__uiRuns = []
  window.__uiAbortStarts = 0
  const Original = window.AbortController
  window.AbortController = class extends Original { constructor() { super(); window.__uiAbortStarts++ } }
  document.addEventListener("submit", () => {
    if (window.__uiCurrent?.elapsedMs === null) window.__uiCurrent.elapsedMs = performance.now() - window.__uiCurrent.started
    const run = { started: performance.now(), origin: performance.timeOrigin, elapsedMs: null, frames: 0, maxFrameGapMs: 0, previousFrame: performance.now(), messages: [], cancelRequested: null, cancelLatencyMs: null }
    window.__uiRuns.push(run)
    window.__uiCurrent = run
    function frame(now) {
      if (run.elapsedMs !== null) return
      run.frames++
      run.maxFrameGapMs = Math.max(run.maxFrameGapMs, now - run.previousFrame)
      run.previousFrame = now
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }, true)
  document.addEventListener("click", event => {
    if (event.target.closest("button")?.textContent.trim() === "Cancelar" && window.__uiCurrent) window.__uiCurrent.cancelRequested = performance.now()
  }, true)
  addEventListener("DOMContentLoaded", () => {
    new MutationObserver(() => {
      const run = window.__uiCurrent, section = document.querySelector(".results-section")
      if (!run || run.elapsedMs !== null || !section) return
      const message = document.getElementById("result-message")?.textContent
      if (message && run.messages.at(-1) !== message) run.messages.push(message)
      if (section.getAttribute("aria-busy") === "false") {
        run.elapsedMs = performance.now() - run.started
        run.resultState = section.dataset.resultState
        if (run.cancelRequested !== null) run.cancelLatencyMs = performance.now() - run.cancelRequested
      }
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
  })
}
function money(text) { return text.replace(/\$|,|\s/g, "") }
async function fill({ mode = "net-to-gross", amount = "13202.64", period = "monthly", imss = true, bonus = "15", vacation = "12", premium = "25", date = "2026-02-01" } = {}) {
  await page.locator('input[name="fiscal-date-mode"][value="yes"]').check()
  await page.getByRole("button", { name: mode === "gross-to-net" ? /Bruto a neto/ : /Neto a bruto/ }).click()
  for (const [id, value] of [["salary", amount], ["period", period], ["bonus-days", bonus], ["vacation-days", vacation], ["vacation-premium", premium], ["effective-date", date]]) {
    if (id === "period") await page.locator(`#${id}`).selectOption(value)
    else await page.locator(`#${id}`).fill(value)
  }
  await page.locator(`input[name="worker-imss"][value="${imss ? "yes" : "no"}"]`).check()
}
async function calculate(wait = true) {
  await page.locator("#salary").press("Enter")
  await page.locator(".results-section").waitFor()
  await page.waitForFunction(() => document.activeElement?.id === "results-title")
  if (wait) await done()
}
async function done() { await page.waitForFunction(() => document.querySelector(".results-section")?.getAttribute("aria-busy") === "false") }
async function edit() {
  await page.getByRole("button", { name: "Editar datos", exact: true }).focus(); await page.keyboard.press("Enter")
  await page.waitForFunction(() => document.activeElement?.id === "salary")
  assert.equal(await page.locator(".results-section").count(), 0)
}
async function measure(name) {
  await page.evaluate(() => scrollTo(0, 0))
  const metric = await page.evaluate(name => ({
    name, viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, visualScale: visualViewport.scale,
    scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight,
    scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
    panels: [...document.querySelectorAll(".detail-panel")].map(element => { const r = element.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, width: r.width, height: r.height } }),
    fonts: Object.fromEntries(["h1", ".primary-amount", ".results-heading h2"].map(selector => [selector, document.querySelector(selector) ? { size: getComputedStyle(document.querySelector(selector)).fontSize, family: getComputedStyle(document.querySelector(selector)).fontFamily } : null])),
    openDetails: document.querySelectorAll("details[open]").length,
  }), name)
  report.metrics.push(metric)
  assert.equal(metric.visualScale, 1)
  assert.equal(metric.dpr, report.native[0].scale)
  assert(metric.scrollWidth <= metric.clientWidth, "Desbordamiento horizontal nativo")
  if (metric.viewport[0] === 1180) {
    assert(metric.scrollHeight <= metric.clientHeight, `Scroll ordinario nativo: ${name}`)
    assert(metric.panels.every(p => p.bottom <= metric.clientHeight), "Paneles incompletos en ventana inicial")
  }
  if (metric.viewport[0] === 900 && metric.panels.length) {
    await page.locator(".detail-panel").last().scrollIntoViewIfNeeded()
    const last = await page.locator(".detail-panel").last().boundingBox()
    assert(last.y >= 0 && last.y + last.height <= metric.clientHeight + 1)
    await page.evaluate(() => scrollTo(0, 0))
  }
}
async function timing(name, extra = {}) {
  const result = await page.evaluate(() => window.__uiCurrent)
  assert(result && result.elapsedMs !== null, "Falta medición de la operación UI")
  report.timings.push({ name, ...result, ...extra })
  return result
}
async function emptyAmounts() { assert.equal(await page.locator('.results-section [aria-label="Sin resultado"]').count(), 4) }
async function openScenario(scenario) {
  assert(!built, "Los controles de prueba no existen en el build distribuido")
  await page.goto(`http://127.0.0.1:1420/dev/inverse.html?case=${scenario}`, { waitUntil: "networkidle" })
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled)
}
async function runChecks() {
  assert(await page.evaluate(() => typeof window.__TAURI_INTERNALS__ === "object"), "Falta el entorno Tauri real")
  assert((await page.locator('link[rel="icon"]').getAttribute("href")).startsWith("data:image/svg+xml,"))
  await measure("captura inversa inicial")
  await page.locator("#salary").focus(); await page.keyboard.press("Tab")
  assert.equal(await page.evaluate(() => document.activeElement.id), "period")
  report.accessibility = { tabFromSalary: "period", unsupportedControlsRemoved: true }
  assert.equal(await page.locator("#worker-type, .switch-preview, .advanced-panel, select#state").count(), 0)
  for (const mode of ["gross-to-net", "net-to-gross"]) {
    await page.getByRole("button", { name: mode === "gross-to-net" ? /Bruto a neto/ : /Neto a bruto/ }).click()
    await page.getByRole("button", { name: "Limpiar", exact: true }).click()
    await page.getByRole("button", { name: mode === "gross-to-net" ? /Bruto a neto/ : /Neto a bruto/ }).click()
    await page.locator('button[type="submit"]').click()
    assert.equal(await page.locator(".field-error").count(), 2)
    await page.waitForFunction(() => document.activeElement?.id === "salary")
    assert.equal(await page.locator("#salary").getAttribute("aria-invalid"), "true")
    assert.equal(await page.locator("#salary").getAttribute("aria-describedby"), "salary-error")
    await fill({ mode, bonus: "", vacation: "", premium: "" })
    await page.locator('button[type="submit"]').click()
    assert.equal(await page.locator(".field-error").count(), 3)
    assert.equal(await page.locator("#state").getAttribute("data-salary-area"), "general-zone")
    report.checks.push(`${mode}: captura incompleta, prestaciones borradas, zona general visible y foco`)
  }

  const cases = [
    { id: "A", mode: "gross-to-net", amount: "15000.00", period: "monthly", net: "13202.64", isr: "1402.82", imssValue: "394.54" },
    { id: "B", mode: "gross-to-net", amount: "15000.00", period: "monthly", imss: false, net: "13597.18", imssValue: "0.00" },
    { id: "C", mode: "gross-to-net", amount: "3500.00", period: "weekly", net: "3076.67" },
    { id: "D", mode: "gross-to-net", amount: "7500.00", period: "fortnightly", net: "6592.87" },
    { id: "E", amount: "13202.64", period: "monthly", roots: ["15000.00"] },
    { id: "F", amount: "13597.18", period: "monthly", imss: false, roots: ["15000.00"] },
    { id: "G", amount: "3076.67", period: "weekly", roots: ["3499.99", "3500.00"] },
    { id: "H", amount: "6592.87", period: "fortnightly", roots: ["7500.00"] },
    { id: "I", amount: "10500.00", period: "monthly", roots: ["11093.07", "11714.44"] },
  ]
  for (const c of cases) {
    if (await page.locator(".results-section").count()) await edit()
    await fill(c)
    if (c.id === "A") {
      await capture("capture-direct")
      await page.locator('button[type="submit"]').dblclick()
      await done()
    } else await calculate()
    const inverse = !c.mode
    const obtained = { primary: money(await page.locator(".primary-amount").innerText()), isr: money(await page.locator(".summary-isr p").innerText()), imss: money(await page.locator(".summary-imss p").innerText()), message: await page.locator("#result-message").innerText(), state: await page.locator(".results-section").getAttribute("data-result-state") }
    if (!inverse) {
      obtained.net = obtained.primary
      assert.equal(obtained.net, c.net)
      if (c.isr) assert.equal(obtained.isr, c.isr)
      if (c.imssValue) assert.equal(obtained.imss, c.imssValue)
    } else {
      obtained.net = money(await page.locator('[data-inverse="obtained"]').innerText())
      obtained.difference = money(await page.locator('[data-inverse="difference"]').innerText())
      assert.equal(obtained.net, c.amount)
      assert.equal(obtained.difference, "0.00")
      await page.locator(".fiscal-insights > summary").click()
      await page.locator(".verified-alternatives > summary").click()
      await page.locator(".technical-result-details > summary").click()
      obtained.alternatives = await page.locator('[aria-label="Brutos exactos verificados"] li').allTextContents()
      for (const gross of c.roots) assert(obtained.alternatives.some(text => money(text.split(" · ")[0].replace("Bruto ", "")) === gross), `Falta candidato ${gross}`)
      obtained.coverage = await page.locator(".inverse-search-details").innerText()
      await page.locator(".fiscal-insights > summary").click()
      await timing(c.id)
    }
    report.fiscal.push({ id: c.id, expected: c, obtained })
    assert.equal(await page.getByRole("button", { name: "Guardar", exact: true }).count(), 0)
    assert.equal(await page.getByRole("button", { name: "Exportar PDF", exact: true }).isDisabled(), true)
    if (c.id === "A" || c.id === "G") {
      if (c.id === "A") {
        report.accessibility.directResultsTree = await page.locator(".results-section").ariaSnapshot()
        await page.evaluate(() => getSelection()?.removeAllRanges())
      }
      await measure(`${c.id}: resultados ordinarios 1180`)
      await capture(c.id === "A" ? "results-direct-1180" : "results-inverse-1180")
      const minimum = native("resize", ["-Width", "900", "-Height", "600"])
      assert.deepEqual(minimum.clientLogical, [900, 600])
      report.native.push({ phase: `${c.id}-minimum`, ...minimum })
      await page.waitForFunction(() => innerWidth === 900 && innerHeight === 600)
      await measure(`${c.id}: resultados ordinarios 900`)
      await capture(c.id === "A" ? "results-direct-900" : "results-inverse-900")
      native("resize", ["-Width", "1180", "-Height", "760"])
      await page.waitForFunction(() => innerWidth === 1180 && innerHeight === 760)
    }
  }
  report.checks.push("Casos fiscales A–I mediante controles de la ventana nativa; alternativas y cobertura visibles")

  await edit(); await fill({ mode: "gross-to-net", amount: "9451.19", imss: false }); await calculate()
  assert.equal(await page.locator(".results-section").getAttribute("data-result-state"), "blocked")
  assert((await page.locator("#result-message").innerText()).includes("inferior al mínimo"))
  assert.equal(money(await page.locator(".primary-amount").innerText()), "—")
  assert.equal(await page.locator(".minimum-confirmation").count(), 0)
  await edit(); await fill({ mode: "gross-to-net", amount: "9451.20" }); await calculate()
  assert.equal(money(await page.locator(".primary-amount").innerText()), "—")
  assert.equal(await page.locator("#minimum-month-ack").isChecked(), false)
  assert.equal(await page.getByRole("button", { name: "Recalcular con hipótesis" }).isDisabled(), true)
  await page.locator("#minimum-month-ack").focus(); await page.keyboard.press("Space")
  assert.equal(money(await page.locator(".primary-amount").innerText()), "—")
  await page.keyboard.press("Tab")
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "Recalcular con hipótesis")
  await page.keyboard.press("Enter"); await done()
  assert.equal(money(await page.locator(".primary-amount").innerText()), "9451.20")
  assert.equal(money(await page.locator(".summary-isr p").innerText()), "0.00")
  assert.equal(money(await page.locator('[data-subsidy="applied"]').innerText()), "0.00")
  await edit(); await fill({ amount: "9451.20" }); await calculate()
  assert.equal(await page.locator(".primary-result h3").innerText(), "Bruto encontrado")
  assert.equal(await page.locator("#minimum-month-ack").isChecked(), false)
  assert((await page.locator("#result-message").innerText()).includes("Mínimo no demostrado"))
  await page.locator("#minimum-month-ack").focus(); await page.keyboard.press("Space")
  await page.getByRole("button", { name: "Recalcular con hipótesis" }).click(); await done()
  assert.equal(money(await page.locator(".primary-amount").innerText()), "9451.20")
  assert.equal(money(await page.locator('[data-inverse="obtained"]').innerText()), "9451.20")
  await capture("minimum-confirmed")
  await edit(); await fill({ amount: "9451.20", date: "2026-03-01" }); await calculate()
  assert.equal(await page.locator("#minimum-month-ack").isChecked(), false)
  assert((await page.locator(".minimum-confirmation").innerText()).includes("2026-03"))
  report.checks.push("Bajo mínimo bloqueado; hipótesis mensual directa/inversa por Espacio/Tab/Enter; cambio de mes invalida")

  for (const mode of ["gross-to-net", "net-to-gross"]) {
    await edit(); await fill({ mode, date: "2027-02-01" }); await calculate()
    assert((await page.locator("#result-message").innerText()).includes("no soportado"))
    assert.equal(money(await page.locator(".primary-amount").innerText()), "—")
  }
  report.checks.push("Ambos modos: fecha fuera de cobertura conserva desconocidos, sin ceros supuestos")

  await edit(); await fill({ amount: "9451.19" }); await calculate()
  const lowNet = { scenario: "neto objetivo inferior a referencia bruta mínima", target: "9451.19", gross: money(await page.locator(".primary-amount").innerText()), obtainedNet: money(await page.locator('[data-inverse="obtained"]').innerText()), message: await page.locator("#result-message").innerText() }
  assert.equal(lowNet.obtainedNet, "9451.19")
  assert.notEqual(lowNet.gross, "0.00")
  assert.notEqual(lowNet.gross, "—")
  report.extraFiscal.push(lowNet)
  report.checks.push("Inverso: neto bajo la referencia bruta no se confunde con un contrato bajo mínimo")

  await edit(); await fill({ bonus: "365000000" }); await calculate(false)
  assert.equal(await page.locator(".results-section").getAttribute("aria-busy"), "true")
  const ping = native()
  await done()
  const stress = await timing("exigente sin certificado, presupuesto productivo")
  assert(ping.responding && !ping.hung)
  report.native.push({ phase: "during-demanding-search", ...ping })
  assert.equal(await page.locator(".results-section").getAttribute("data-result-state"), "limited")
  assert(stress.frames > 0)
  report.checks.push("Búsqueda exigente limitada por presupuesto; mensajes nativos responden y hay frames de UI")

  await edit(); await fill({ bonus: "365000000" }); await calculate(false)
  const cancelCommandStarted = performance.now()
  await page.getByRole("button", { name: "Cancelar", exact: true }).focus(); await page.keyboard.press("Enter")
  await done(); await emptyAmounts()
  await page.waitForFunction(() => document.activeElement?.id === "results-title")
  await timing("cancelación voluntaria exigente", { automationFocusEnterToObservedMs: performance.now() - cancelCommandStarted })
  await capture("cancelled")
  await edit()
  assert.equal(await page.locator("#bonus-days").inputValue(), "365000000")
  await fill({ bonus: "365000000" }); await calculate(false)
  await edit(); await fill({ mode: "gross-to-net", amount: "15000.00" }); await calculate()
  assert.equal(money(await page.locator(".primary-amount").innerText()), "13202.64")
  report.checks.push("Cancelar responde por teclado; editar durante búsqueda y cambiar a directo no mezcla resultados")
  await edit(); await fill({ bonus: "365000000" }); await calculate(false)
  await page.getByRole("button", { name: "Limpiar", exact: true }).click()
  assert.equal(await page.locator("#salary").inputValue(), "")
  assert.equal(await page.locator("#state").getAttribute("data-salary-area"), "general-zone")
  assert.equal(await page.locator(".results-section").count(), 0)
  for (let i = 0; i < 12; i++) await page.getByRole("button", { name: i % 2 ? /Neto a bruto/ : /Bruto a neto/ }).click()
  report.checks.push("Limpieza durante búsqueda y doce cambios rápidos de modo sin datos tardíos")

  if (!built) await controlledChecks()
  const storage = await page.evaluate(async () => ({ local: localStorage.length, session: sessionStorage.length, indexedDb: (await indexedDB.databases()).map(db => db.name) }))
  report.storage = storage
  assert.deepEqual(storage, { local: 0, session: 0, indexedDb: [] })
  report.checks.push("Captura local: sin almacenamiento web de datos ni solicitudes externas observadas")
}

async function controlledChecks() {
  for (const [scenario, amount, period] of [["approximate", "5557.04", "fortnightly"], ["limited", "13202.64", "monthly"], ["empty-limited", "1.00", "monthly"], ["unresolved", "9451.20", "monthly"], ["error", "13202.64", "monthly"], ["missing-parameters", "13202.64", "monthly"]]) {
    await openScenario(scenario)
    await fill({ amount, period }); await calculate()
    if (scenario === "approximate") {
      assert.equal(await page.locator(".primary-result h3").innerText(), "Bruto aproximado")
      assert.equal(money(await page.locator('[data-inverse="obtained"]').innerText()), "5557.03")
      assert.equal(money(await page.locator('[data-inverse="difference"]').innerText()), "−0.01")
      await capture("approximate-controlled")
    } else if (scenario === "limited" || scenario === "empty-limited") {
      assert.equal(await page.locator(".results-section").getAttribute("data-result-state"), "limited")
      if (scenario === "limited") assert.equal(money(await page.locator(".primary-amount").innerText()), "15000.00")
      else await emptyAmounts()
    } else {
      await emptyAmounts()
      if (scenario === "error") assert.equal(await page.locator(".results-section").getAttribute("data-result-state"), "error")
      if (scenario === "unresolved") assert.equal(await page.locator("#minimum-month-ack").isChecked(), false)
    }
    report.checks.push(`WebView2 nativo, entrada aislada/controlada: ${scenario}`)
  }
  await openScenario("missing-parameters")
  await fill({ mode: "gross-to-net", amount: "15000.00" }); await calculate()
  assert.equal(await page.locator(".results-section").getAttribute("data-result-state"), "blocked")
  assert.equal(money(await page.locator(".primary-amount").innerText()), "—")
  report.checks.push("Directo no determinable por contexto de prueba incompleto, sin tocar parámetros productivos")

  for (const action of ["cancel-resolve", "cancel-reject", "clear", "old-first", "new-first", "current-reject", "unmount"]) {
    await openScenario("deferred")
    await fill({ amount: "00013202.64", premium: "25.00" })
    const before = await page.evaluate(() => window.__uiAbortStarts)
    await page.locator(".capture-section").evaluate(form => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })
    await page.waitForFunction(() => document.querySelector(".results-section")?.getAttribute("aria-busy") === "true")
    assert.equal(await page.evaluate(() => window.__inverseVerification.state.calls), 1)
    assert.equal(await page.evaluate(() => window.__uiAbortStarts), before + 1)
    await emptyAmounts()
    if (action.startsWith("cancel")) {
      await page.getByRole("button", { name: "Cancelar", exact: true }).click()
      if (action.endsWith("resolve")) await page.evaluate(() => window.__inverseVerification.resolve(0))
      else await page.evaluate(() => window.__inverseVerification.reject(0))
      assert.equal(await page.locator(".results-section").getAttribute("data-result-state"), "cancelled")
      await emptyAmounts()
    } else if (action === "clear") {
      await page.getByRole("button", { name: "Limpiar", exact: true }).click()
      await page.evaluate(() => window.__inverseVerification.resolve(0))
      assert.equal(await page.locator("#salary").inputValue(), "")
      assert.equal(await page.locator(".results-section").count(), 0)
    } else if (action === "old-first" || action === "new-first") {
      await edit(); await page.locator("#salary").fill("13202.65"); await calculate(false)
      assert.equal(await page.evaluate(() => window.__inverseVerification.state.pending[0].aborted), true)
      await page.evaluate(index => window.__inverseVerification.resolve(index), action === "old-first" ? 0 : 1)
      if (action === "old-first") assert.equal(await page.locator(".results-section").getAttribute("aria-busy"), "true")
      else { await done(); assert.equal(money(await page.locator(".primary-amount").innerText()), "15000.01") }
      await page.evaluate(index => window.__inverseVerification.resolve(index), action === "old-first" ? 1 : 0)
      await done()
      assert.equal(money(await page.locator(".primary-amount").innerText()), "15000.01")
    } else if (action === "current-reject") {
      await page.evaluate(() => window.__inverseVerification.reject(0)); await done()
      assert.equal(await page.locator(".results-section").getAttribute("data-result-state"), "error")
      await emptyAmounts(); await edit()
      assert.equal(await page.locator("#salary").inputValue(), "00,013,202.64")
    } else {
      await page.evaluate(() => window.__inverseVerification.unmount())
      assert.equal(await page.evaluate(() => window.__inverseVerification.state.pending[0].aborted), true)
      await page.evaluate(() => window.__inverseVerification.resolve(0))
      assert.equal(await page.locator(".results-section").count(), 0)
      assert.equal(await page.evaluate(() => window.__inverseVerification.state.disposals), 2)
    }
    report.checks.push(`WebView2 nativo, promesa controlada: ${action}, doble submit protegido`)
  }
}
