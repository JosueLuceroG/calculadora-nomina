import type { FiscalPackageManifest, FiscalPackageRead, VerifiedFiscalPackageRef } from "../../domain/fiscal-runtime/contracts"
import { freezeFiscalRuntime } from "../../domain/fiscal-runtime/contracts"
import type { PayrollPeriodicity } from "../../domain/payroll/contracts"
import { FiscalFoundationError } from "../../domain/payroll/errors"
import { FISCAL_PARAMETERS_2026, selectFiscalParameters2026, standardGrossToNetContext2026, validateFiscalRegistry2026 } from "./2026"

/** Fixed embedded source. No caller-supplied registry, hash, code or verification flag. */
export function createEmbedded2026Provider() {
  validateFiscalRegistry2026(FISCAL_PARAMETERS_2026)
  const registry = FISCAL_PARAMETERS_2026
  const context = standardGrossToNetContext2026()
  const sets = [registry.isrTariffs, registry.uma, registry.minimumWages, registry.subsidy, registry.imssConstants, registry.contractualDivisors, registry.laborBenefitMinima].flat()
  const sources = [...new Map([...sets.flatMap(set => set.sources), ...context.subsidyRulesSources, ...context.retentionRuleSources].map(source => [JSON.stringify(source), source])).values()]
  const manifest: FiscalPackageManifest = freezeFiscalRuntime({
    manifestVersion: 1, packageId: registry.version, parameterVersion: registry.version, exercise: registry.exercise,
    supportedDates: { ...registry.supportedDates }, parameterSchemaId: "embedded-registry-2026-v1",
    requiredRuleProfileId: "mx-standard-2026-contextual-v2", requiredContextualPolicyId: "standard-isr-withholding-2026-independent-context-v2",
    requiredCapabilities: ["direct"], parameterSets: sets.map(({ id, version }) => ({ id, version })), sources,
    contentIdentity: { scheme: "legacy-registry-v1", sha256: "7e9f13084e64633b29959d79eec5f9c02333fe2695809c662d71fa7fc8393ab0" },
  })
  // Only the private provider/registry recognizes this object; the cast grants no authority.
  const reference = freezeFiscalRuntime({ manifest, origin: "embedded", verification: { data: "source-verified", basis: "embedded-build", integrity: "build-asserted" } }) as VerifiedFiscalPackageRef
  function read(ref: VerifiedFiscalPackageRef, date: string, periodicity: PayrollPeriodicity): FiscalPackageRead {
    if (ref !== reference) return { ok: false, code: "PACKAGE_REFERENCE_UNVERIFIED", cause: "FOREIGN_PACKAGE_REFERENCE" }
    try {
      const selected = selectFiscalParameters2026(date, periodicity)
      const { packageVersion: _, ...effective } = selected
      return freezeFiscalRuntime({ ok: true, implementationBindingId: "embedded-2026-standard-v1", engineContext: context,
        selectedParameterSets: Object.values(effective).map(({ id, version }) => ({ id, version })),
      })
    } catch (error) {
      if (!(error instanceof FiscalFoundationError)) throw error
      const code = error.code === "COVERAGE_GAP" || error.code === "OVERLAPPING_INTERVALS" || error.code === "INVALID_INTERVAL" ? "INVALID_PARAMETER_TIMELINE"
        : error.code === "UNVERIFIED_PARAMETER" ? "PACKAGE_REFERENCE_UNVERIFIED" : "PACKAGE_INCOMPLETE"
      return freezeFiscalRuntime({ ok: false, code, cause: error.code })
    }
  }
  return Object.freeze({ manifest, reference, read })
}
