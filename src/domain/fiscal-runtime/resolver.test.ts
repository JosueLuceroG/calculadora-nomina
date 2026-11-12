import { describe, expect, it, vi } from "vitest"
import { nextCivilDate } from "../payroll/civil-date"
import type { EngineFiscalCapabilities, FiscalPackageManifest, FiscalPackageRegistrySnapshot, FiscalPackageRead, FiscalResolutionRequest, VerifiedFiscalPackageRef } from "./contracts"
import { resolveFiscalExecution } from "./resolver"
import { ENGINE_FISCAL_CAPABILITIES as capabilities } from "../../infrastructure/fiscal/engine-capabilities"
import { createEmbeddedFiscalRegistry2026 } from "../../infrastructure/fiscal/package-registry"
import { queryFiscalDateCoverage } from "../../infrastructure/fiscal/package-provider"
import { selectFiscalParameters2026, standardGrossToNetContext2026 } from "../../infrastructure/fiscal/2026"

const registry = createEmbeddedFiscalRegistry2026()
const manifest = registry.entries[0].manifest
const grant = capabilities.authorizations[0]
function query(patch: Partial<FiscalResolutionRequest> = {}): FiscalResolutionRequest {
  return { fiscalDate: "2026-02-01", periodicity: "monthly", simulationProfileId: grant.simulationProfileId, ruleProfileId: grant.ruleProfileId,
    contextualPolicyId: grant.contextualPolicyId, operation: "gross-to-net", requiredCapabilities: ["direct"], ...patch }
}
function grants(patch: Partial<typeof grant>): EngineFiscalCapabilities {
  return { registryVersion: "test-restricted-capabilities", authorizations: [{ ...grant, ...patch }] }
}
/** Trusted-port double only. These synthetic descriptors never enter production. */
function fixture(patch: Partial<FiscalPackageManifest> = {}, result?: FiscalPackageRead): FiscalPackageRegistrySnapshot {
  const m = { ...manifest, ...patch }
  const ref = { manifest: m, origin: "embedded", verification: { data: "source-verified", basis: "embedded-build", integrity: "build-asserted" } } as VerifiedFiscalPackageRef
  return { revision: "synthetic-rejection-fixture", entries: [{ manifest: m, reference: ref }], owns: candidate => candidate === ref,
    read: vi.fn(() => result ?? registry.read(registry.entries[0].reference!, "2026-02-01", "monthly")),
  }
}
function code(request = query(), packages = registry, engine = capabilities) {
  const result = resolveFiscalExecution(request, packages, engine)
  if (result.status !== "rejected") throw new Error("Expected structured rejection")
  expect(result).not.toHaveProperty("context")
  expect(Object.isFrozen(result)).toBe(true)
  return result.code
}

