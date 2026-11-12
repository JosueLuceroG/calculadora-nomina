import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
const root = fileURLToPath(new URL("../", import.meta.url)), out = join(root, "docs/evidence/5d2b")
const baseline = join(out, "product-baseline.json")
const allowed = ["src/features/calculator/fiscal-adapter.ts", "src/features/calculator/calculation-controller.ts", "src/app/App.tsx",
  "src/features/storage/snapshot.ts", "src/features/storage/storage-api.ts", "src/features/history/historical-snapshot.ts", "src/features/history/history-controller.ts", "src/features/history/history-section.tsx",
  "src/features/pdf/document-model.ts", "src/features/pdf/report-model.ts", "src/features/pdf/render-report.ts", "src-tauri/src/storage/mod.rs", "src-tauri/src/storage/validation.rs", "src-tauri/src/storage/tests.rs",
  "src/tests/fiscal-runtime-isolation.test.ts", "src/features/storage/storage.test.ts", "src/features/pdf/pdf.test.ts", "src/features/pdf/report.test.tsx", "src/features/history/history.test.tsx"]
const hash = bytes => createHash("sha256").update(bytes).digest("hex")
function walk(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(e => ["target", "node_modules", ".git"].includes(e.name) ? [] : e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]) }
if (process.argv.includes("--capture")) {
  assert(!existsSync(baseline), "Refusing to overwrite baseline")
  mkdirSync(out, { recursive: true })
  const paths = ["src", "src-tauri", "scripts", "design", "docs/evidence/5c2/legacy"].flatMap(p => walk(join(root, p)))
  paths.push(...["package.json", "package-lock.json", "src/features/storage/build-identity.json", "docs/evidence/5c2/independent-controls.json"].map(p => join(root, p)))
  writeFileSync(baseline, JSON.stringify({ capturedOn: new Date().toISOString(), allowed, hashes: Object.fromEntries([...new Set(paths)].sort().map(p => [relative(root, p).replaceAll("\\", "/"), hash(readFileSync(p))])) }, null, 2) + "\n")
  const legacy = JSON.parse(readFileSync(join(root, "docs/evidence/5c2/legacy/storage-fixtures.json"), "utf8"))
  const qa = JSON.parse(readFileSync(join(root, "docs/evidence/5d2a/native-verification.json"), "utf8"))
  assert(qa.storageRoot.includes("5b7-5d2a-"), "Only the previous QA database is allowed")
  const database = join(qa.storageRoot, "payroll.sqlite3")
  const python = "import sqlite3,json,sys; c=sqlite3.connect('file:'+sys.argv[1].replace('\\\\','/')+'?mode=ro',uri=True); print(json.dumps({'version':c.execute('pragma user_version').fetchone()[0],'rows':[{'name':'contextual-schema1-'+r[0],'payload':r[1],'checksum':r[2]} for r in c.execute('select execution_id,payload,payload_sha256 from simulations')],'preferences':c.execute('select * from preferences').fetchall(),'generation':c.execute('select generation from store_meta').fetchone()[0]},ensure_ascii=True))"
  const contextual = JSON.parse(execFileSync("python", ["-c", python, database], { encoding: "utf8" }))
  assert.equal(contextual.version, 2)
  assert(contextual.rows.length > 0)
  for (const row of contextual.rows) { assert.equal(hash(Buffer.from(row.payload)), row.checksum); assert.equal(JSON.parse(row.payload).value.schemaVersion, 1) }
  const corpus = [...legacy, ...contextual.rows].map(row => ({ ...row, checksum: hash(Buffer.from(row.payload)) }))
  writeFileSync(join(out, "originals-v1.json"), JSON.stringify(corpus, null, 2) + "\n")
  writeFileSync(join(out, "qa-source.json"), JSON.stringify({ database, ...contextual, rows: contextual.rows.map(r => ({ name: r.name, checksum: r.checksum })) }, null, 2) + "\n")
  console.log(JSON.stringify({ baseline: Object.keys(JSON.parse(readFileSync(baseline)).hashes).length, originals: corpus.length, qaSchema: contextual.version }))
} else {
  const before = JSON.parse(readFileSync(baseline, "utf8"))
  const changed = Object.entries(before.hashes).filter(([p, h]) => !existsSync(join(root, p)) || hash(readFileSync(join(root, p))) !== h).map(([p]) => p)
  const result = { checkedOn: new Date().toISOString(), checked: Object.keys(before.hashes).length, changed, unauthorized: changed.filter(p => !before.allowed.includes(p)) }
  writeFileSync(join(out, "product-integrity.json"), JSON.stringify(result, null, 2) + "\n")
  console.log(JSON.stringify(result)); assert.deepEqual(result.unauthorized, [])
}
