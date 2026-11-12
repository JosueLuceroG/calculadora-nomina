import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import assert from "node:assert/strict"
const root = fileURLToPath(new URL("../", import.meta.url)), out = join(root, "docs/evidence/5b7")
mkdirSync(out, { recursive: true })
const file = join(out, "protected-baseline.json")
const hash = p => createHash("sha256").update(readFileSync(join(root, p))).digest("hex").toUpperCase()
const tree = dir => readdirSync(join(root, dir), { withFileTypes: true }).flatMap(e => e.isDirectory() ? tree(join(dir, e.name)) : [join(dir, e.name).replaceAll("\\", "/")])
const integration = ["src-tauri/src/lib.rs", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"]
if (process.argv.includes("--before")) {
  assert(!existsSync(file))
  const paths = [...tree("src"), "design/UI_APROBADA.png", "src-tauri/tauri.conf.json", "src-tauri/src/window_layout.rs", "src-tauri/src/official_sources.rs", "package.json", "package-lock.json"]
  writeFileSync(file, JSON.stringify({ capturedOn: new Date().toISOString(), hashes: Object.fromEntries(paths.map(p => [p, hash(p)])), integrationBefore: Object.fromEntries(integration.map(p => [p, hash(p)])) }, null, 2))
} else {
  const baseline = JSON.parse(readFileSync(file, "utf8"))
  const differences = Object.entries(baseline.hashes).filter(([p, h]) => hash(p) !== h).map(([p]) => p)
  const report = { checkedOn: new Date().toISOString(), protectedFiles: Object.keys(baseline.hashes).length, differences, declaredIntegration: integration.map(p => ({ path: p, before: baseline.integrationBefore[p], after: hash(p) })) }
  writeFileSync(join(out, "protected-final.json"), JSON.stringify(report, null, 2)); assert.deepEqual(differences, [])
  console.log(JSON.stringify(report))
}
