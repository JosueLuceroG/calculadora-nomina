import { createEmbeddedFiscalRegistry2026 } from "./package-registry"
import { isCivilDate } from "../../domain/payroll/civil-date"

const registry = createEmbeddedFiscalRegistry2026()

export type FiscalDateCoverage = Readonly<{
  available: boolean
  referenceDate: string
  packageId: string | null
  supportedDates: Readonly<{ from: string; through: string }>
  reason: "available" | "invalid-date" | "outside-coverage" | "parameters-unavailable"
}>

/** Proyección compatible de datos disponibles; no autoriza operaciones del motor. */
export function queryFiscalDateCoverage(referenceDate: string): FiscalDateCoverage {
  const entry = registry.entries[0]
  const supportedDates = Object.freeze({ ...entry.manifest.supportedDates })
  const result = (reason: FiscalDateCoverage["reason"]): FiscalDateCoverage => Object.freeze({
    available: reason === "available", referenceDate,
    packageId: reason === "available" ? entry.manifest.packageId : null,
    supportedDates, reason,
  })
  if (!isCivilDate(referenceDate)) return result("invalid-date")
  if (referenceDate < supportedDates.from || referenceDate > supportedDates.through) return result("outside-coverage")
  try {
    // El proveedor mantiene la comprobación mensual anterior de todas las series.
    if (!entry.reference) return result("parameters-unavailable")
    return result(registry.read(entry.reference, referenceDate, "monthly").ok ? "available" : "parameters-unavailable")
  } catch { return result("parameters-unavailable") }
}
