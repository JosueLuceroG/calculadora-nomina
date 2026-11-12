import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { build } from "esbuild"
const root = fileURLToPath(new URL("../", import.meta.url))
const result = await build({ stdin: { contents: 'export {createEmbeddedFiscalRegistry2026} from "./src/infrastructure/fiscal/package-registry.ts"; export {ENGINE_FISCAL_CAPABILITIES} from "./src/infrastructure/fiscal/engine-capabilities.ts"; export {standardGrossToNetContext2026} from "./src/infrastructure/fiscal/2026.ts";', resolveDir: root }, bundle: true, platform: "node", format: "esm", write: false })
const module = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`)
const manifest = module.createEmbeddedFiscalRegistry2026().entries[0].manifest
const context = module.standardGrossToNetContext2026()
const roles = { isrTariff: "isrTariffs", uma: "uma", minimumWages: "minimumWages", subsidy: "subsidy", imssConstants: "imssConstants", contractualDivisors: "contractualDivisors", laborBenefitMinima: "laborBenefitMinima" }
const descriptor = { producerId: "nomina-contextual-2026-5d2b-v1", reportContractId: "standard-payroll-2026-contextual-v2", presentationContractId: "nomina-presentation-5c2-v1",
  versions: (({ applicationVersion, engineVersion }) => ({ application: applicationVersion, engine: engineVersion }))(JSON.parse(readFileSync(join(root, "src/features/storage/build-identity.json"), "utf8"))),
  manifest, authorization: module.ENGINE_FISCAL_CAPABILITIES.authorizations[0], packageRegistryRevision: "embedded-package-registry-5d2a-v1", capabilityRegistryVersion: module.ENGINE_FISCAL_CAPABILITIES.registryVersion,
  effectiveSeries: Object.entries(roles).flatMap(([role, key]) => context[key].map(({ data: _, ...set }) => ({ role, ...set }))),
  ruleSources: { subsidy: context.subsidyRulesSources, retention: context.retentionRuleSources },
}
const text = JSON.stringify(descriptor, null, 2) + "\n", target = join(root, "src/infrastructure/fiscal/document-producer.json")
if (process.argv.includes("--check")) assert.equal(readFileSync(target, "utf8"), text)
else { assert(!process.argv.includes("--check")); writeFileSync(target, text) }
console.log(JSON.stringify({ producerId: descriptor.producerId, effectiveSeries: descriptor.effectiveSeries.length, mode: process.argv.includes("--check") ? "checked" : "projected" }))
