import type { FiscalSource } from "./contracts"
import type { MinimumWageMonthlyScenario, StandardEstimatedGrossToNetInput, StandardEstimatedGrossToNetResult, StandardGrossToNetContext } from "./gross-to-net-contracts"
import type { MoneyText } from "./money"
import type {ContextualRetentionContext} from './minimum-retention-context'

export type MinimumWageCandidateScenario = Readonly<{ kind: "unconfirmed" }> | Readonly<{
  kind: "conditional-for-exact-minimum"
  declaration: Extract<MinimumWageMonthlyScenario, { kind: "only-general-minimum-assumed-for-reference-month" }>
}> | Readonly<{ kind: "monthly-payments-outside-standard-profile" }> | ContextualRetentionContext
export type StandardNetToGrossInput = Omit<StandardEstimatedGrossToNetInput, "grossPeriodSalary" | "minimumWageMonthlyScenario"> & Readonly<{
  targetNet: string
  fiscalPackageVersion: string
  minimumWageCandidateScenario: MinimumWageCandidateScenario
  searchOptions?: Readonly<{
    grossRange?: Readonly<{ from: string; to: string }>
    maxEvaluations?: number
    maxDurationMs?: number
    signal?: AbortSignal
  }>
}>
export type StandardNetToGrossContext = StandardGrossToNetContext
export type InverseCandidate = Readonly<{
  gross: MoneyText
  net: MoneyText
  difference: MoneyText
  absoluteDifference: MoneyText
  fiscalStatus: "estimated"
  scenario: "unconfirmed" | "conditional-minimum"
}>
export type InverseInterval = Readonly<{ from: MoneyText; to: MoneyText }>
export type InverseEvidence = InverseInterval & Readonly<{
  disposition: "examined" | "proved-no-exact" | "excluded-by-scope" | "fiscally-unresolved" | "pending-budget"
  reason: string
  proof?: Readonly<{
    certificate: "reviewed-components-monotone-2026-v1"
    from: MoneyText
    to: MoneyText
    kFrom: MoneyText
    kTo: MoneyText
    netLower: MoneyText
    netUpper: MoneyText
  }>
}>
export type StandardEstimatedNetToGrossResult = Readonly<{
  operation: "net-to-gross"
  status: "estimated" | "not-determinable" | "not-supported"
  targetNet: MoneyText | null
  match: "exact" | "approximate" | "none"
  exactCandidates: readonly InverseCandidate[]
  smallestFound: InverseCandidate | null
  recommended: InverseCandidate | null
  recommendationBasis: "minimum-proven-in-domain" | "smallest-verified-only" | "closest-verified-only" | "none"
  nearestVerifiedBelow: InverseCandidate | null
  nearestVerifiedAbove: InverseCandidate | null
  recommendedForwardResult: Extract<StandardEstimatedGrossToNetResult, { status: "estimated" }> | null
  coverage: Readonly<{
    state: "complete" | "limited" | "fiscally-incomplete"
    domain: InverseInterval | null
    technicalMaximumGross: MoneyText
    evidence: readonly InverseEvidence[]
    pendingIntervals: readonly InverseInterval[]
    fiscalUnresolvedIntervals: readonly InverseInterval[]
    minimumProven: boolean
    uniquenessProven: boolean
    noExactMatchProven: boolean
    exactSetComplete: boolean
    multipleSolutionsVerified: boolean
    approximationOptimality: "not-proven"
  }>
  conclusion: "unique-exact-in-domain" | "multiple-exact-in-domain" | "exact-found-inconclusive" | "no-exact-in-domain-proven" | "search-inconclusive" | "not-supported" | "not-determinable"
  metrics: Readonly<{
    directEvaluations: number
    cacheHits: number
    cacheEntries: number
    elapsedMs: number
    yields: number
    peakQueueIntervals: number
    certifiedClosures: number
    exhaustivePoints: number
    maxEvaluations: number
    maxDurationMs: number
    stopReason: "completed" | "evaluation-budget" | "time-budget" | "aborted" | "invalid-input" | "fiscal-preflight"
  }>
  discontinuities: readonly Readonly<{ before: MoneyText; after: MoneyText; reason: string }>[]
  fiscalDiagnostics: readonly Readonly<{ gross: MoneyText; status: string; codes: readonly string[] }>[]
  provenance: Readonly<{
    policyVersion: string
    fiscalPackageVersion: string | null
    forwardPolicyVersions: readonly Readonly<{ component: string; version: string }>[]
    sources: readonly FiscalSource[]
    assumptions: readonly string[]
    certificationAvailable: boolean
    certificationReason: string
    fiscalCertification: "not-certified"
    retentionContext?:ContextualRetentionContext
    retentionReviewRegion?:InverseInterval
  }>
  issues: readonly Readonly<{ field: string; code: string; message: string }>[]
}>
