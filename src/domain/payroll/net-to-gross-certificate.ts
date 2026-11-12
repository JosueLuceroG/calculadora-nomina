import type { StandardEstimatedGrossToNetResult } from "./gross-to-net-contracts"
import { compareDecimals } from "./money"
import {CONTEXTUAL_WITHHOLDING_POLICY,contextualOrdinaryScope} from './minimum-retention-context'

type Forward = Extract<StandardEstimatedGrossToNetResult, { status: "estimated" }>

/** Reviewed versions, deliberately not dynamically inherited from future policies. */
const reviewed = Object.freeze({
  "gross-to-net": "standard-gross-to-net-2026-component-cent-reconciliation-v1",
  withholding: "standard-isr-withholding-2026-monthly-minimum-explicit-assumption-v1",
  decimal: "decimal-50-v1", convention: "standard-estimate-2026-v1",
  integration: "theoretical-fixed-integration-2026-v1", sbc: "estimated-sbc-general-2026-half-up-v1",
  "worker-imss": "standard-worker-imss-general-2026-half-up-per-branch-v1",
  "isr-tariff": "standard-isr-tariff-2026-final-half-up-v1",
  "employment-subsidy": "standard-employment-subsidy-2026-period-half-up-v1",
})

/** Integer cent conversion only, never binary monetary arithmetic. */
export function inverseCents(value: string): bigint {
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(value)) throw new Error("Invalid cent representation")
  const negative = value.startsWith("-")
  const [integer, fraction = ""] = value.replace(/^-/, "").split(".")
  return BigInt(integer + fraction.padEnd(2, "0")) * (negative ? -1n : 1n)
}

export type SearchCertificate = Readonly<{ available: boolean; reason: string; maximumRateBasisPoints: bigint; policies: string }>
export function reviewedPolicies(report: Forward): boolean {
  if (report.provenance.policyVersions.length !== Object.keys(reviewed).length) return false
  const contextual=report.retention.policyVersion===CONTEXTUAL_WITHHOLDING_POLICY.id
  if(contextual){
    const assessment=report.retention.assessment,integration=report.integration.data,sbc=report.sbc
    if(!assessment||assessment.policyVersion!==CONTEXTUAL_WITHHOLDING_POLICY.id||!integration||sbc?.status!=='estimated'||compareDecimals(integration.dailySalary.internal.value,sbc.data.limits.lower)<=0||!contextualOrdinaryScope(assessment,report.gross.amount!,integration.normalized.periodicity))return false
  }
  return Object.entries(reviewed).every(([component, version]) => report.provenance.policyVersions.some(item => item.component === component && item.version === (contextual&&component==='withholding'?CONTEXTUAL_WITHHOLDING_POLICY.id:version)))
}

/**
 * NOT a tax calculator. Checks sufficient preconditions of the proof documented
 * in docs/hito-2g-2-proof.md. Unknown/unbounded cases fall back to enumeration.
 */
export function certifyInverseProfile(report: Forward): SearchCertificate {
  const no = (reason: string): SearchCertificate => Object.freeze({ available: false, reason, maximumRateBasisPoints: 0n, policies: "" })
  if (!reviewedPolicies(report) || report.retention.kind !== "ordinary-above-minimum") return no("UNREVIEWED_FORWARD_POLICIES_OR_RETENTION")
  const integration = report.integration.data
  const sbc = report.sbc
  const worker = report.modules.workerImss
  const subsidy = report.modules.employmentSubsidy
  if (!integration || sbc?.status !== "estimated" || worker?.status !== "estimated" || subsidy?.status !== "estimated") return no("INCOMPLETE_PROOF_METADATA")
  if (compareDecimals(integration.factor.value, "1") < 0 || compareDecimals(integration.factor.value, "1000000") > 0
    || compareDecimals(sbc.data.limits.upper, "1000000") > 0) return no("TECHNICAL_ADMISSIBILITY_MARGIN_NOT_PROVEN")
  if (Object.values(worker.byBranch).some(branch => (branch.workerRate.split(".")[1]?.length ?? 0) > 8)) return no("IMSS_PRECISION_MARGIN_NOT_PROVEN")
  if ((worker.data.thresholdDaily.value.split(".")[1]?.length ?? 0) > 2) return no("IMSS_EXCESS_BASE_CENT_GRID_NOT_PROVEN")
  let maximumRateBasisPoints = 0n
  for (const row of subsidy.data.isrResult.data.tariff.data.rows) {
    if (!/^\d+(?:\.\d{1,2})?$/.test(row.ratePercent)) return no("ISR_RATE_PRECISION_MARGIN_NOT_PROVEN")
    const rate = inverseCents(row.ratePercent) // hundredths of a percentage, not MXN
    // Cota suficiente: cuota fija - tasa marginal * límite inferior <= 0.
    // Used only to prove nonnegative net/admissibility, never to determine ISR.
    if (rate <= 0n || rate > 3500n || inverseCents(row.fixedFee) * 10000n > inverseCents(row.lower) * rate) return no("NONNEGATIVE_NET_BOUND_NOT_PROVEN")
    if (rate > maximumRateBasisPoints) maximumRateBasisPoints = rate
  }
  return Object.freeze({ available: true, reason: "REVIEWED_POSITIVE_COMPONENTS_AND_TECHNICAL_MARGINS", maximumRateBasisPoints, policies: JSON.stringify(report.provenance.policyVersions) })
}

export type InverseSignature = readonly number[]
export function inverseSignature(report: Forward): InverseSignature | null {
  const subsidy = report.modules.employmentSubsidy
  const worker = report.modules.workerImss
  const sbc = report.sbc
  if (subsidy?.status !== "estimated" || worker?.status !== "estimated" || sbc?.status !== "estimated") return null
  const bracket = subsidy.data.isrResult.data.selectedBracket
  if (!bracket) return null
  return Object.freeze([
    bracket.number,
    ["below-limit", "at-limit", "above-limit"].indexOf(subsidy.data.eligibility.relation),
    ["below-threshold", "at-threshold", "above-threshold"].indexOf(worker.data.thresholdRelation),
    ["below-lower", "at-lower", "inside-limits", "at-upper", "above-upper"].indexOf(sbc.data.sbc.relation),
    ...(report.retention.assessment?[report.retention.assessment.context.salaryBasis==='agreed-daily-reference'?1:2]:[]),
  ])
}
