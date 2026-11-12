import { describe, it, expect, afterAll } from "vitest"
import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { decodeFiscalSnapshot, encodeFiscalSnapshot } from "../features/storage/snapshot"
import { assertCompatSnapshot } from "../features/documents/provenance-compat-v1"

type NativeRecord = { label: string; executionId: string; run: string; documentSha256: string; documentBytes: number; status: string }
const root = new URL("../../", import.meta.url), out = new URL("docs/evidence/snapshot-v3-compat/cd3/", root)
const records = JSON.parse(readFileSync(new URL("native-finalization.json", out), "utf8")) as NativeRecord[]
const runFile = (run: string, name: string) => readFileSync(new URL(`${run}/${name}`, root), "utf8")
const observations: { label: string; executionId: string; sha256: string; bytes: number; roundtrip: boolean; authorityIssuedByThisTest: false }[] = []
describe("CD-3 native finalized payloads: read validation, not session reconstruction", () => {
  it.each(records)("$label retains the actual sealed outcome and native tuple", record => {
    const payload = runFile(record.run, "finalized.json")
    const engine = JSON.parse(runFile(record.run, "engine-result.json")) as { resultWire: string }
    const original = JSON.parse(engine.resultWire) as { outcome: unknown; capture: unknown }
    const s = decodeFiscalSnapshot(payload); assertCompatSnapshot(s)
    expect(s.documentKind).toBe("execution-record"); expect(s.executionId).toBe(record.executionId)
    expect(s.executionProvenance.producerId).toBe("nomina-signed-fiscal-document-v3-v2")
    expect(s.executionProvenance.reportContractId).toBe("standard-payroll-2026-contextual-document-compat-v1")
    expect(s.executionProvenance.presentationContractId).toBe("nomina-presentation-document-compat-v1")
    expect(s.executionProvenance.authorizationObservation.kind).toBe("native-observation-v1")
    expect(s.outcome).toEqual(original.outcome); expect(s.capture).toEqual(original.capture)
    expect(encodeFiscalSnapshot(s)).toBe(payload); expect(Buffer.byteLength(payload)).toBe(record.documentBytes)
    const sha256 = createHash("sha256").update(payload).digest("hex"); expect(sha256).toBe(record.documentSha256)
    observations.push({ label: record.label, executionId: record.executionId, sha256, bytes: record.documentBytes, roundtrip: true, authorityIssuedByThisTest: false })
  })
  it("D-W2 remains a reference, not a new session or a fixed-clock expectation", () => {
    const source = readFileSync(new URL("docs/evidence/5d3b5/runs/ccb510ae-3be6-4e57-9951-77403524ba6e/dw2-outcome.json", root))
    expect(createHash("sha256").update(source).digest("hex")).toBe("a9c89ebbba1ccf1cd655cc4b8cb326a85fb408bdd573d59319eadd70bb9b27fc")
    expect(records).toHaveLength(4); expect(records.some(x => x.label === "no-candidate")).toBe(true)
    const stress = records.find(x => x.label === "stress")!
    const s = decodeFiscalSnapshot(runFile(stress.run, "finalized.json")); assertCompatSnapshot(s)
    if (s.outcome.kind !== "inverse") throw Error("inverse required")
    expect(s.outcome.report.provenance.certificationAvailable).toBe(false)
    expect(s.outcome.report.metrics.certifiedClosures).toBe(0)
    expect(s.outcome.report.coverage.minimumProven).toBe(false)
    expect(s.outcome.report.coverage.exactSetComplete).toBe(false)
  })
})
afterAll(() => { writeFileSync(new URL("ts-native-roundtrip.json", out), JSON.stringify({ kind: "read-only validation of actual native-finalized artifacts", observations, newSessionFromArtifact: false }, null, 2) + "\n") })
