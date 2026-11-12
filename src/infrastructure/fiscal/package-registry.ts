import type { FiscalPackageRegistrySnapshot, VerifiedFiscalPackageRef } from "../../domain/fiscal-runtime/contracts"
import { createEmbedded2026Provider } from "./embedded-2026-provider"

/** Immutable, local, compiled registry. Import/activation belongs to later milestones. */
export function createEmbeddedFiscalRegistry2026(): FiscalPackageRegistrySnapshot {
  const provider = createEmbedded2026Provider()
  return Object.freeze({
    revision: "embedded-package-registry-5d2a-v1",
    entries: Object.freeze([Object.freeze({ manifest: provider.manifest, reference: provider.reference })]),
    owns: (reference: VerifiedFiscalPackageRef) => reference === provider.reference,
    read: provider.read,
  })
}
