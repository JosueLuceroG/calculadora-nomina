import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { createHash, randomUUID } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { execFileSync, spawn } from "node:child_process"
const root = fileURLToPath(new URL("../", import.meta.url)), out = join(root, "docs/evidence/5d2a")
const tools = process.env.PLAYWRIGHT_TOOLS_PATH ?? join(tmpdir(), "opencode/calculadora-nomina-verification")
const { chromium } = createRequire(join(tools, "package.json"))("playwright")
const exe = join(root, "src-tauri/target/debug/calculadora-nomina.exe")
const storage = join(tmpdir(), "opencode", `5b7-5d2a-${randomUUID()}`)
const report = { mode: "windows-native-integrated-offline", checkedOn: new Date().toISOString(), binarySha256: createHash("sha256").update(readFileSync(exe)).digest("hex"), storageRoot: storage, checks: [], external: [], errors: [], failures: [] }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let app, browser, page, originalPayload, savedId
const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args })
function native(action, args = []) {
  return execFileSync("pwsh", ["-NoProfile", "-File", join(root, "scripts/native-window.ps1"), "-Action", action, "-ProcessId", String(app.pid), ...args], { encoding: "utf8", timeout: 30000 })
}
async function launch() {
  browser = null
  app = spawn(exe, [], { cwd: root, env: { ...process.env, NOMINA_STORAGE_TEST_ROOT: storage,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9225 --remote-debugging-address=127.0.0.1",
    WEBVIEW2_USER_DATA_FOLDER: join(tools, `3b4-profile-5d2a-${randomUUID()}`) }, stdio: "ignore" })
  for (let i = 0; i < 150; i++) { try { browser = await chromium.connectOverCDP("http://127.0.0.1:9225"); break } catch { await delay(100) } }
  assert(browser, "Native debugging endpoint unavailable")
  for (let i = 0; i < 100; i++) { page = browser.contexts().flatMap(c => c.pages()).find(p => p.url() === "http://tauri.localhost/"); if (page) break; await delay(100) }
  assert(page, "Integrated application origin missing")
  await page.emulateMedia({ colorScheme: null })
  page.on("pageerror", error => report.errors.push(error.message))
  page.on("console", message => { if (message.type() === "error") report.errors.push(message.text()) })
  page.on("request", request => { if (/^https?:/.test(request.url()) && !/^http:\/\/(tauri|ipc)\.localhost\//.test(request.url())) report.external.push(request.url()) })
  await page.context().setOffline(true)
  await page.reload({ waitUntil: "networkidle" })
  await page.waitForFunction(() => document.querySelector("#salary"))
  report.webview = await browser.version()
}
async function close() {
  native("close")
  await browser.close().catch(() => {})
  browser = null
  for (let i = 0; i < 100 && app.exitCode === null; i++) await delay(50)
  assert.notEqual(app.exitCode, null, "Own application did not close")
}
const nav = name => page.getByRole("navigation", { name: "Navegación principal" }).getByRole("button", { name, exact: true })
async function fill({ amount = "15000.00", mode = "gross-to-net", period = "monthly", date = "2026-02-01", imss = true, bonus = "15" } = {}) {
  await nav("Calcular").click()
  await page.getByRole("button", { name: "Limpiar", exact: true }).click()
  await page.getByRole("button", { name: mode === "gross-to-net" ? /Bruto a neto/ : /Neto a bruto/ }).click()
  await page.locator("#salary").fill(amount)
  await page.locator("#period").selectOption(period)
  await page.locator("#bonus-days").fill(bonus)
  await page.locator(imss ? "#include-imss" : "#exclude-imss").check()
  await page.locator("input[name=fiscal-date-mode][value=yes]").check()
  await page.locator("#effective-date").fill(date)
}
async function calculate(wait = true) {
  await page.locator("#salary").press("Enter")
  if (wait) await page.waitForFunction(() => document.querySelector("#calculator-workspace .results-section")?.getAttribute("aria-busy") === "false")
}
const primary = () => page.locator("#calculator-workspace .primary-amount").innerText()
async function apply(basis, minimum = false) {
  if (!await page.locator("#minimum-salary-basis").isVisible()) await page.locator("#calculator-workspace .fiscal-insights > summary").click()
  await page.locator("#minimum-salary-basis").selectOption(basis)
  if (minimum) await page.locator("#minimum-context-ack").check()
  await page.getByRole("button", { name: "Aplicar contexto de simulación", exact: true }).click()
  await page.waitForFunction(() => document.querySelector("#calculator-workspace .results-section")?.getAttribute("aria-busy") === "false")
}
try {
  assert.equal(execFileSync("pwsh", ["-NoProfile", "-Command", "@(Get-Process -Name 'calculadora-nomina' -ErrorAction SilentlyContinue).Count"], { encoding: "utf8" }).trim(), "0")
  let occupied = false
  try { await fetch("http://127.0.0.1:9225/json/version"); occupied = true } catch { /* free */ }
  assert(!occupied, "CDP port belongs to another process")
  await launch()
  assert((await invoke("storage_info")).databasePath.startsWith(storage))
  assert.equal((await invoke("storage_get_preferences")).historyAutoSave, false)
  for (const [input, expected] of [[{}, "$ 13,202.64"], [{ imss: false }, "$ 13,597.18"], [{ amount: "3500.00", period: "weekly" }, "$ 3,076.67"], [{ amount: "7500.00", period: "fortnightly" }, "$ 6,592.87"], [{ amount: "13202.64", mode: "net-to-gross" }, "$ 15,000.00"]]) {
    await fill(input); await calculate(); assert.equal(await primary(), expected)
  }
  report.checks.push("Five ordinary direct/inverse controls through the actual productive UI, three periodicities, IMSS yes/no")
  const controls = JSON.parse(readFileSync(join(root, "docs/evidence/5c2/independent-controls.json"), "utf8")).cases
  for (const date of ["2026-01-01", "2026-01-31", "2026-02-01", "2026-12-31"]) {
    const control = controls.find(c => c.gross === "15000.00" && c.period === "monthly" && c.includeImss && c.date === (date < "2026-02-01" ? "2026-01-31" : "2026-02-01") && c.context.salaryBasis === "fixed-period" && c.context.monthlyCondition === "unknown")
    assert(control)
    const [integer, fraction] = control.expected.net.split(".")
    const expected = `$ ${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`
    await fill({ date }); await calculate(); assert.equal(await primary(), expected)
  }
  report.checks.push("January/February boundary and annual endpoints calculate offline with effective-date selection")
  await fill({ amount: "9582.47" }); await calculate(); assert((await primary()).includes("—"))
  await apply("agreed-daily-reference"); assert.equal(await primary(), "$ 9,195.72")
  native("capture", ["-OutputPath", join(out, "native-contextual.png")])
  await fill({ amount: "9451.20" }); await calculate(); await apply("agreed-daily-reference", true); assert.equal(await primary(), "$ 9,451.20")
  await fill({ amount: "9451.20", mode: "net-to-gross" }); await calculate(); assert.equal(await primary(), "$ 9,877.38")
  assert((await page.locator(".primary-result h3").innerText()).includes("encontrado"))
  await apply("agreed-daily-reference", true); assert.equal(await primary(), "$ 9,451.20")
  assert((await page.locator(".primary-result h3").innerText()).includes("mínimo demostrado"))
  report.checks.push("Contextual v2 preserves unknowns, daily basis and conditional minimum; inverse retains pending-region/conditional alternatives")
  await fill({ date: "2027-01-01" })
  assert(await page.locator("button[type=submit]").isDisabled())
  assert((await page.locator("#calculator-workspace").innerText()).includes("No hay parámetros compatibles"))
  native("capture", ["-OutputPath", join(out, "native-2027-blocked.png")])
  await fill({ amount: "13202.64", mode: "net-to-gross", bonus: "365000000" }); await calculate(false)
  await page.getByRole("button", { name: "Cancelar", exact: true }).click()
  await page.waitForFunction(() => document.querySelector("#calculator-workspace .results-section")?.getAttribute("data-result-state") === "cancelled")
  assert.equal((await invoke("storage_list", { limit: 100, cursor: null })).items.length, 0)
  report.checks.push("2027 blocked without fallback; real inverse cancellation; no automatic history without consent")
  await nav("Historial").click()
  await page.locator(".history-consent input").click()
  await page.waitForFunction(async () => (await window.__TAURI_INTERNALS__.invoke("storage_get_preferences")).historyAutoSave)
  await fill(); await calculate(); await page.locator(".history-save-saved").waitFor()
  savedId = (await invoke("storage_list", { limit: 100, cursor: null })).items[0].executionId
  originalPayload = await invoke("storage_get", { executionId: savedId })
  const snapshot = JSON.parse(originalPayload).value
  const identity = JSON.parse(readFileSync(join(root, "src/features/storage/build-identity.json"), "utf8"))
  assert.equal(snapshot.schemaVersion, 1)
  assert.deepEqual(snapshot.fiscalPackage, { id: identity.fiscalPackage.id, version: identity.fiscalPackage.version, sha256: identity.fiscalPackage.sha256 })
  assert.equal(snapshot.versions.engine, identity.engineVersion)
  assert.equal(snapshot.outcome.report.retention.policyVersion, "standard-isr-withholding-2026-independent-context-v2")
  await close(); await launch()
  assert.equal(await invoke("storage_get", { executionId: savedId }), originalPayload)
  report.checks.push("Unchanged snapshot v1, original package/hash/core identity; byte-exact persistence after native restart")
  assert.deepEqual(report.external, []); assert.deepEqual(report.errors, [])
  await close()
} catch (error) {
  report.failures.push(error.stack ?? String(error)); process.exitCode = 1
} finally {
  if (browser) await browser.close().catch(() => {})
  if (app?.exitCode === null) try { execFileSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "pipe" }) } catch { /* own QA process only */ }
  writeFileSync(join(out, "native-verification.json"), JSON.stringify(report, null, 2) + "\n")
  console.log(JSON.stringify(report, null, 2))
}