describe("5D.2a selección, autorización e identidad de referencia", () => {
  it.each(["weekly", "fortnightly", "monthly"] as const)("365 días cubiertos sin fallback: %s", periodicity => {
    let count = 0
    for (let date = "2026-01-01"; date <= "2026-12-31"; date = nextCivilDate(date)) {
      const result = resolveFiscalExecution(query({ fiscalDate: date, periodicity }), registry, capabilities)
      expect(result.status).toBe("resolved")
      if (result.status !== "resolved") throw new Error(result.code)
      expect(result.context.exercise).toBe(2026)
      expect(result.context.fiscalDate).toBe(date)
      expect(result.context.selectedParameterSets.map(p => p.id)).toEqual(Object.entries(selectFiscalParameters2026(date, periodicity)).filter(([key]) => key !== "packageVersion").map(([, value]) => (value as { id: string }).id))
      expect(queryFiscalDateCoverage(date)).toMatchObject({ available: true, packageId: manifest.packageId, referenceDate: date })
      count++
    }
    expect(count).toBe(365)
  }, 30000)
  it.each(["2026-01-01", "2026-01-31", "2026-02-01", "2026-12-31"])("contexto completo anterior y selección efectiva: %s", date => {
    const result = resolveFiscalExecution(query({ fiscalDate: date }), registry, capabilities)
    if (result.status !== "resolved") throw new Error(result.code)
    expect(result.context.engineContext).toEqual(standardGrossToNetContext2026())
    expect(result.context.selectedParameterSets.find(p => p.id.startsWith("mx-uma"))?.id).toBe(date < "2026-02-01" ? "mx-uma-2025-for-january-2026" : "mx-uma-2026")
  })
  it.each(["2026-02-29", "2026-13-01", "", "2026-1-01"])("fecha civil inválida %j", fiscalDate => expect(code(query({ fiscalDate }))).toBe("INVALID_FISCAL_DATE"))
  it.each(["2025-12-31", "2027-01-01", "2028-02-29"])("ejercicio sin paquete %s", fiscalDate => {
    expect(code(query({ fiscalDate }))).toBe("EXERCISE_PACKAGE_MISSING")
    expect(queryFiscalDateCoverage(fiscalDate)).toMatchObject({ available: false, packageId: null, reason: "outside-coverage" })
  })
  it("descriptor sintético2027 no concede reglas ni llama al proveedor", () => {
    const packages = fixture({ exercise: 2027, supportedDates: { from: "2027-01-01", through: "2027-12-31" } })
    expect(code(query({ fiscalDate: "2027-01-01" }), packages)).toBe("ENGINE_RULE_PROFILE_UNSUPPORTED")
    expect(packages.read).not.toHaveBeenCalled()
  })
  it("fecha sin cobertura del ejercicio", () => expect(code(query({ fiscalDate: "2026-01-01" }), fixture({ supportedDates: { from: "2026-02-01", through: "2026-12-31" } }))).toBe("DATE_OUTSIDE_PACKAGE_COVERAGE"))
  it("vigencia del manifest inválida y metadatos incompletos producen rechazos", () => {
    expect(code(query(), fixture({ supportedDates: { from: "2026-12-31", through: "2026-01-01" } }))).toBe("INVALID_PARAMETER_TIMELINE")
    expect(code(query(), fixture({ sources: [] }))).toBe("PACKAGE_INCOMPLETE")
    expect(code(query(), fixture({ parameterSets: [] }))).toBe("PACKAGE_INCOMPLETE")
  })
  it("paquete desconocido no se busca por cercanía", () => expect(code(query(), { ...registry, entries: [] })).toBe("EXERCISE_PACKAGE_MISSING"))
  it("copiar propiedades no fabrica una referencia", () => {
    const forged = { ...registry.entries[0].reference! }
    expect(registry.owns(forged)).toBe(false)
    expect(registry.read(forged, "2026-02-01", "monthly")).toMatchObject({ ok: false, code: "PACKAGE_REFERENCE_UNVERIFIED" })
    expect(code(query(), { ...registry, entries: [{ manifest, reference: forged }] })).toBe("PACKAGE_REFERENCE_UNVERIFIED")
    expect(code(query(), { ...registry, entries: [{ manifest, reference: null }] })).toBe("PACKAGE_REFERENCE_UNVERIFIED")
  })
  it("referencia de otra instancia y manifest sustituido no pertenecen al registro", () => {
    const other = createEmbeddedFiscalRegistry2026()
    expect(code(query(), { ...registry, entries: other.entries })).toBe("PACKAGE_REFERENCE_UNVERIFIED")
    expect(code(query(), { ...registry, entries: [{ manifest: { ...manifest }, reference: registry.entries[0].reference }] })).toBe("PACKAGE_REFERENCE_UNVERIFIED")
  })
  it.each(["packageId", "parameterVersion", "sha256"] as const)("identidad/contenido no autorizado: %s", field => {
    const content = { ...grant.content, [field]: "not-authorized" }
    expect(code(query(), registry, grants({ content }))).toBe("PACKAGE_CONTENT_NOT_AUTHORIZED")
  })
  it("contenido declarado falsificado con IDs originales no se autoriza", () => expect(code(query(), fixture({ contentIdentity: { scheme: "legacy-registry-v1", sha256: "0".repeat(64) } }))).toBe("PACKAGE_CONTENT_NOT_AUTHORIZED"))
  it.each([
    ["simulationProfileId", "SIMULATION_PROFILE_UNSUPPORTED"], ["ruleProfileId", "ENGINE_RULE_PROFILE_UNSUPPORTED"], ["contextualPolicyId", "CONTEXTUAL_POLICY_UNSUPPORTED"],
  ] as const)("perfil/política no autorizados: %s", (field, expected) => expect(code(query({ [field]: "future-not-reviewed" }))).toBe(expected))
  it("esquema desconocido", () => expect(code(query(), fixture({ parameterSchemaId: "future-schema" }))).toBe("PARAMETER_SCHEMA_UNSUPPORTED"))
  it("periodicidad sin autorización", () => expect(code(query({ periodicity: "weekly" }), registry, grants({ periodicities: ["monthly"] }))).toBe("PERIODICITY_UNSUPPORTED"))
  it("directo e inverso separados; inverso nunca evita exigir directo", () => {
    const inverse = query({ operation: "net-to-gross", requiredCapabilities: [] })
    expect(resolveFiscalExecution(query(), registry, grants({ inverse: false })).status).toBe("resolved")
    expect(code(inverse, registry, grants({ inverse: false }))).toBe("INVERSE_CAPABILITY_UNAVAILABLE")
    expect(code(inverse, registry, grants({ direct: false, inverse: true }))).toBe("DIRECT_CAPABILITY_UNAVAILABLE")
    expect(code(query(), registry, grants({ direct: false }))).toBe("DIRECT_CAPABILITY_UNAVAILABLE")
  })
  it("requerimientos del paquete no conceden capacidad ausente", () => expect(code(query(), fixture({ requiredCapabilities: ["direct", "inverse"] }), grants({ inverse: false }))).toBe("INVERSE_CAPABILITY_UNAVAILABLE"))
  it.each(["PACKAGE_INCOMPLETE", "INVALID_PARAMETER_TIMELINE", "PACKAGE_REFERENCE_UNVERIFIED"] as const)("preserva causa del proveedor: %s", failure => {
    const result = resolveFiscalExecution(query(), fixture({}, { ok: false, code: failure, cause: "SYNTHETIC_COVERAGE_GAP" }), capabilities)
    expect(result).toMatchObject({ status: "rejected", code: failure, stage: "parameters", cause: "SYNTHETIC_COVERAGE_GAP" })
  })
  it("datos/contexto incompletos y enlace de implementación no coincidente", () => {
    const read = registry.read(registry.entries[0].reference!, "2026-02-01", "monthly")
    if (!read.ok) throw new Error(read.code)
    expect(code(query(), fixture({}, { ...read, selectedParameterSets: [] }))).toBe("PACKAGE_INCOMPLETE")
    expect(code(query(), fixture({}, { ...read, implementationBindingId: "future-engine" }))).toBe("ENGINE_RULE_PROFILE_UNSUPPORTED")
  })
  it("ambigüedad de paquetes o autorizaciones no depende del orden", () => {
    const second = createEmbeddedFiscalRegistry2026().entries[0]
    for (const entries of [[registry.entries[0], second], [second, registry.entries[0]]]) expect(code(query(), { ...registry, entries })).toBe("AMBIGUOUS_FISCAL_PACKAGES")
    expect(code(query(), registry, { ...capabilities, authorizations: [grant, grant] })).toBe("AMBIGUOUS_FISCAL_PACKAGES")
  })
  it("consulta incoherente rechazada y precedencia estable", () => {
    expect(code(query({ operation: "future" as FiscalResolutionRequest["operation"] }))).toBe("INVALID_RESOLUTION_REQUEST")
    expect(code(query({ requiredCapabilities: ["future" as "direct"] }))).toBe("INVALID_RESOLUTION_REQUEST")
    expect(code(query({ fiscalDate: "invalid", ruleProfileId: "unknown" }))).toBe("INVALID_FISCAL_DATE")
  })
  it("contexto resuelto independiente de consultas, grants y selecciones posteriores", () => {
    const request = { ...query() }, engine = structuredClone(capabilities)
    const result = resolveFiscalExecution(request, registry, engine)
    if (result.status !== "resolved") throw new Error(result.code)
    const before = JSON.stringify(result)
    request.fiscalDate = "2027-01-01"
    ;(engine.authorizations as unknown as { direct: boolean }[])[0].direct = false
    expect(JSON.stringify(result)).toBe(before)
    expect(Object.isFrozen(result.context.engineContext.uma[0].data)).toBe(true)
    expect(Object.isFrozen(result.context.authorization.policyVersions)).toBe(true)
    expect(() => Reflect.set(result.context.engineContext.uma[0].data, "daily", "0.00")).not.toThrow()
    expect(JSON.stringify(result)).toBe(before)
  })
})
