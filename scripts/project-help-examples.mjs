// Proyección documental de fixtures existentes. No importa motores ni realiza
// operaciones fiscales/monetarias. Evita incluir sus tablas normativas en Ayuda.
import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import assert from "node:assert/strict"
const sourceFile = "src/tests/fixtures/operational-4b1.expected.json"
const root = new URL("../", import.meta.url)
const bytes = readFileSync(new URL(sourceFile, root))
const fixture = JSON.parse(bytes)
const on = fixture.direct.find(item => item.id === "M01-on")
const off = fixture.direct.find(item => item.id === "M01-off")
const inverse = fixture.inverse.find(item => item.id === "M09-week")
assert(on && off && inverse)
assert.deepEqual({ ...off.request, includeImss: true }, on.request)
assert.equal(off.expected.components.isrWithheld, on.expected.components.isrWithheld)
const c = on.expected.components
const projected = {
  provenance: { sourceFile, sourceSha256: createHash("sha256").update(bytes).digest("hex").toUpperCase(), sourceCutoff: fixture.sourceCutoff, method: fixture.method },
  direct: { fixtureId: on.id, intermediateFixtureId: off.id, request: on.request,
    values: { gross: c.gross, isrTariff: c.isrTariff, subsidyApplied: c.subsidyApplied, isrWithheld: c.isrWithheld, imssDeducted: c.imssDeducted, net: c.net },
    afterIsr: off.expected.components.net,
  },
  inverse: { fixtureId: inverse.id, request: inverse.request, coverage: inverse.independentCoverage,
    candidates: inverse.expectedCandidates.map(({ gross, net, difference }) => ({ gross, net, difference })),
  },
}
const text = JSON.stringify(projected, null, 2) + "\n"
const target = new URL("src/features/help/verified-examples.json", root)
if (process.argv.includes("--check")) assert.equal(readFileSync(target, "utf8"), text, "Regenerar proyección desde el fixture verificado")
else writeFileSync(target, text)
console.log(JSON.stringify({ sourceFile, target: fileURLToPath(target), fixtureIds: [on.id, off.id, inverse.id], mode: process.argv.includes("--check") ? "checked" : "projected" }))
