// Evidencia: motores/datos/imagen/configuración protegidos, sin tocar binarios.
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import assert from "node:assert/strict"
const root = fileURLToPath(new URL("../", import.meta.url))
const moneyMilestone = process.argv.includes("--5b3")
const resultsMilestone = process.argv.includes("--5b4")
const parametersMilestone = process.argv.includes("--5b5")
const helpMilestone = process.argv.includes("--5b6")
const out = join(root, "docs", "evidence", helpMilestone ? "5b6" : parametersMilestone ? "5b5" : resultsMilestone ? "5b4" : moneyMilestone ? "5b3" : process.argv.includes("--5b2") ? "5b2" : "5b1")
mkdirSync(out, { recursive: true })
const path = join(out, "protected-baseline.json")
function files(folder) { return readdirSync(folder, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(folder, e.name)) : [join(folder, e.name)]) }
const hash = file => createHash("sha256").update(readFileSync(file)).digest("hex").toUpperCase()
if (process.argv.includes("--before")) {
  assert(!existsSync(path), "No sobrescribir baseline")
  const paths = [...files(join(root, "src", "domain", "payroll")), ...files(join(root, "src", "infrastructure", "fiscal")), ...["design/UI_APROBADA.png", "src-tauri/tauri.conf.json", "src-tauri/src/lib.rs", "src-tauri/src/window_layout.rs", "package.json", "package-lock.json"].map(p => join(root, p))]
  if (moneyMilestone || resultsMilestone || parametersMilestone || helpMilestone) paths.push(...["calculation-controller.ts", "fiscal-adapter.ts", "date-policy.ts", "validation.ts", "form.ts"].map(p => join(root, "src", "features", "calculator", p)))
  if (resultsMilestone || parametersMilestone || helpMilestone) paths.push(...["money-editing.ts", "format.ts", "components/money-input.tsx", "components/preview-field.tsx", "components/capture-section.tsx", "components/fiscal-date-control.tsx"].map(p => join(root, "src", "features", "calculator", p)))
  if (parametersMilestone || helpMilestone) paths.push(...["results.ts", "components/results-section.tsx", "components/result-summary.tsx", "components/result-details.tsx", "components/result-amount.tsx", "components/inverse-feedback.tsx", "components/calculation-feedback.tsx", "components/result-presentation.ts", "components/technical-result-details.tsx", "components/capture-summary.tsx"].map(p => join(root, "src", "features", "calculator", p)))
  if (helpMilestone) paths.push(...["src/features/parameters/parameter-catalog.ts", "src/features/parameters/source-review.json", "src/features/parameters/official-source-link.ts", "src-tauri/src/official_sources.rs", "src-tauri/target/debug/calculadora-nomina.exe", "src/tests/fixtures/operational-4b1.expected.json", "src/tests/fixtures/net-to-gross.expected.json", "src/tests/fixtures/gross-to-net.expected.csv"].map(p => join(root, p)))
  writeFileSync(path, JSON.stringify({ capturedOn: new Date().toISOString(), hashes: Object.fromEntries(paths.map(p => [relative(root, p).replaceAll("\\", "/"), hash(p)])) }, null, 2))
} else if (parametersMilestone && process.argv.includes("--record-native-source-integration")) {
  const baseline = JSON.parse(readFileSync(path, "utf8"))
  const changed = Object.entries(baseline.hashes).filter(([p, h]) => hash(join(root, p)) !== h).map(([p]) => p)
  assert.deepEqual(changed, ["src-tauri/src/lib.rs"], "Solo el registro de apertura nativa puede cambiar entre los archivos del baseline")
  const record = join(out, "native-source-integration.json")
  assert(!existsSync(record), "No sobrescribir declaración de integración")
  const added = "src-tauri/src/official_sources.rs"
  writeFileSync(record, JSON.stringify({ recordedOn: new Date().toISOString(), reason: "Wry bloquea target=_blank sin manejador; comando mínimo para abrir publicaciones oficiales en el navegador de Windows, por clic explícito.", changes: changed.map(p => ({ path: p, before: baseline.hashes[p], after: hash(join(root, p)) })), addedFiles: { [added]: hash(join(root, added)) } }, null, 2))
} else {
  const baseline = JSON.parse(readFileSync(path, "utf8"))
  const differences = Object.entries(baseline.hashes).filter(([p, h]) => hash(join(root, p)) !== h).map(([p]) => p)
  const declaredPath = join(out, "native-source-integration.json")
  const declared = parametersMilestone && existsSync(declaredPath) ? JSON.parse(readFileSync(declaredPath, "utf8")) : null
  if (declared) {
    assert.deepEqual(declared.changes.map(item => item.path), ["src-tauri/src/lib.rs"])
    for (const change of declared.changes) { assert.equal(change.before, baseline.hashes[change.path]); assert.equal(hash(join(root, change.path)), change.after) }
    for (const [p, h] of Object.entries(declared.addedFiles)) assert.equal(hash(join(root, p)), h)
  }
  const unexplained = differences.filter(p => !declared?.changes.some(item => item.path === p))
  const report = { checkedOn: new Date().toISOString(), protectedFiles: Object.keys(baseline.hashes).length, differences, declaredNativeIntegration: declared, unexplainedDifferences: unexplained }
  writeFileSync(join(out, "protected-final.json"), JSON.stringify(report, null, 2))
  assert.deepEqual(unexplained, [])
  console.log(JSON.stringify(report))
}
