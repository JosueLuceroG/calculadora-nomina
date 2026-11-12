// Prueba del binario debug ya aprobado. No compila ni reescribe dist/ o Tauri.
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { createHash } from "node:crypto"
import { cpus, freemem, totalmem, release, tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { spawn, execFileSync } from "node:child_process"

const root = fileURLToPath(new URL("../", import.meta.url))
const tools = process.env.PLAYWRIGHT_TOOLS_PATH ?? join(tmpdir(), "opencode", "calculadora-nomina-verification")
const { chromium } = createRequire(join(tools, "package.json"))("playwright")
const out = join(root, "docs", "evidence", "4b1")
mkdirSync(out, { recursive: true })
const exe = join(root, "src-tauri", "target", "debug", "calculadora-nomina.exe")
const withVite = process.argv.includes("--with-vite")
const baseline = JSON.parse(readFileSync(join(out, "product-baseline.json"), "utf8"))
const exeHash = createHash("sha256").update(readFileSync(exe)).digest("hex").toUpperCase()
const observation = JSON.parse(readFileSync(join(out, "artifact-observation.json"), "utf8"))
assert.equal(exeHash, observation.observedSha256)
const previous = execFileSync("pwsh", ["-NoProfile", "-Command", "@(Get-Process -Name 'calculadora-nomina' -ErrorAction SilentlyContinue).Count"], { encoding: "utf8" }).trim()
assert.equal(previous, "0", "Hay una aplicación abierta: no se toca la sesión personal del usuario.")
let occupied = false
try { await fetch("http://127.0.0.1:9225/json/version"); occupied = true } catch { /* Puerto disponible. */ }
assert(!occupied, "Puerto de diagnóstico ocupado; no se reutiliza una sesión ajena.")
let vite, viteLog = ""
if (withVite) {
  let existingServer = false
  try { await fetch("http://127.0.0.1:1420/"); existingServer = true } catch { /* Disponible. */ }
  assert(!existingServer, "Vite personal ya está abierto; no se reutiliza ni detiene.")
  vite = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", "1420", "--strictPort"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] })
  vite.stdout.on("data", bytes => { viteLog += bytes.toString() })
  vite.stderr.on("data", bytes => { viteLog += bytes.toString() })
  let ready = false
  for (let attempt = 0; attempt < 120; attempt++) {
    if (vite.exitCode !== null) throw new Error(viteLog)
    try { if ((await fetch("http://127.0.0.1:1420/")).ok) { ready = true; break } } catch { /* Arranque local. */ }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  assert(ready, "El servidor local no abrió")
}

const report = {
  started: new Date().toISOString(), nativeTauri: true, mode: withVite ? "existing-native-debug-with-local-vite-no-recompilation" : "existing-native-debug-integrated-assets", executableSha256: exeHash,
  originalBaselineExeSha256: baseline.hashes["src-tauri/target/debug/calculadora-nomina.exe"], artifactObservation: observation,
  environment: { os: release(), architecture: process.arch, cpu: cpus()[0].model, logicalCpus: cpus().length, memoryBytes: totalmem(), availableMemoryBytesAtStart: freemem(), node: process.version },
  protocol: { measurementsPerCase: 20, warmupsPerCase: 3, clock: "real performance.now, submit to observed React commit", p95: "nearest-rank", limitsProposedIn4A: { ordinaryP95Ms: 1500, cancellationFromInputRequestMs: 250 }, externalComparisonsPerformed: false },
  cold: null, ordinary: [], warmups: [], demanding: [], cancellations: [], errors: [], consoleErrors: [], external: [], failures: [], lifecycle: {},
}
const app = spawn(exe, [], { cwd: root, env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9225 --remote-debugging-address=127.0.0.1", WEBVIEW2_USER_DATA_FOLDER: join(tools, `3b4-profile-4b1-${Date.now()}`) }, stdio: ["ignore", "pipe", "pipe"] })
let browser, page, windowPid = 0, log = ""
const assetRequests = [], embeddedAssets = []
app.stdout.on("data", v => { log += v.toString() })
app.stderr.on("data", v => { log += v.toString() })
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
function native(action = "inspect") {
  return JSON.parse(execFileSync("pwsh", ["-NoProfile", "-File", join(root, "scripts", "native-window.ps1"), "-Action", action, ...(windowPid ? ["-ProcessId", String(windowPid)] : [])], { encoding: "utf8", timeout: 30000 }))
}
function install() {
  window.__performance4b1 = null
  document.addEventListener("submit", () => {
    const r = { started: performance.now(), epoch: performance.timeOrigin + performance.now(), elapsedMs: null, frames: 0, lastFrame: performance.now(), maxFrameGapMs: 0, messages: [], clickReceivedAt: null }
    window.__performance4b1 = r
    requestAnimationFrame(function frame(now) {
      if (r.elapsedMs !== null) return
      r.frames++
      r.maxFrameGapMs = Math.max(r.maxFrameGapMs, now - r.lastFrame)
      r.lastFrame = now
      requestAnimationFrame(frame)
    })
  }, true)
  document.addEventListener("click", e => {
    if (e.target.closest("button")?.textContent.trim() === "Cancelar" && window.__performance4b1) window.__performance4b1.clickReceivedAt = performance.now()
  }, true)
  addEventListener("DOMContentLoaded", () => new MutationObserver(() => {
    const r = window.__performance4b1, section = document.querySelector(".results-section")
    if (!r || r.elapsedMs !== null || !section) return
    const message = document.getElementById("result-message")?.textContent
    if (message && r.messages.at(-1) !== message) r.messages.push(message)
    if (section.getAttribute("aria-busy") === "false") {
      const now = performance.now()
      r.elapsedMs = now - r.started
      r.maxFrameGapMs = Math.max(r.maxFrameGapMs, now - r.lastFrame)
      r.state = section.dataset.resultState
      r.activationToCommitMs = r.clickReceivedAt === null ? null : now - r.clickReceivedAt
    }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true }))
}
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return { count: sorted.length, min: sorted[0], median: sorted[Math.ceil(sorted.length / 2) - 1], p95: sorted[Math.ceil(sorted.length * 0.95) - 1], max: sorted.at(-1) }
}
async function edit() {
  await page.getByRole("button", { name: "Editar datos", exact: true }).click()
  await page.waitForFunction(() => document.activeElement?.id === "salary")
}
async function capture({ target = "13202.64", period = "monthly", imss = true, bonus = "15" } = {}) {
  if (await page.locator(".results-section").count()) await edit()
  await page.locator('input[name="fiscal-date-mode"][value="yes"]').check()
  for (const [id, value] of [["salary", target], ["period", period], ["effective-date", "2026-02-01"], ["bonus-days", bonus], ["vacation-days", "12"], ["vacation-premium", "25"]]) {
    if (id === "period") await page.locator(`#${id}`).selectOption(value)
    else await page.locator(`#${id}`).fill(value)
  }
  await page.locator(`input[name="worker-imss"][value="${imss ? "yes" : "no"}"]`).check()
}
async function submit(wait = true) {
  await page.locator("#salary").press("Enter")
  await page.locator(".results-section").waitFor()
  if (wait) await page.waitForFunction(() => window.__performance4b1?.elapsedMs != null)
}
async function result() {
  const run = await page.evaluate(() => window.__performance4b1)
  assert(run && typeof run.elapsedMs === "number", "Falta una medición completada")
  const net = page.locator('[data-inverse="obtained"]')
  return { ...run, gross: await page.locator(".primary-amount").innerText(), net: await net.count() ? await net.innerText() : null }
}

try {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (app.exitCode !== null) throw new Error(`La aplicación terminó: ${log}`)
    try { browser = await chromium.connectOverCDP("http://127.0.0.1:9225"); break } catch { await delay(250) }
  }
  assert(browser, "No se abrió WebView2")
  report.webview2 = await (await fetch("http://127.0.0.1:9225/json/version")).json()
  for (let attempt = 0; attempt < 100; attempt++) {
    page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith(withVite ? "http://127.0.0.1:1420" : "http://tauri.localhost"))
    if (page) break
    await delay(100)
  }
  assert(page, "Falta la página integrada Tauri")
  report.url = page.url()
  page.on("pageerror", e => report.errors.push(e.message))
  page.on("console", e => { if (e.type() === "error") report.consoleErrors.push(e.text()) })
  page.on("request", r => { if (!/^(?:http:\/\/(?:tauri\.localhost|ipc\.localhost|127\.0\.0\.1:1420)\/|data:|ipc:)/.test(r.url())) report.external.push(r.url()) })
  page.on("response", response => {
    if (/\/assets\/.*\.(?:js|css)(?:\?|$)/.test(response.url())) assetRequests.push((async () => {
      const bytes = await response.body()
      embeddedAssets.push({ url: response.url(), sha256: createHash("sha256").update(bytes).digest("hex").toUpperCase() })
    })())
  })
  await page.addInitScript(install)
  await page.reload({ waitUntil: "networkidle" })
  await Promise.all(assetRequests)
  report.embeddedAssets = embeddedAssets
  if (!withVite) {
    const approvedJs = Object.entries(baseline.hashes).find(([name]) => name.startsWith("dist/assets/") && name.endsWith(".js"))[1]
    assert(embeddedAssets.some(asset => /\.js$/.test(asset.url) && asset.sha256 === approvedJs), "El JavaScript embebido no coincide con el baseline del producto")
  }
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled)
  assert(await page.evaluate(() => typeof window.__TAURI_INTERNALS__ === "object"), "No es el WebView2 de Tauri")
  report.nativeWindow = native()
  windowPid = report.nativeWindow.pid
  report.lifecycle.opened = true
  report.viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio, zoom: visualViewport.scale }))
  await capture(); await submit()
  report.cold = await result()
  const cases = [
    { id: "E", target: "13202.64", period: "monthly", imss: true },
    { id: "F", target: "13597.18", period: "monthly", imss: false },
    { id: "G", target: "3076.67", period: "weekly", imss: true },
    { id: "H", target: "6592.87", period: "fortnightly", imss: true },
    { id: "I", target: "10500.00", period: "monthly", imss: true },
  ]
  for (const c of cases) {
    const samples = []
    for (let repetition = -3; repetition < 20; repetition++) {
      await capture(c); await submit()
      const run = await result()
      if (repetition < 0) report.warmups.push({ case: c.id, ...run })
      else samples.push({ repetition: repetition + 1, ...run })
    }
    const summary = { case: c.id, request: c, samples, elapsed: stats(samples.map(s => s.elapsedMs)), maximumFrameGapMs: Math.max(...samples.map(s => s.maxFrameGapMs)), proposedTimeCriterionMet: stats(samples.map(s => s.elapsedMs)).p95 <= 1500, exactOutcomes: samples.filter(s => s.state === "exact").length }
    report.ordinary.push(summary)
    console.log(JSON.stringify({ case: c.id, ...summary.elapsed, maximumFrameGapMs: summary.maximumFrameGapMs, exactOutcomes: summary.exactOutcomes }))
  }
  for (let repetition = 0; repetition < 3; repetition++) {
    await capture({ bonus: "365000000" }); await submit(false)
    const ping = repetition === 0 ? native() : null
    await page.waitForFunction(() => window.__performance4b1?.elapsedMs != null)
    report.demanding.push({ repetition: repetition + 1, ...(await result()), nativeProbe: ping })
  }
  for (let repetition = 0; repetition < 20; repetition++) {
    await capture({ bonus: "365000000" }); await submit(false)
    const box = await page.getByRole("button", { name: "Cancelar", exact: true }).boundingBox()
    assert(box, "Cancelar no está disponible durante la búsqueda")
    const requestAt = performance.now()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForFunction(() => document.querySelector(".results-section")?.dataset.resultState === "cancelled")
    const fromInputRequestMs = performance.now() - requestAt
    const sample = await result()
    assert.equal(sample.state, "cancelled")
    report.cancellations.push({ repetition: repetition + 1, fromInputRequestMs, ...sample })
  }
  report.cancellationSummary = stats(report.cancellations.map(s => s.fromInputRequestMs))
  report.acceptance = { ordinaryP95: report.ordinary.every(c => c.proposedTimeCriterionMet), cancellationEverySampleUnder250ms: report.cancellations.every(s => s.fromInputRequestMs <= 250), cancellationP95Under250ms: report.cancellationSummary.p95 <= 250, windowHung: report.demanding.some(s => s.nativeProbe?.hung), calculatorErrors: report.errors.length + report.consoleErrors.length, technicalComparisonToApproved4AOnly: true }
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.consoleErrors, [])
  assert.deepEqual(report.external, [])
  assert(native("close").posted)
  for (let attempt = 0; attempt < 30; attempt++) {
    const alive = execFileSync("pwsh", ["-NoProfile", "-Command", `@(Get-Process -Id ${windowPid} -ErrorAction SilentlyContinue).Count`], { encoding: "utf8" }).trim()
    if (alive === "0") { report.lifecycle.closedNormally = true; break }
    await delay(100)
  }
  assert(report.lifecycle.closedNormally)
} catch (error) {
  report.failures.push(error.stack ?? String(error))
  process.exitCode = 1
} finally {
  if (browser) await browser.close().catch(() => {})
  if (app.exitCode === null) { try { execFileSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "pipe" }) } catch { /* Ya finalizó. */ } }
  if (vite && vite.exitCode === null) vite.kill()
  report.finished = new Date().toISOString()
  const priorPath = join(out, "native-performance.json")
  if (existsSync(priorPath)) {
    const prior = JSON.parse(readFileSync(priorPath, "utf8"))
    if (prior.failures.length) writeFileSync(join(out, "native-initial-probe.json"), JSON.stringify(prior, null, 2))
  }
  writeFileSync(join(out, "native-performance.json"), JSON.stringify(report, null, 2))
  writeFileSync(join(out, "native-performance.log"), log)
  if (withVite) writeFileSync(join(out, "native-performance-vite.log"), viteLog)
  console.log(JSON.stringify({ lifecycle: report.lifecycle, cancellation: report.cancellationSummary, acceptance: report.acceptance, failures: report.failures, report: join(out, "native-performance.json") }, null, 2))
}
