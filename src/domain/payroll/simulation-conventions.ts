/** Declared assumptions, separate from normative parameters. Data only. */
export const STANDARD_CONVENTIONS = Object.freeze({
  id: "standard-estimate-2026-v1",
  nature: "simulation-convention" as const,
  activation: "not-activated" as const,
  resultClassification: "estimated" as const,
  referenceCotizedDays: Object.freeze({ weekly: "7", fortnightly: "15", monthly: "30" }),
  monthlyIncomeReferenceDays: "30",
  temporalScope: "effective-date-snapshot" as const,
  intervalInference: "no-calendar-interval-inferred" as const,
  subsidyEstimation: "explicit-estimation-preference-recorded" as const,
  monthlyAccumulation: "not-simulated" as const,
  geography: "general-zone" as const,
  benefitSeniority: "declared-entitlement-not-inferred" as const,
  fiscalRoundingApproval: "pending-operation-validation" as const,
  suaEquivalence: "not-validated" as const,
})
