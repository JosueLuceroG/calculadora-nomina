import type { EngineFiscalCapabilities } from "../../domain/fiscal-runtime/contracts"
import { freezeFiscalRuntime } from "../../domain/fiscal-runtime/contracts"
import { STANDARD_CONVENTIONS } from "../../domain/payroll/simulation-conventions"
import { CONTEXTUAL_WITHHOLDING_POLICY } from "../../domain/payroll/minimum-retention-context"

/** Compiled program authorization, not values read from a package manifest. */
export const ENGINE_FISCAL_CAPABILITIES: EngineFiscalCapabilities = freezeFiscalRuntime({
  registryVersion: "fiscal-capabilities-5d2a-v1",
  authorizations: [{
    capabilityId: "mx-2026-standard-contextual-v2",
    implementationBindingId: "embedded-2026-standard-v1",
    exercise: 2026,
    simulationProfileId: STANDARD_CONVENTIONS.id,
    ruleProfileId: "mx-standard-2026-contextual-v2",
    contextualPolicyId: CONTEXTUAL_WITHHOLDING_POLICY.id,
    parameterSchemaId: "embedded-registry-2026-v1",
    content: { packageId: "mx-fiscal-2026-source-v3", parameterVersion: "mx-fiscal-2026-source-v3", scheme: "legacy-registry-v1", sha256: "7e9f13084e64633b29959d79eec5f9c02333fe2695809c662d71fa7fc8393ab0" },
    periodicities: ["weekly", "fortnightly", "monthly"], direct: true, inverse: true,
    policyVersions: [
      { component: "gross-to-net", version: "standard-gross-to-net-2026-component-cent-reconciliation-v1" },
      { component: "withholding", version: CONTEXTUAL_WITHHOLDING_POLICY.id },
      { component: "decimal", version: "decimal-50-v1" },
      { component: "convention", version: STANDARD_CONVENTIONS.id },
      { component: "integration", version: "theoretical-fixed-integration-2026-v1" },
      { component: "sbc", version: "estimated-sbc-general-2026-half-up-v1" },
      { component: "worker-imss", version: "standard-worker-imss-general-2026-half-up-per-branch-v1" },
      { component: "isr-tariff", version: "standard-isr-tariff-2026-final-half-up-v1" },
      { component: "employment-subsidy", version: "standard-employment-subsidy-2026-period-half-up-v1" },
      { component: "net-to-gross", version: "standard-net-to-gross-2026-contextual-partitions-v2" },
    ],
  }],
})
