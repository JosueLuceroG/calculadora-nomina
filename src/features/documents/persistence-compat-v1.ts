import type { FiscalOutcome } from "../calculator/fiscal-adapter"

/** Eligibility of a validated result only. Native session authority, consent and
 * generation are checked again by Rust; this helper never authorizes a write. */
export function compatCompleteResult(outcome: FiscalOutcome): boolean {
  const { report, presentation } = outcome
  if (report.status !== "estimated" || presentation.confirmation !== null) return false
  if (outcome.kind === "direct") return outcome.report.complete && outcome.report.reconciliationVerified
  const r = outcome.report, f = r.recommendedForwardResult
  return r.recommended !== null && f !== null && f.status === "estimated" && f.complete && f.reconciliationVerified
    && r.coverage.state === "complete" && r.coverage.exactSetComplete
}
