import type { StoredFiscalSnapshotV3 } from "./contracts-v3"
import type { StandardEstimatedGrossToNetResult } from "../../domain/payroll/gross-to-net-contracts"
import type { StandardEstimatedNetToGrossResult } from "../../domain/payroll/net-to-gross-contracts"
import type { FiscalPresentation } from "../calculator/fiscal-adapter"
import type { FiscalRegistry, FiscalSource } from "../../domain/payroll/contracts"
import type { ContextualRetentionContext } from "../../domain/payroll/minimum-retention-context"

type Complete = Extract<StandardEstimatedGrossToNetResult, { status: "estimated" }>
type PartialDirect = Exclude<StandardEstimatedGrossToNetResult, Complete>
type CandidateInverse = StandardEstimatedNetToGrossResult & Readonly<{
  status: "estimated" | "not-determinable"
  recommended: NonNullable<StandardEstimatedNetToGrossResult["recommended"]>
  recommendedForwardResult: Complete
  match: "exact" | "approximate"
}>
type EmptyInverse = StandardEstimatedNetToGrossResult & Readonly<{
  recommended: null; recommendedForwardResult: null; match: "none"
  nearestVerifiedAbove: null; nearestVerifiedBelow: null; smallestFound: null
}>
export type CompatOutcome =
  | Readonly<{ kind: "direct"; report: Complete | PartialDirect; presentation: FiscalPresentation }>
  | Readonly<{ kind: "inverse"; report: CandidateInverse | EmptyInverse; presentation: FiscalPresentation }>
export type CompatClassification = "estimated" | "exact" | "approximate" | "limited" | "conditioned" | "not-determinable"
type ReportedEvaluation = Readonly<{
  basis: "report-not-attested"; availability: "reported"
  reportedParameterSetVersions: readonly Readonly<{ id: string; version: string }>[] | null
  reportedForwardPolicyVersions: readonly Readonly<{ component: string; version: string }>[] | null
  reportedDirectEvaluations: number | null
}>
export type EvaluationObservation = ReportedEvaluation | Readonly<{
  basis: "report-not-attested"; availability: "not-reported"
  reportedParameterSetVersions: null; reportedForwardPolicyVersions: null; reportedDirectEvaluations: null
}>
type Signature = Readonly<{ protected: { protocolVersion: number; algorithm: string; keyId: string; purpose: string }; value: string }>
type ContentIdentity = Readonly<{ scheme: string; sha256: string }>
type Dates = Readonly<{ from: string; through: string }>
type Manifest = Readonly<{
  manifestVersion: number; packageId: string; parameterVersion: string; exercise: number
  supportedDates: Dates; parameterSchemaId: string; requiredRuleProfileId: string
  requiredContextualPolicyId: string; requiredCapabilities: string[]
  parameterSets: { id: string; version: string }[]; sources: FiscalSource[]; contentIdentity: ContentIdentity
}>
export type CompatPackageEnvelope = Readonly<{ signatures: Signature[]; signed: {
  format: string; formatVersion: number; canonicalization: string; channel: string
  publication: { streamId: string; streamEpoch: number; revision: number; publishedAt: string; minimumTrustEpoch: number; changes: { summary: string; supersedes: ContentIdentity | null } }
  manifest: Manifest; registry: FiscalRegistry
  ruleSources: { subsidy: FiscalSource[]; retention: FiscalSource[] }
  conventions: { id: string; nature: string; activation: string; resultClassification: string; referenceCotizedDays: { weekly: string; fortnightly: string; monthly: string }; monthlyIncomeReferenceDays: string; temporalScope: string; intervalInference: string; subsidyEstimation: string; monthlyAccumulation: string; geography: string; benefitSeniority: string; fiscalRoundingApproval: string; suaEquivalence: string }
  review: { recordId: string; reviewedOn: string; independentReportSha256: string; compatibilityStatement: string; sourceChecks: { sourceIndex: number; verifiedOn: string; documentSha256: string | null }[] }
} }>
export type CompatTrustEnvelope = Readonly<{ signatures: Signature[]; signed: {
  format: string; formatVersion: number; canonicalization: string; channel: string; rootVersion: number; epoch: number
  issuedAt: string; expiresAt: string; rootValidity: Dates; rootKeys: { keyId: string; publicKey: string }[]; threshold: number
  delegations: { keyId: string; publicKey: string; purpose: string; channel: string; exercise: number; parameterSchemaId: string; ruleProfileId: string; contextualPolicyId: string; streamId: string; streamEpoch: number; minimumRevision: number; maximumRevision: number; notBefore: string; notAfter: string; operations: string[] }[]
  revokedKeyIds: string[]; withdrawnPayloads: string[]
  floors: { streamId: string; exercise: number; ruleProfileId: string; streamEpoch: number; minimumRevision: number; reason: string | null }[]
} }>
export type StoredCompatSnapshot = Readonly<Omit<StoredFiscalSnapshotV3, "outcome" | "effectiveContext" | "fiscalEvidence" | "executionProvenance"> & {
  outcome: CompatOutcome
  executionProvenance: Readonly<Omit<StoredFiscalSnapshotV3["executionProvenance"], "requestScenario"> & { requestScenario: ContextualRetentionContext }>
  effectiveContext: StoredFiscalSnapshotV3["effectiveContext"] & Readonly<{ evaluationObservation: EvaluationObservation }>
  fiscalEvidence: Readonly<{
    representation: "jcs-envelope-object-v1"; packageEnvelope: CompatPackageEnvelope; trustHeadEnvelope: CompatTrustEnvelope
    trustEnvelopeSha256: string; trustPayloadSha256: string
    history: { scope: "referenced-not-replayable"; documentHashes: string[]; episodeCount: number; archiveLocator: string; manifestSha256: string }
  }>
}>
