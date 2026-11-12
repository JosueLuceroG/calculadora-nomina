// Huellas de la base histórica y coherencia de la emisión actual, sin cálculo.
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { build } from "esbuild"
import assert from "node:assert/strict"
const root = fileURLToPath(new URL("../", import.meta.url))
const sha = value => createHash("sha256").update(value).digest("hex")
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)
const bundle = await build({ stdin: { contents: 'export { FISCAL_PARAMETERS_2026 as registry } from "./src/infrastructure/fiscal/2026.ts"; export { EMBEDDED_DOCUMENT_REGISTRY as documents } from "./src/features/documents/embedded-document-registry.ts"; import { createEmbeddedFiscalRegistry2026 } from "./src/infrastructure/fiscal/package-registry.ts"; export const activeRegistry = createEmbeddedFiscalRegistry2026()', resolveDir: root }, bundle: true, platform: "node", format: "esm", write: false })
const { registry, documents, activeRegistry } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`)
const historicalProducer = JSON.parse(readFileSync(join(root, "src/infrastructure/fiscal/document-producer.json")))
const applicationVersion = JSON.parse(readFileSync(join(root, "package.json"))).version
const modules = readdirSync(join(root, "src/domain/payroll")).filter(p => p.endsWith(".ts") && !p.endsWith(".test.ts")).sort().map(p => ({ path: `src/domain/payroll/${p}`, sha256: sha(readFileSync(join(root, "src/domain/payroll", p))) }))
const sets = [registry.isrTariffs, registry.uma, registry.minimumWages, registry.subsidy, registry.imssConstants, registry.contractualDivisors, registry.laborBenefitMinima].flat().map(s => ({ id: s.id, version: s.version }))
const identity = { applicationVersion: historicalProducer.versions.application, engineVersion: `payroll-js-sha256:${sha(canonical(modules))}`, fiscalPackage: { id: registry.version, version: registry.version, sha256: sha(canonical(registry)), exercise: registry.exercise, supportedDates: registry.supportedDates, parameterSets: sets }, engineModules: modules }
const text = JSON.stringify(identity, null, 2) + "\n", target = join(root, "src/features/storage/build-identity.json")
if (process.argv.includes("--check")) {
  // Full original comparison remains; neither the pin nor its producer is rewritten.
  assert.equal(readFileSync(target, "utf8"), text)
  const release = JSON.parse(readFileSync(join(root, "src/infrastructure/fiscal/document-producer-0.1.1-rc.1.json")))
  assert.equal(release.baseDescriptorSha256, sha(readFileSync(join(root, "src/infrastructure/fiscal/document-producer.json"))), "HISTORICAL_PRODUCER_BASE_CHANGED")
  assert.equal(documents.active.length, activeRegistry.entries.length)
  for (const { manifest } of activeRegistry.entries) {
    const selected = documents.active.filter(d => canonical(d.manifest) === canonical(manifest))
    assert.equal(selected.length, 1, "ACTIVE_DOCUMENT_PRODUCER_MISMATCH")
    assert.equal(selected[0].versions.application, applicationVersion, "APPLICATION_VERSION_MISMATCH")
    assert.equal(selected[0].versions.engine, identity.engineVersion, "ENGINE_VERSION_MISMATCH")
  }
}
else writeFileSync(target, text)
console.log(JSON.stringify({ mode: process.argv.includes("--check") ? "checked" : "projected", applicationVersion, historicalApplicationVersion: identity.applicationVersion, activeProducers: documents.active.map(d => d.producerId), engineVersion: identity.engineVersion, fiscalPackage: identity.fiscalPackage.id, sha256: identity.fiscalPackage.sha256 }))
