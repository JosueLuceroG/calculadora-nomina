import { cpus, platform, arch, totalmem } from "node:os"
import { describe, expect, it } from "vitest"
import { calculateStandardEstimatedNetToGross } from "../domain/payroll/net-to-gross"
import { standardGrossToNetContext2026 } from "../infrastructure/fiscal/2026"
import { STANDARD_CONVENTIONS } from "../domain/payroll/simulation-conventions"

describe("medición separada del inverso real, sin oráculo duplicado en cronómetro", () => {
  it("registra latencia, evaluaciones y heap para salarios ordinarios/elevados", async () => {
    const data: unknown[] = []
    for (const [id, targetNet, periodicity, includeWorkerImss, known] of [
      ["A-monthly", "13202.64", "monthly", true, "15000.00"],
      ["B-imss-off", "13597.18", "monthly", false, "15000.00"],
      ["C-weekly", "3076.67", "weekly", true, "3499.99"],
      ["D-fortnightly", "6592.87", "fortnightly", true, "7500.00"],
      ["E-multiple", "10500.00", "monthly", true, "11093.07"],
      ["high", "206830.46", "monthly", true, "300000.00"],
    ] as const) {
      const before = process.memoryUsage().heapUsed
      const result = await calculateStandardEstimatedNetToGross({ targetNet, profileId: STANDARD_CONVENTIONS.id, fiscalPackageVersion: "mx-fiscal-2026-source-v3", periodicity, referenceDate: "2026-02-01", area: "general-zone", benefits: { annualBonusDays: "15", annualVacationDays: "12", vacationPremiumPercent: "25" }, includeWorkerImss, minimumWageCandidateScenario: { kind: "unconfirmed" } }, standardGrossToNetContext2026())
      data.push({ id, ...result.metrics, matches: result.exactCandidates.map(c => c.gross), coverage: result.coverage.state, heapDeltaBytes: process.memoryUsage().heapUsed - before })
      // Real wall time is load-dependent. A cooperative deadline is a valid
      // outcome, not permission to claim completed coverage under contention.
      if (result.metrics.stopReason === "time-budget") {
        expect(result.coverage.state).toBe("limited")
        expect(result.coverage.exactSetComplete).toBe(false)
        expect(result.coverage.uniquenessProven).toBe(false)
        expect(result.coverage.noExactMatchProven).toBe(false)
        expect(result.coverage.pendingIntervals.length).toBeGreaterThan(0)
        for (const c of result.exactCandidates) expect(c.difference).toBe("0.00")
      } else {
        expect(result.metrics.stopReason).toBe("completed")
        expect(result.exactCandidates.some(c => c.gross === known), JSON.stringify(result.metrics)).toBe(true)
        expect(result.coverage.state, JSON.stringify(result.metrics)).toBe("complete")
        expect(result.coverage.minimumProven).toBe(true)
      }
    }
    console.log("INVERSE_BENCHMARK", JSON.stringify({ node: process.version, os: platform(), arch: arch(), cpu: cpus()[0]?.model, totalMemoryBytes: totalmem(), note: "heap delta is not peak memory; times include cooperative yields", data }))
  }, 30000)
})
