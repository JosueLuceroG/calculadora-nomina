// Evidencia de prueba: no importa motores ni modifica el producto personal.
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import assert from "node:assert/strict"

const root = fileURLToPath(new URL("../", import.meta.url))
const evidence = join(root, "docs", "evidence", "4b1")
const cache = join(tmpdir(), "opencode", "calculadora-nomina-verification", "4b1-official")
mkdirSync(evidence, { recursive: true })
const sha = bytes => createHash("sha256").update(bytes).digest("hex").toUpperCase()
function tree(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? ["target", "gen"].includes(entry.name) ? [] : tree(join(folder, entry.name)) : [join(folder, entry.name)])
}
const manifest = join(evidence, "product-baseline.json")
if (process.argv[2] === "snapshot") {
  assert(!existsSync(manifest), "El baseline existente no se sobrescribe.")
  const paths = ["src", "src-tauri", "design", "dist"].flatMap(name => tree(join(root, name)))
  paths.push(...["index.html", "package.json", "package-lock.json", "vite.config.ts", "tsconfig.app.json", "tsconfig.node.json", "src-tauri/target/debug/calculadora-nomina.exe"].map(name => join(root, name)))
  const hashes = Object.fromEntries(paths.map(path => [relative(root, path).replaceAll("\\", "/"), sha(readFileSync(path))]))
  writeFileSync(manifest, JSON.stringify({ capturedOn: new Date().toISOString(), hashes }, null, 2))
  console.log(JSON.stringify({ protectedFiles: Object.keys(hashes).length, manifest }))
} else if (process.argv[2] === "observe-artifact") {
  const before = JSON.parse(readFileSync(manifest, "utf8"))
  const executable = "src-tauri/target/debug/calculadora-nomina.exe"
  const changed = Object.entries(before.hashes).filter(([name, old]) => sha(readFileSync(join(root, name))) !== old).map(([name]) => name)
  assert(changed.every(name => name === executable), "Hay cambios de fuente/configuración; detener y revisar.")
  const observation = { observedOn: new Date().toISOString(), executable, baselineSha256: before.hashes[executable], observedSha256: sha(readFileSync(join(root, executable))), lastWriteTimeUtc: statSync(join(root, executable)).mtime.toISOString(), observedChanges: changed, sourcesAndDistUnchanged: true, handling: "Preserved as found; cause not attributed; no executable build/copy/restore performed by this validation." }
  writeFileSync(join(evidence, "artifact-observation.json"), JSON.stringify(observation, null, 2))
  console.log(JSON.stringify(observation, null, 2))
} else if (process.argv[2] === "integrity") {
  const before = JSON.parse(readFileSync(manifest, "utf8"))
  const changes = Object.entries(before.hashes).filter(([name, hash]) => !existsSync(join(root, name)) || sha(readFileSync(join(root, name))) !== hash).map(([name]) => name)
  const observationPath = join(evidence, "artifact-observation.json")
  const observation = existsSync(observationPath) ? JSON.parse(readFileSync(observationPath, "utf8")) : null
  const unexplainedChanges = changes.filter(name => !observation || name !== observation.executable || sha(readFileSync(join(root, name))) !== observation.observedSha256)
  const result = { checkedOn: new Date().toISOString(), protectedFiles: Object.keys(before.hashes).length, changesFromOriginalBaseline: changes, artifactObservation: observation, unexplainedChanges }
  writeFileSync(join(evidence, "product-integrity.json"), JSON.stringify(result, null, 2))
  assert.deepEqual(unexplainedChanges, [], "Se alteraron fuentes o el artefacto desde la observación.")
  console.log(JSON.stringify(result, null, 2))
} else if (["sources", "sources-delta", "sources-review", "sources-followup"].includes(process.argv[2])) {
  mkdirSync(cache, { recursive: true })
  const sources = process.argv[2] === "sources-followup" ? [
    ["sat-1st-rmf-july9", "https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/rmf/1aRM_RMF2026.pdf"],
    ["sat-2nd-rmf-oct1", "https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/rmf/2aRM_RMF2026_01102026.pdf"],
  ] : process.argv[2] === "sources-review" ? [
    ["sat-rmf-2026-index", "https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/normatividad_rmf_rgce2026.html"],
    ["sat-anticipated-4th-oct15", "https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/anticipadas/4aRM_RMF2026-Segunda_version_anticipada_15102026.pdf"],
    ["sat-annex7-oct2", "https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/anexos/Anexo7_PrimeraModificacionRMF2026_DOF_02102026.pdf"],
    ["sat-3rd-rmf-oct2", "https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/rmf/3aRM_RMF2026_DOF_02102026.pdf"],
    ["sat-rmf-base", "https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/rmf/RMF_2026-DOF-28122025.pdf"],
    ["racerf", "https://www.imss.gob.mx/sites/all/statics/pdf/reglamentos/4046_RLSSMACERF.pdf"],
    ["sua-official", "https://www.imss.gob.mx/patrones/sua"],
    ["imss-procedure-sbc-sua", "https://www.imss.gob.mx/sites/all/statics/pdf/procedimientos/1A42-B03-012.pdf"],
  ] : process.argv[2] === "sources-delta" ? [
    ["uma-deindexation", "https://sidof.segob.gob.mx/notas/docFuente/5423663"],
    ["sidof-13", "https://sidof.segob.gob.mx/welcome/13-10-2026"],
    ["sidof-14", "https://sidof.segob.gob.mx/welcome/14-10-2026"],
    ["sidof-15", "https://sidof.segob.gob.mx/welcome/15-10-2026"],
    ["sat-normativity", "https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/index.html"],
  ] : [
    ["isr-dof", "https://sidof.segob.gob.mx/notas/docFuente/5777219"],
    ["isr-sat", "https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/anexos/Anexo-8-RMF-2026_DOF-28122025.pdf"],
    ["subsidy-2026", "https://sidof.segob.gob.mx/notas/docFuente/5777649"],
    ["subsidy-2024", "https://sidof.segob.gob.mx/notas/docFuente/5725287"],
    ["subsidy-amendment-2025", "https://sidof.segob.gob.mx/notas/docFuente/5746529"],
    ["minimum-2026", "https://sidof.segob.gob.mx/notas/docFuente/5775534"],
    ["uma-2025", "https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2025/uma/uma2025.pdf"],
    ["uma-2026", "https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2026/uma/uma2026.pdf"],
    ["lss", "https://www.diputados.gob.mx/LeyesBiblio/pdf/LSS.pdf"],
    ["lisr", "https://www.diputados.gob.mx/LeyesBiblio/pdf/LISR.pdf"],
    ["lft", "https://www.diputados.gob.mx/LeyesBiblio/pdf/LFT.pdf"],
    ["lss-reforms", "https://www.diputados.gob.mx/LeyesBiblio/ref/lss.htm"],
    ["lisr-reforms", "https://www.diputados.gob.mx/LeyesBiblio/ref/lisr.htm"],
    ["lft-reforms", "https://www.diputados.gob.mx/LeyesBiblio/ref/lft.htm"],
    ["sidof-cutoff", "https://sidof.segob.gob.mx/"],
  ]
  const records = await Promise.all(sources.map(async ([id, url]) => {
    const queriedOn = new Date().toISOString()
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60000) })
      const bytes = Buffer.from(await response.arrayBuffer())
      const pdf = bytes.subarray(0, 4).toString() === "%PDF"
      const name = `${id}.${pdf ? "pdf" : "html"}`
      writeFileSync(join(cache, name), bytes)
      return { id, url, queriedOn, finalUrl: response.url, status: response.status, contentType: response.headers.get("content-type"), sha256: sha(bytes), bytes: bytes.length, cacheFile: name }
    } catch (error) { return { id, url, queriedOn, error: error.message } }
  }))
  const previousRecords = process.argv[2] !== "sources" ? JSON.parse(readFileSync(join(evidence, "sources.json"), "utf8")).records.filter(item => !records.some(next => next.id === item.id)) : []
  writeFileSync(join(evidence, "sources.json"), JSON.stringify({ cache, records: [...previousRecords, ...records] }, null, 2))
  console.log(JSON.stringify({ cache, records }, null, 2))
} else throw new Error("Usa snapshot, sources o integrity.")
