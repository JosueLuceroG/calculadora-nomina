// Evidence only: records existing inputs before the two authorized source edits.
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join, relative } from "node:path"
const root = fileURLToPath(new URL("../", import.meta.url))
const evidence = join(root, "docs/evidence/5d2a")
const baselinePath = join(evidence, "product-baseline.json")
const allowed = ["src/infrastructure/fiscal/package-provider.ts", "src/features/calculator/fiscal-adapter.ts"]
const sha = path => createHash("sha256").update(readFileSync(path)).digest("hex")
function walk(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    if (["target", "node_modules", ".git"].includes(entry.name)) return []
    const child = join(path, entry.name)
    return entry.isDirectory() ? walk(child) : [child]
  })
}
if (process.argv.includes("--capture")) {
  if (existsSync(baselinePath)) throw new Error("Baseline already exists; refusing to replace it")
  const paths = ["src", "src-tauri", "scripts", "design"].filter(p => existsSync(join(root, p))).flatMap(p => walk(join(root, p)))
  paths.push(...["package.json", "package-lock.json", "tsconfig.app.json", "vite.config.ts"].filter(p => existsSync(join(root, p))).map(p => join(root, p)))
  // Immutable fiscal oracles and legacy originals, not regenerated test reports.
  for (const p of ["docs/evidence/5c2/independent-controls.json", "docs/evidence/5c2/legacy", "docs/evidence/4b1/operational-4b1.expected.json"]) {
    if (!existsSync(join(root, p))) continue
    paths.push(...(p.endsWith(".json") ? [join(root, p)] : walk(join(root, p))))
  }
  const hashes = Object.fromEntries([...new Set(paths)].sort().map(p => [relative(root, p).replaceAll("\\", "/"), sha(p)]))
  mkdirSync(evidence, { recursive: true })
  writeFileSync(baselinePath, JSON.stringify({ capturedOn: new Date().toISOString(), allowed, hashes }, null, 2) + "\n")
  console.log(JSON.stringify({ captured: Object.keys(hashes).length, allowed }))
} else {
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"))
  const changed = Object.entries(baseline.hashes).filter(([p, hash]) => !existsSync(join(root, p)) || sha(join(root, p)) !== hash).map(([p]) => p)
  const unauthorized = changed.filter(p => !baseline.allowed.includes(p))
  const result = { checkedOn: new Date().toISOString(), checked: Object.keys(baseline.hashes).length, changed, unauthorized }
  writeFileSync(join(evidence, "product-integrity.json"), JSON.stringify(result, null, 2) + "\n")
  console.log(JSON.stringify(result))
  if (unauthorized.length) process.exitCode = 1
}
