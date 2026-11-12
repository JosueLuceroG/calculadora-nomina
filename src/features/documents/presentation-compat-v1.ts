import type { StoredCompatSnapshot, CompatClassification } from "./contracts-compat-v1"
import { assertDocumentOutcome } from "./presentation-v1"

/** Reuse the immutable pure projection; no payroll/certificate/parameter lookup. */
export function assertCompatPresentation(s: StoredCompatSnapshot): void {
  assertDocumentOutcome(s.outcome, s.capture.form.effectiveDate)
}
export function compatClassification(s: StoredCompatSnapshot): CompatClassification {
  const r = s.outcome.report, p = s.outcome.presentation
  if (r.status !== "estimated" || (r.operation === "net-to-gross" && r.match === "none")) return "not-determinable"
  const f = r.operation === "gross-to-net" ? r : r.recommendedForwardResult
  if (p.confirmation || f?.retention.kind === "conditional-no-withholding-LISR-96"
    || (r.operation === "net-to-gross" && (r.coverage.state === "fiscally-incomplete" || r.coverage.fiscalUnresolvedIntervals.length))) return "conditioned"
  if (r.operation === "net-to-gross") return r.coverage.state === "limited" ? "limited" : r.match === "exact" ? "exact" : "approximate"
  return "estimated"
}
