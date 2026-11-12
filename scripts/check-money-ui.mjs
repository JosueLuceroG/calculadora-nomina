// 5B.3: teclado/clipboard/IME reales en Edge o en el WebView2 de Tauri.
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
const isNative = process.argv.includes("--native"), mode = isNative ? "native" : "edge"
const checkResults = process.argv.includes("--5b4")
const checkParameters = process.argv.includes("--5b5")
const checkHelp = process.argv.includes("--5b6")
const port = isNative ? 1420 : 1432, base = `http://127.0.0.1:${port}/`
const evidence5b8 = process.argv.includes("--evidence-5b8")
const isolatedRoot = evidence5b8 && isNative ? join(tmpdir(), "opencode", `5b7-regression-5b8-${Date.now()}`) : null
const out = join(root, "docs", "evidence", evidence5b8 ? "5b8" : checkHelp || process.argv.includes("--evidence-5b6") ? "5b6" : checkParameters || process.argv.includes("--evidence-5b5") ? "5b5" : checkResults || process.argv.includes("--evidence-5b4") ? "5b4" : "5b3")
mkdirSync(out, { recursive: true })
const report = { mode, nativeTauri: isNative, isolatedRoot, checks: [], edits: [], fiscal: [], metrics: [], resizes: [], errors: [], consoleErrors: [], failures: [] }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let occupied = false
try { await fetch(base); occupied = true } catch { /* Puerto libre. */ }
assert(!occupied, `Puerto ${port} ocupado`)
if (isNative) {
  assert.equal(execFileSync("pwsh", ["-NoProfile", "-Command", "@(Get-Process -Name 'calculadora-nomina' -ErrorAction SilentlyContinue).Count"], { encoding: "utf8" }).trim(), "0", "No cerrar ventanas personales")
  let cdpOccupied = false
  try { await fetch("http://127.0.0.1:9225/json/version"); cdpOccupied = true } catch { /* Puerto libre. */ }
  assert(!cdpOccupied)
}
const server = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] })
let log = "", app, browser, page, cdp, nativePid = 0
server.stdout.on("data", b => { log += b.toString() })
server.stderr.on("data", b => { log += b.toString() })
function native(action, more = []) {
  return JSON.parse(execFileSync("pwsh", ["-NoProfile", "-File", join(root, "scripts", "native-window.ps1"), "-Action", action, ...(nativePid ? ["-ProcessId", String(nativePid)] : []), ...more], { encoding: "utf8", timeout: 30000 }))
}
const salary = () => page.locator("#salary")
async function key(key, times = 1) { for (let i = 0; i < times; i++) await page.keyboard.press(key) }
async function select(start, end = start) {
  await salary().focus(); await key("Home"); await key("ArrowRight", start)
  await key("Shift+ArrowRight", end - start)
}
async function expectEdit(name, text, start, end = start) {
  const actual = await salary().evaluate(e => ({ text: e.value, start: e.selectionStart, end: e.selectionEnd, direction: e.selectionDirection }))
  assert.equal(actual.text, text, name)
  if (start !== undefined) { assert.equal(actual.start, start, `${name}: caret inicio`); assert.equal(actual.end, end, `${name}: caret fin`) }
  report.edits.push({ name, ...actual })
}
async function paste(text) { await page.evaluate(text => navigator.clipboard.writeText(text), text); await key("Control+V") }
async function manual() {
  await page.locator('input[name="fiscal-date-mode"][value="yes"]').check()
  await page.locator("input#effective-date").fill("2026-02-01")
}
async function fill(amount, direction = "gross-to-net", period = "monthly", imss = true) {
  await page.getByRole("button", { name: direction === "gross-to-net" ? /Bruto a neto/ : /Neto a bruto/ }).click()
  await salary().fill(amount)
  await page.locator("#period").selectOption(period)
  await page.locator(imss ? "#include-imss" : "#exclude-imss").check()
  await manual()
}
async function calculate() {
  await salary().press("Enter")
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
  const metrics = await page.evaluate(name => ({ name, viewport: [innerWidth, innerHeight], dpr: devicePixelRatio,
    scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight,
    scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
    field: (() => { const e = document.querySelector("#salary"); if (!e) return null; const s = getComputedStyle(e), r = e.parentElement.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, font: s.fontFamily, fontSize: s.fontSize, color: s.color } })(),
  }), name)
  assert(metrics.scrollWidth <= metrics.clientWidth, "Sin desbordamiento horizontal")
  if (innerWidthIsStandard(metrics)) assert(metrics.scrollHeight <= metrics.clientHeight, "Vista ordinaria sin scroll 1180×760")
  report.metrics.push(metrics)
}
function innerWidthIsStandard(metrics) { return metrics.viewport[0] === 1180 }
try {
  let ready = false
  for (let i = 0; i < 200; i++) {
    if (server.exitCode !== null) throw new Error(log)
    try { if ((await fetch(base)).ok) { ready = true; break } } catch { /* Arrancando. */ }
    await sleep(100)
  }
  assert(ready)
  if (isNative) {
    app = spawn(join(root, "src-tauri", "target", "debug", "calculadora-nomina.exe"), [], { cwd: root, env: { ...process.env, ...(isolatedRoot ? { NOMINA_STORAGE_TEST_ROOT: isolatedRoot } : {}), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9225 --remote-debugging-address=127.0.0.1", WEBVIEW2_USER_DATA_FOLDER: join(tools, `3b4-profile-5b3-${Date.now()}`) }, stdio: "ignore" })
    for (let i = 0; i < 120; i++) { try { browser = await chromium.connectOverCDP("http://127.0.0.1:9225"); break } catch { await sleep(250) } }
    assert(browser)
    for (let i = 0; i < 100; i++) { page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith(base)); if (page) break; await sleep(100) }
    assert(page)
    const window = native("inspect"); nativePid = window.pid; report.nativeWindow = window
    assert.deepEqual(window.clientLogical, [1180, 760])
  } else {
    browser = await chromium.launch({ channel: "msedge", headless: true })
    page = await browser.newPage({ viewport: { width: 1180, height: 760 }, timezoneId: "America/Mexico_City" })
  }
  page.on("pageerror", e => report.errors.push(e.message))
  page.on("console", e => { if (e.type() === "error") report.consoleErrors.push(e.text()) })
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: base })
  await page.goto(`${base}dev/money.html`, { waitUntil: "networkidle" })
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled)
  await page.bringToFront()
  cdp = await page.context().newCDPSession(page)
  report.browserVersion = await browser.version()
  if (isNative) {
    assert(await page.evaluate(() => typeof window.__TAURI_INTERNALS__ === "object"))
    report.nativeWindow = native("inspect")
  }
  await measure("captura vacía 1180")
  assert((await salary().locator("..").innerText()).includes("MXN"))
  if (checkHelp) {
    const { checkHelpCases } = await import("./check-help-cases.mjs")
    await checkHelpCases({ page, report, fill, calculate, edit, screenshot, native, isNative, base })
  } else if (checkParameters) {
    const { checkParameterCases } = await import("./check-parameter-cases.mjs")
    await checkParameterCases({ page, report, fill, calculate, edit, screenshot, native, isNative, base, out, mode })
  } else if (checkResults) {
    const { checkReadableResults } = await import("./check-readable-results-cases.mjs")
    await checkReadableResults({ page, report, fill, calculate, edit, screenshot, native, isNative, base })
  } else {
  for (const [plain, formatted] of [["3500", "3,500"], ["15000.50", "15,000.50"], ["1234567.89", "1,234,567.89"], ["0.50", "0.50"], ["15000.00", "15,000.00"], ["123456789012345678901234567890.01", "123,456,789,012,345,678,901,234,567,890.01"]]) {
    await salary().fill(""); await page.keyboard.type(plain)
    await expectEdit(`teclado ${plain}`, formatted, formatted.length)
  }
  report.checks.push("ejemplos, importe mayor que precisión binaria, centavos y ceros finales mediante teclado real")
  await salary().fill("")
  for (const [char, expected] of [["1", "1"], ["5", "15"], ["0", "150"], ["0", "1,500"], ["0", "15,000"], [".", "15,000."], ["5", "15,000.5"], ["0", "15,000.50"]]) {
    await page.keyboard.type(char); await expectEdit(`progresivo ${expected}`, expected, expected.length)
  }
  await measure("captura formateada 1180")
  assert.deepEqual(report.metrics[0].field, report.metrics[1].field, "Sin salto de tamaño/posición/tipografía")
  report.checks.push("escritura progresiva; punto pendiente y decimal parcial; sin .00 añadido ni saltos de campo")

  await salary().fill("3500"); await select(0); await page.keyboard.type("9"); await expectEdit("insertar inicio", "93,500", 1)
  await select(4); await page.keyboard.type("8"); await expectEdit("insertar medio", "935,800", 5)
  await key("End"); await page.keyboard.type("1"); await expectEdit("insertar final", "9,358,001", 9)
  await salary().fill("12345.67"); await select(1, 5); await page.keyboard.type("9"); await expectEdit("selección reemplazada", "195.67", 2)
  report.checks.push("insertar inicio/medio/final y reemplazar selección que incluye separador, caret conservado")

  await salary().fill("15000.50"); await key("End"); await key("ArrowLeft", 7); await key("Shift+ArrowLeft", 2)
  assert.equal(await salary().evaluate(e => e.selectionDirection), "backward")
  await page.keyboard.type("9"); await key("Control+Z")
  await expectEdit("deshacer selección hacia atrás", "15,000.50", 0, 2)
  assert.equal(await salary().evaluate(e => e.selectionDirection), "backward")
  await key("ArrowRight"); await expectEdit("flecha colapsa selección nativamente", "15,000.50", 2)
  await key("ArrowRight"); await expectEdit("flecha recorre coma sin salto impuesto", "15,000.50", 3)
  await key("ArrowLeft"); await expectEdit("flecha vuelve antes de coma", "15,000.50", 2)

  for (const [name, pos, pressed, expected, caret] of [
    ["Backspace dígito antes coma", 1, "Backspace", "500", 0],
    ["Delete dígito después coma", 2, "Delete", "300", 1],
    ["Backspace inmediatamente después coma", 2, "Backspace", "500", 0],
    ["Delete inmediatamente antes coma", 1, "Delete", "300", 1],
  ]) {
    await salary().fill("3500"); await select(pos); await key(pressed); await expectEdit(name, expected, caret)
    await key("Control+Z"); await expectEdit(`${name} undo`, "3,500", pos)
    await key("Control+Y"); await expectEdit(`${name} redo`, expected, caret)
  }
  report.checks.push("Backspace/Delete a ambos lados de coma y sobre sus dígitos adyacentes; undo/redo y selección exactos")

  await salary().fill("15000.50"); await select(0, 2); await key("Control+C")
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "15")
  await key("Control+X"); await expectEdit("cortar selección", "000.50", 0)
  await key("Control+Z"); await expectEdit("deshacer corte restaura selección", "15,000.50", 0, 2)
  await key("Control+Shift+Z"); await expectEdit("rehacer corte", "000.50", 0)
  await key("Control+A"); await paste("1,234,567.89"); await expectEdit("pegar formato completo", "1,234,567.89", 12)
  await key("Control+Z"); await expectEdit("deshacer pegado", "000.50", 0, 6)
  await key("Control+Y"); await expectEdit("rehacer pegado", "1,234,567.89", 12)
  await key("Control+A"); await paste("15000.50"); await expectEdit("pegar sin formato", "15,000.50", 9)
  for (const text of ["1,50", "1.000,50"]) {
    await key("Control+A"); await paste(text)
    await expectEdit(`pegado ambiguo rechazado ${text}`, "15,000.50", 0, 9)
    assert((await salary().evaluate(e => e.validationMessage)).includes("Pegado rechazado"))
  }
  await salary().fill("3500"); await select(2, 3); await paste("6"); await expectEdit("pegar reemplazo intermedio", "3,600", 3)
  report.checks.push("clipboard real Ctrl+A/C/X/V, pegado con/sin formato e intermedio, ambiguos rechazados con explicación, undo/redo transaccional")

  await salary().fill("3500"); await key("Control+A")
  await cdp.send("Input.imeSetComposition", { text: "15000.", selectionStart: 6, selectionEnd: 6 })
  await expectEdit("IME en curso sin reformatear", "15000.", 6)
  await cdp.send("Input.imeSetComposition", { text: "15000.50", selectionStart: 8, selectionEnd: 8 })
  await cdp.send("Input.insertText", { text: "15000.50" })
  await expectEdit("IME confirmado", "15,000.50", 9)
  await key("Control+Z"); await expectEdit("IME una transacción deshacer", "3,500", 0, 5)
  await key("Control+Y"); await expectEdit("IME rehacer", "15,000.50", 9)
  report.checks.push("composición IME nativa CDP: texto intermedio sin máscara, commit único y undo/redo sin pérdida")

  for (const text of ["1,50", "1.000,50", "15000.500", "-15000", "1e3"]) {
    await salary().fill(""); await page.keyboard.type(text)
    await expectEdit(`borrador inválido escrito ${text}`, text === "15000.500" ? "15,000.500" : text)
  }

  await fill("15000")
  for (const text of ["", "0", "0.", "1500.", "15000.500", "-15000", "1e3", "1,50", "1.000,50", "$15000"]) {
    await salary().fill(text)
    const calls = await page.evaluate(() => window.__moneyVerification.requests.length)
    await salary().press("Enter")
    assert.equal(await page.locator(".results-section").count(), 0, text)
    assert.equal(await salary().getAttribute("aria-invalid"), "true", text)
    assert.equal(await page.evaluate(() => window.__moneyVerification.requests.length), calls, text)
    if (text === "15000.500") {
      await expectEdit("tres decimales no redondeados", "15,000.500")
      assert.equal(await page.locator("#salary-error").innerText(), "Usa un importe decimal con punto y máximo dos decimales.")
    }
  }
  report.checks.push("vacío/cero/punto pendiente/>2 decimales/negativo/exponente/símbolo/formatos ambiguos: validación existente, sin motor ni redondeo")

  await fill("15000.50")
  await page.locator("#period").selectOption("weekly"); await expectEdit("cambio periodo", "15,000.50")
  await page.getByRole("button", { name: /Neto a bruto/ }).click(); await expectEdit("cambio a neto", "15,000.50")
  await page.getByRole("button", { name: /Bruto a neto/ }).click(); await expectEdit("cambio a bruto", "15,000.50")
  await page.locator("#period").selectOption("monthly")
  await salary().focus(); await key("End"); await key("Backspace")
  await page.locator("#period").selectOption("weekly")
  await page.getByRole("button", { name: /Neto a bruto/ }).click()
  await salary().focus(); await key("Control+Z"); await expectEdit("modo/periodo no borran historial del campo", "15,000.50", 9)
  await page.getByRole("button", { name: /Bruto a neto/ }).click()
  await page.locator("#period").selectOption("monthly")
  await calculate()
  let request = await page.evaluate(() => window.__moneyVerification.requests.at(-1))
  assert.equal(request.input.grossPeriodSalary, "15000.50")
  assert.equal(request.snapshot.form.amount, "15000.50")
  report.fiscal.push({ name: "centavos exactos", canonical: request.snapshot.form.amount, engineInput: request.input })
  await edit(); await expectEdit("Editar datos exactos", "15,000.50")
  await salary().fill("00015000.50"); await calculate(); await edit()
  await expectEdit("Editar conserva ceros originales", "00,015,000.50")
  assert.equal(await page.evaluate(() => window.__moneyVerification.state.snapshot.form.amount), "00015000.50")
  report.checks.push("periodicidad y ambos sentidos conservan captura; motor recibe 15000.50 exacto; Editar preserva decimales/ceros sin calcular")

  for (const c of [
    { name: "mensual IMSS Sí", amount: "15000", period: "monthly", imss: true, direction: "gross-to-net", engine: "15000.00", expected: "$ 13,202.64" },
    { name: "mensual IMSS No", amount: "15000.00", period: "monthly", imss: false, direction: "gross-to-net", engine: "15000.00", expected: "$ 13,597.18" },
    { name: "semanal", amount: "3500", period: "weekly", imss: true, direction: "gross-to-net", engine: "3500.00", expected: "$ 3,076.67" },
    { name: "inverso mensual", amount: "13202.64", period: "monthly", imss: true, direction: "net-to-gross", engine: "13202.64", expected: "$ 15,000.00" },
  ]) {
    await fill(c.amount, c.direction, c.period, c.imss)
    await calculate()
    const obtained = await page.locator(".primary-amount").innerText()
    assert.equal(obtained, c.expected)
    request = await page.evaluate(() => window.__moneyVerification.requests.at(-1))
    assert.equal(request.mode, c.direction)
    assert.equal(request.input[c.direction === "gross-to-net" ? "grossPeriodSalary" : "targetNet"], c.engine)
    report.fiscal.push({ ...c, obtained, canonical: request.snapshot.form.amount, engineInput: request.input })
    if (c.name === "mensual IMSS Sí" || c.name === "inverso mensual") { await measure(c.name); await screenshot(c.direction) }
    await edit()
  }
  report.checks.push("cuatro regresiones fiscales obligatorias en motores reales y observación de sus inputs sin separadores")

  await fill("15000.50"); await measure("captura final 1180"); await screenshot("capture-1180")
  if (isNative) report.resizes.push(native("resize", ["-Width", "900", "-Height", "600"]))
  else await page.setViewportSize({ width: 900, height: 600 })
  await page.waitForFunction(() => innerWidth === 900)
  await measure("captura mínima 900"); await screenshot("money-capture-900")
  await salary().fill("3500"); await select(2); await key("Backspace"); await expectEdit("caret en ventana mínima", "500", 0)
  await page.locator('button[type="submit"]').scrollIntoViewIfNeeded()
  const button = await page.locator('button[type="submit"]').boundingBox()
  assert(button.y >= 0 && button.y + button.height <= 601)
  if (isNative) report.resizes.push(native("resize", ["-Width", "1180", "-Height", "760"]))
  else await page.setViewportSize({ width: 1180, height: 760 })
  await page.getByRole("button", { name: "Limpiar", exact: true }).click()
  await salary().focus(); await key("Control+Z"); await expectEdit("Limpiar no resucita importe", "", 0)
  await page.keyboard.type("3500"); await key("Control+A"); await key("Backspace")
  await page.getByRole("button", { name: "Limpiar", exact: true }).click()
  await salary().focus(); await key("Control+Z"); await expectEdit("Limpiar con importe ya vacío reinicia undo", "", 0)
  for (const [id, text] of [["bonus-days", "15"], ["vacation-days", "12"], ["vacation-premium", "25"]]) assert.equal(await page.locator(`#${id}`).inputValue(), text)
  assert.equal(await page.locator(".results-section").count(), 0)
  report.checks.push("1180×760 sin scroll ordinario, 900×600 con scroll vertical y Calcular accesible, sin horizontal; Limpiar reinicia pila y plantilla")

  await page.goto(`${base}dev/inverse.html?case=deferred`, { waitUntil: "networkidle" })
  await fill("13202.64", "net-to-gross"); await salary().press("Enter")
  await page.getByRole("button", { name: "Editar datos", exact: true }).waitFor()
  await edit(); await salary().fill("15000.50")
  await page.evaluate(() => window.__inverseVerification.resolve(0))
  await expectEdit("respuesta obsoleta tras editar importe", "15,000.50")
  assert.equal(await page.locator(".results-section").count(), 0)
  await page.getByRole("button", { name: "Limpiar", exact: true }).click()
  await fill("13202.64", "net-to-gross"); await salary().press("Enter")
  await page.getByRole("button", { name: "Editar datos", exact: true }).waitFor()
  await page.getByRole("button", { name: "Limpiar", exact: true }).click()
  await page.evaluate(() => window.__inverseVerification.resolve(1))
  await expectEdit("respuesta obsoleta tras nueva simulación", "")
  assert.equal(await page.locator(".results-section").count(), 0)
  report.checks.push("inverso pendiente: edición del importe y Limpiar abortan; respuestas tardías no restauran resultados ni texto anterior")
  }
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.consoleErrors, [])
  if (isNative) { native("close"); report.closedByWindowMessage = true }
} catch (error) {
  if (page) report.failureViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight })).catch(() => null)
  report.failures.push(error.stack ?? String(error)); process.exitCode = 1
} finally {
  if (browser) await browser.close().catch(() => {})
  if (app?.exitCode === null) { try { execFileSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "pipe" }) } catch { /* Ya terminó. */ } }
  server.kill()
  writeFileSync(join(out, `${mode}-${checkHelp ? "help" : checkParameters ? "parameters" : checkResults ? "results" : "money"}-ui.json`), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
