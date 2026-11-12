// Consulta de desarrollo explícita. La aplicación nunca ejecuta este script.
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import assert from "node:assert/strict"
const root = fileURLToPath(new URL("../", import.meta.url))
const previous = JSON.parse(readFileSync(join(root, "docs/evidence/4b1/sources.json"), "utf8"))
const ids = ["isr-dof", "isr-sat", "uma-2025", "uma-2026", "minimum-2026", "subsidy-2026", "subsidy-2024", "subsidy-amendment-2025", "lss", "lisr", "lft", "uma-deindexation"]
const allowedHosts = new Set(["sidof.segob.gob.mx", "www.sat.gob.mx", "www.inegi.org.mx", "www.diputados.gob.mx"])
const out = join(root, "docs/evidence/5b5")
const cache = join(tmpdir(), "opencode", "calculadora-nomina-verification", "5b5-official")
mkdirSync(out, { recursive: true }); mkdirSync(cache, { recursive: true })
const sha = bytes => createHash("sha256").update(bytes).digest("hex").toUpperCase()
const records = await Promise.all(ids.map(async id => {
  const old = previous.records.find(record => record.id === id)
  assert(old?.status === 200 && old.sha256)
  assert(new URL(old.url).protocol === "https:" && allowedHosts.has(new URL(old.url).hostname))
  const queriedOn = new Date().toISOString()
  try {
    const response = await fetch(old.url, { signal: AbortSignal.timeout(60000) })
    const bytes = Buffer.from(await response.arrayBuffer())
    const hash = sha(bytes), officialFinal = allowedHosts.has(new URL(response.url).hostname)
    const unchanged = hash === old.sha256
    writeFileSync(join(cache, old.cacheFile), bytes)
    return { id, url: old.url, queriedOn, finalUrl: response.url, httpStatus: response.status,
      contentType: response.headers.get("content-type"), bytes: bytes.length, sha256: hash,
      previousSha256: old.sha256, previousVerifiedOn: old.queriedOn.slice(0, 10), unchangedFrom4b1: unchanged,
      status: response.ok && officialFinal && unchanged ? "verified" : "pending-review",
      note: !response.ok ? "Consulta HTTP no satisfactoria." : !officialFinal ? "Destino final requiere revisión." : !unchanged ? "Documento distinto al original 4B.1; no se actualiza el paquete fiscal." : "Mismo documento que el revisado en 4B.1, incluidas sus vigencias." }
  } catch (error) {
    return { id, url: old.url, queriedOn, previousVerifiedOn: old.queriedOn.slice(0, 10), status: "pending-review", note: error.message }
  }
}))
const result = { milestone: "5B.5", scope: "URL y documento cotejados contra originales revisados en 4B.1; no aprobación fiscal nueva", records }
writeFileSync(join(out, "source-checks.json"), JSON.stringify({ ...result, cache }, null, 2))
if (process.argv.includes("--publish")) {
  // Único artefacto público generado; no toca sources.ts ni parámetros del motor.
  writeFileSync(join(root, "src/features/parameters/source-review.json"), JSON.stringify(result, null, 2))
}
console.log(JSON.stringify({ checked: records.length, verified: records.filter(r => r.status === "verified").length, pending: records.filter(r => r.status !== "verified").map(r => ({ id: r.id, note: r.note })), evidence: "docs/evidence/5b5/source-checks.json" }, null, 2))
