import type { MonetaryComponent, SalaryArea } from "../../domain/payroll/contracts"
import { FiscalFoundationError } from "../../domain/payroll/errors"
import { calculateStandardEstimatedGrossToNet } from "../../domain/payroll/gross-to-net"
import type { MinimumWageMonthlyScenario, StandardEstimatedGrossToNetInput, StandardEstimatedGrossToNetResult, StandardGrossToNetContext } from "../../domain/payroll/gross-to-net-contracts"
import { decimalText, moneyText, roundDecimal, subtractDecimals } from "../../domain/payroll/money"
import { calculateStandardEstimatedNetToGross } from "../../domain/payroll/net-to-gross"
import type { InverseCandidate, StandardEstimatedNetToGrossResult, StandardNetToGrossInput } from "../../domain/payroll/net-to-gross-contracts"
import { STANDARD_CONVENTIONS } from "../../domain/payroll/simulation-conventions"
import {defaultRetentionContext,isContextualRetention,parseRetentionContext,type ContextualRetentionContext,type RetentionAssessment} from '../../domain/payroll/minimum-retention-context'
import { standardGrossToNetContext2026 } from "../../infrastructure/fiscal/2026"
import { resolveFiscalExecution } from "../../domain/fiscal-runtime/resolver"
import { createEmbeddedFiscalRegistry2026 } from "../../infrastructure/fiscal/package-registry"
import { ENGINE_FISCAL_CAPABILITIES } from "../../infrastructure/fiscal/engine-capabilities"
import { documentProvenance, type ExecutionDocumentProvenance } from "../documents/provenance"
import type { CaptureField, CaptureForm } from "./form"
import { emptyResultValues, type ResultValues } from "./results"
import { validateCapture } from "./validation"

// La UI mantiene una sola puerta autorizada al repositorio fiscal.
export { queryFiscalDateCoverage, type FiscalDateCoverage } from "../../infrastructure/fiscal/package-provider"

/** Zona explícita fuera de CaptureForm hasta que se autorice el selector visual. */
export type FiscalCapture = Readonly<{ form: Readonly<CaptureForm>; area: SalaryArea | "" }>
export type MinimumDeclaration = Extract<MinimumWageMonthlyScenario, { kind: "only-general-minimum-assumed-for-reference-month" }> | ContextualRetentionContext
export type AdapterIssue = Readonly<{ field: CaptureField | "area" | "mode" | "includeImss" | "scenario" | "request"; category: "capture" | "technical"; code: string; message: string }>
export type FiscalPresentation = Readonly<{
  kind: "direct" | "inverse"
  fiscalStatus: StandardEstimatedGrossToNetResult["status"]
  determination: "complete-estimate" | "verified-candidate" | "blocked"
  values: Readonly<ResultValues>
  componentStates: Readonly<{
    gross: MonetaryComponent; net: MonetaryComponent; isr: MonetaryComponent; imss: MonetaryComponent
    subsidyDetermined: MonetaryComponent; subsidyApplied: MonetaryComponent
  }> | null
  integrationFactorRaw: string | null
  subsidy: Readonly<{ determined: string | null; applied: string | null; notAppliedDueToNoWithholding: string | null; excessOverTariffIsrNotDelivered: string | null }>
  variableIncome: "not-applicable-to-ordinary-salary" | "unknown"
  confirmation: Readonly<{ referenceMonth: string; candidateGross: string | null; basis: "direct-retention" | "inverse-relevant-unresolved-point";contextual?:Readonly<{salaryBasis:ContextualRetentionContext['salaryBasis'];monthlyCondition:ContextualRetentionContext['monthlyCondition'];dailyRelation:RetentionAssessment['dailyRelation'];message:string;references?:Readonly<{daily:string;standardMonth:string;publishedMonth:string}>}> }> | null
  warnings: readonly Readonly<{ code: string; message: string }>[]
  issues: readonly Readonly<{ field: string; code: string; message: string }>[]
  inverse: Readonly<{
    targetNet: string | null
    recommendedGross: string | null
    obtainedNet: string | null
    difference: string | null
    absoluteDifference: string | null
    match: StandardEstimatedNetToGrossResult["match"]
    coverage: StandardEstimatedNetToGrossResult["coverage"]["state"]
    domain: StandardEstimatedNetToGrossResult["coverage"]["domain"]
    conclusion: StandardEstimatedNetToGrossResult["conclusion"]
    smallestFoundGross: string | null
    minimumProven: boolean
    uniquenessProven: boolean
    noExactMatchProven: boolean
    exactSetComplete: boolean
    recommendationBasis: StandardEstimatedNetToGrossResult["recommendationBasis"]
    alternatives: readonly InverseCandidate[]
    stopReason: StandardEstimatedNetToGrossResult["metrics"]["stopReason"]
  }> | null
}>
type PreparedBase = Readonly<{ snapshot: FiscalCapture; fingerprint: string; monthlyScenario: MinimumWageMonthlyScenario }>
export type PreparedDirect = PreparedBase & Readonly<{ mode: "gross-to-net"; input: StandardEstimatedGrossToNetInput }>
export type PreparedInverse = PreparedBase & Readonly<{ mode: "net-to-gross"; input: StandardNetToGrossInput }>
export type PreparedFiscalRequest = PreparedDirect | PreparedInverse
export type FiscalPreparation = Readonly<{ ok: true; prepared: PreparedFiscalRequest }> | Readonly<{ ok: false; snapshot: FiscalCapture | null; issues: readonly AdapterIssue[] }>
export type DirectFiscalOutcome = Readonly<{ kind: "direct"; report: StandardEstimatedGrossToNetResult; presentation: FiscalPresentation }>
export type InverseFiscalOutcome = Readonly<{ kind: "inverse"; report: StandardEstimatedNetToGrossResult; presentation: FiscalPresentation }>
export type FiscalOutcome = DirectFiscalOutcome | InverseFiscalOutcome
export type FiscalAdapter = Readonly<{
  configuration: Readonly<{ profileId: string; fiscalPackageVersion: string; supportedDates: Readonly<{ from: string; through: string }> }>
  prepare: (capture: FiscalCapture, scenario?: MinimumWageMonthlyScenario) => FiscalPreparation
  direct: (request: PreparedDirect) => DirectFiscalOutcome
  inverse: (request: PreparedInverse, signal?: AbortSignal) => Promise<InverseFiscalOutcome>
  executionProvenance?: (request: PreparedFiscalRequest) => ExecutionDocumentProvenance
}>

const UNCONFIRMED: MinimumWageMonthlyScenario = Object.freeze({ kind: "unconfirmed" })
const formFields = ["mode", "amount", "period", "effectiveDate", "bonusDays", "vacationDays", "vacationPremium", "includeImss"] as const
function record(v: unknown): v is Record<string, unknown> { return v !== null && typeof v === "object" && !Array.isArray(v) }
function freeze<T>(v: T): T {
  if (v !== null && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v) }
  return v
}
export function snapshotFiscalCapture(capture: FiscalCapture): FiscalCapture { return freeze(structuredClone(capture)) }
/** Huella de datos declarados, no de los importes calculados ni de una hipótesis. */
export function fiscalCaptureFingerprint(capture: FiscalCapture): string {
  return JSON.stringify([capture.form.mode, capture.form.amount, capture.form.period, capture.form.effectiveDate, capture.form.bonusDays, capture.form.vacationDays, capture.form.vacationPremium, capture.form.includeImss, capture.area])
}
function adapterIssue(field: AdapterIssue["field"], code: string, message: string, category: AdapterIssue["category"] = "capture"): AdapterIssue {
  return Object.freeze({ field, code, message, category })
}
function prepare(capture: FiscalCapture, scenario: MinimumWageMonthlyScenario | undefined, configuration: FiscalAdapter["configuration"], contextual=false): FiscalPreparation {
  const errors: AdapterIssue[] = []
  const fail = (snapshot: FiscalCapture | null): FiscalPreparation => Object.freeze({ ok: false, snapshot, issues: Object.freeze(errors) })
  if (!record(capture) || !record(capture.form)) {
    errors.push(adapterIssue("request", "INVALID_FISCAL_CAPTURE", "Se requiere el formulario y una zona explícita.")); return fail(null)
  }
  if (Object.keys(capture).some(k => !["form", "area"].includes(k)) || Object.keys(capture.form).some(k => !(formFields as readonly string[]).includes(k))) {
    errors.push(adapterIssue("request", "EXTRA_CAPTURE_FIELD", "La captura no admite conceptos fiscales adicionales.")); return fail(null)
  }
  for (const field of formFields) {
    if (field !== "includeImss" && typeof capture.form[field] !== "string") errors.push(adapterIssue(field, "INVALID_CAPTURE_FIELD", "El campo debe conservarse como cadena de captura."))
  }
  if (typeof capture.form.includeImss !== "boolean") errors.push(adapterIssue("includeImss", "REQUIRED_IMSS_CONTROL", "Incluir IMSS debe ser un booleano explícito."))
  if (errors.length) return fail(null)
  const snapshot = snapshotFiscalCapture(capture)
  const form = snapshot.form
  if (form.mode !== "gross-to-net" && form.mode !== "net-to-gross") errors.push(adapterIssue("mode", "UNSUPPORTED_CAPTURE_MODE", "Elige uno de los dos sentidos de cálculo aprobados."))
  for (const [field, message] of Object.entries(validateCapture(form))) errors.push(adapterIssue(field as CaptureField, "INVALID_CAPTURE", message!))
  for (const field of ["bonusDays", "vacationDays", "vacationPremium"] as const) {
    if (form[field] === "") errors.push(adapterIssue(field, "REQUIRED_BENEFIT", "Captura esta prestación anual explícitamente; no se asigna cero ni un mínimo por defecto."))
    else if (!errors.some(e => e.field === field)) {
      try { decimalText(form[field]) }
      catch (error) {
        if (!(error instanceof FiscalFoundationError)) throw error
        errors.push(adapterIssue(field, error.code, error.message, error.code === "DECIMAL_RANGE" ? "technical" : "capture"))
      }
    }
  }
  if (snapshot.area === "" || snapshot.area == null) errors.push(adapterIssue("area", "REQUIRED_SALARY_AREA", "Indica la zona salarial explícitamente."))
  else if (!["general-zone", "northern-border-zone"].includes(snapshot.area)) errors.push(adapterIssue("area", "INVALID_SALARY_AREA", "La zona debe ser un identificador salarial válido."))
  let amount: string | null = null
  if (!errors.some(e => e.field === "amount")) {
    try { amount = moneyText(form.amount, "positive") }
    catch (error) {
      if (!(error instanceof FiscalFoundationError)) throw error
      errors.push(adapterIssue("amount", error.code, error.message, error.code === "DECIMAL_RANGE" ? "technical" : "capture"))
    }
  }
  const monthly = scenario === undefined ? contextual?defaultRetentionContext(form.effectiveDate):UNCONFIRMED : scenario
  if(contextual&&!isContextualRetention(monthly))errors.push(adapterIssue('scenario','CONTEXTUAL_POLICY_REQUIRED','Los cálculos actuales requieren una base contextual v2, no una declaración histórica v1.'))
  if(isContextualRetention(monthly)){try{parseRetentionContext(monthly)}catch(error){errors.push(adapterIssue('scenario','INVALID_RETENTION_CONTEXT',error instanceof Error?error.message:'Contexto inválido.'))}}
  else if (!record(monthly) || !["unconfirmed", "only-general-minimum-assumed-for-reference-month", "monthly-payments-outside-standard-profile"].includes(monthly.kind)) {
    errors.push(adapterIssue("scenario", "INVALID_MONTHLY_SCENARIO", "La declaración mensual debe pertenecer al contrato aprobado."))
  } else if (monthly.kind !== "only-general-minimum-assumed-for-reference-month" && Object.keys(monthly).some(k => k !== "kind")) {
    errors.push(adapterIssue("scenario", "EXTRA_MONTHLY_SCENARIO_FIELD", "No se descarta información mensual adicional silenciosamente."))
  }
  if (errors.length || amount === null) return fail(snapshot)
  const monthlyScenario = freeze(structuredClone(monthly))
  const common = {
    profileId: configuration.profileId, periodicity: form.period as StandardEstimatedGrossToNetInput["periodicity"], referenceDate: form.effectiveDate,
    benefits: Object.freeze({ annualBonusDays: form.bonusDays, annualVacationDays: form.vacationDays, vacationPremiumPercent: form.vacationPremium }),
    area: snapshot.area as SalaryArea, includeWorkerImss: form.includeImss,
  }
  const base = { snapshot, fingerprint: fiscalCaptureFingerprint(snapshot), monthlyScenario }
  if (form.mode === "gross-to-net") return Object.freeze({ ok: true, prepared: Object.freeze({ ...base, mode: "gross-to-net", input: Object.freeze({ ...common, grossPeriodSalary: amount, minimumWageMonthlyScenario: monthlyScenario }) }) })
  const candidateScenario: StandardNetToGrossInput["minimumWageCandidateScenario"] = isContextualRetention(monthlyScenario)?monthlyScenario:monthlyScenario.kind === "only-general-minimum-assumed-for-reference-month"
    ? Object.freeze({ kind: "conditional-for-exact-minimum", declaration: monthlyScenario }) : Object.freeze({ kind: monthlyScenario.kind })
  return Object.freeze({ ok: true, prepared: Object.freeze({ ...base, mode: "net-to-gross", input: Object.freeze({ ...common, targetNet: amount, fiscalPackageVersion: configuration.fiscalPackageVersion, minimumWageCandidateScenario: candidateScenario }) }) })
}

function shownFactor(value: string): string {
  const [whole, fraction = ""] = roundDecimal(value, 4, "half-up").value.split(".")
  return `${whole}.${fraction.padEnd(4, "0")}`
}
function forwardValues(report: StandardEstimatedGrossToNetResult | null) {
  const integration = report?.integration.data
  const sbc = report?.sbc
  const subsidiary = report?.modules.employmentSubsidy
  const isr = subsidiary?.status === "estimated" ? subsidiary.data.isrResult : subsidiary?.diagnosticIsr
  const values: Readonly<ResultValues> = Object.freeze({
    ...emptyResultValues,
    grossSalary: report?.gross.amount ?? null, netSalary: report?.net.amount ?? null,
    workerImss: report?.imss.deducted.amount ?? null, isr: report?.isr.withheld.amount ?? null,
    taxableIncome: isr?.data.taxableIncome ?? null, employmentSubsidy: report?.subsidy.applied.amount ?? null,
    dailySalary: integration?.dailySalary.presentation.amount ?? null,
    integrationFactor: integration ? shownFactor(integration.factor.value) : null,
    integratedDailySalary: integration?.theoreticalSdi.presentation.amount ?? null,
    contributionBaseSalary: sbc?.status === "estimated" ? sbc.data.sbc.estimatedSbc : null,
    integratedBenefitDays: integration?.equivalentAnnualBenefitDays.value ?? null,
    integratedVariableIncome: null,
  })
  return {
    values,
    componentStates: report ? Object.freeze({ gross: report.gross, net: report.net, isr: report.isr.withheld, imss: report.imss.deducted, subsidyDetermined: report.subsidy.determined, subsidyApplied: report.subsidy.applied }) : null,
    integrationFactorRaw: integration?.factor.value ?? null,
    subsidy: Object.freeze({ determined: report?.subsidy.determined.amount ?? null, applied: report?.subsidy.applied.amount ?? null, notAppliedDueToNoWithholding: report?.subsidy.notAppliedDueToNoWithholding.amount ?? null, excessOverTariffIsrNotDelivered: report?.subsidy.excessOverTariffIsrNotDelivered.amount ?? null }),
    variableIncome: integration ? "not-applicable-to-ordinary-salary" as const : "unknown" as const,
  }
}
export function presentDirectFiscalResult(report: StandardEstimatedGrossToNetResult): FiscalPresentation {
  const assessment=report.retention.assessment
  const confirmation = assessment&&(assessment.state==='insufficient-context'||assessment.state==='outside-profile')?Object.freeze({referenceMonth:assessment.context.referenceMonth,candidateGross:report.gross.amount,basis:'direct-retention' as const,contextual:Object.freeze({salaryBasis:assessment.context.salaryBasis,monthlyCondition:assessment.context.monthlyCondition,dailyRelation:assessment.dailyRelation,message:assessment.message,references:Object.freeze({daily:assessment.referenceDailyMinimum,standardMonth:assessment.reviewRegion.from,publishedMonth:assessment.publishedMonthlyReference})})}):report.retention.kind === "unconfirmed-minimum-month" && report.retention.referenceMonth !== null && report.issues.some(i => i.code === "MONTHLY_MINIMUM_CONFIRMATION_REQUIRED")
    ? Object.freeze({ referenceMonth: report.retention.referenceMonth, candidateGross: report.gross.amount, basis: "direct-retention" as const }) : null
  return Object.freeze({ kind: "direct", fiscalStatus: report.status, determination: report.status === "estimated" ? "complete-estimate" : "blocked", ...forwardValues(report), confirmation,
    warnings: Object.freeze(report.warnings.map(w => Object.freeze({ code: w.code, message: w.message }))),
    issues: Object.freeze(report.issues.map(i => Object.freeze({ field: i.field, code: i.code, message: i.message }))), inverse: null,
  })
}
export class FiscalPresentationError extends Error {
  constructor(message: string) { super(message); this.name = "FiscalPresentationError" }
}
export function presentInverseFiscalResult(report: StandardEstimatedNetToGrossResult, referenceDate?: string): FiscalPresentation {
  const candidate = report.recommended
  const direct = report.recommendedForwardResult
  if (candidate && (!direct || direct.status !== "estimated" || !direct.complete || !direct.reconciliationVerified
    || direct.gross.amount !== candidate.gross || direct.net.amount !== candidate.net || report.targetNet === null || candidate.fiscalStatus !== "estimated"
    || subtractDecimals(candidate.net, report.targetNet).value !== decimalText(candidate.difference)
    || decimalText(candidate.difference).replace(/^-/, "") !== decimalText(candidate.absoluteDifference))) {
    throw new FiscalPresentationError("El reporte directo recomendado no corresponde al candidato inverso y su diferencia.")
  }
  if ((!candidate && direct) || (report.match === "exact" && (!candidate || candidate.difference !== "0.00" || !report.exactCandidates.some(c => c.gross === candidate.gross && c.net === candidate.net)))
    || (report.match === "approximate" && (!candidate || candidate.difference === "0.00")) || (report.match === "none" && candidate)) throw new FiscalPresentationError("La clasificación de coincidencia no corresponde al candidato verificado.")
  if ((report.coverage.state === "complete" && (!report.coverage.domain || !report.coverage.exactSetComplete || report.coverage.pendingIntervals.length || report.coverage.fiscalUnresolvedIntervals.length))
    || (report.coverage.state !== "complete" && report.coverage.exactSetComplete)) throw new FiscalPresentationError("La cobertura declarada contradice sus intervalos o estado de examen.")
  if ((report.coverage.uniquenessProven && (report.coverage.state !== "complete" || !report.coverage.exactSetComplete || report.exactCandidates.length !== 1))
    || (report.coverage.noExactMatchProven && (report.coverage.state !== "complete" || !report.coverage.exactSetComplete || report.exactCandidates.length !== 0))) {
    throw new FiscalPresentationError("No se puede presentar una conclusión de cobertura no demostrada.")
  }
  if (report.coverage.minimumProven && (!report.exactCandidates.length || !report.smallestFound || report.recommendationBasis !== "minimum-proven-in-domain" || candidate?.gross !== report.smallestFound.gross)) throw new FiscalPresentationError("El mínimo demostrado requiere una coincidencia y un fundamento compatibles.")
  if ((report.conclusion === "unique-exact-in-domain" && !report.coverage.uniquenessProven)
    || (report.conclusion === "no-exact-in-domain-proven" && !report.coverage.noExactMatchProven)
    || (report.conclusion === "multiple-exact-in-domain" && (report.coverage.state !== "complete" || !report.coverage.exactSetComplete || report.exactCandidates.length < 2))) throw new FiscalPresentationError("La conclusión no está respaldada por las pruebas de cobertura.")
  const minimumPoint = report.coverage.evidence.find(e => e.disposition === "fiscally-unresolved" && e.from === e.to && e.reason.split("|").includes("MONTHLY_MINIMUM_CONFIRMATION_REQUIRED")
    && report.coverage.fiscalUnresolvedIntervals.some(i => i.from === e.from && i.to === e.to))
  const referenceMonth = referenceDate?.slice(0, 7) ?? direct?.retention.referenceMonth ?? null
  const contextual=report.provenance.retentionContext,contextPending=report.coverage.fiscalUnresolvedIntervals.length>0||report.status==='not-supported'||report.status==='not-determinable'
  const confirmation = contextual&&contextPending?Object.freeze({referenceMonth:contextual.referenceMonth,candidateGross:null,basis:'inverse-relevant-unresolved-point' as const,contextual:Object.freeze({salaryBasis:contextual.salaryBasis,monthlyCondition:contextual.monthlyCondition,dailyRelation:null,message:'El dominio conserva condiciones fiscales pendientes. Precisa la base del periodo; no se confunde candidato exacto con mínimo demostrado.'})}):minimumPoint && referenceMonth
    ? Object.freeze({ referenceMonth, candidateGross: minimumPoint.from, basis: "inverse-relevant-unresolved-point" as const }) : null
  const warnings = [...(direct?.warnings.map(w => ({ code: w.code, message: w.message })) ?? [])]
  if (report.coverage.state === "limited") warnings.push({ code: "INVERSE_SEARCH_LIMITED", message: "Búsqueda limitada: los candidatos están verificados, pero pueden quedar alternativas o conclusiones pendientes." })
  if (report.coverage.state === "fiscally-incomplete") warnings.push({ code: "INVERSE_FISCALLY_INCOMPLETE", message: "Hay condiciones fiscales irresueltas; no se presenta ausencia o unicidad sin demostración." })
  if (report.match === "approximate") warnings.push({ code: "INVERSE_APPROXIMATE", message: "El neto obtenido difiere del objetivo. La aproximación no es una coincidencia exacta ni se garantiza óptima globalmente." })
  const unique = new Map(warnings.map(w => [w.code, Object.freeze(w)]))
  return Object.freeze({
    kind: "inverse", fiscalStatus: report.status, determination: candidate ? "verified-candidate" : "blocked", ...forwardValues(candidate ? direct : null), confirmation,
    warnings: Object.freeze([...unique.values()]), issues: Object.freeze(report.issues.map(i => Object.freeze({ ...i }))),
    inverse: Object.freeze({ targetNet: report.targetNet, recommendedGross: candidate?.gross ?? null, obtainedNet: candidate?.net ?? null, difference: candidate?.difference ?? null, absoluteDifference: candidate?.absoluteDifference ?? null, match: report.match, coverage: report.coverage.state, domain: report.coverage.domain, conclusion: report.conclusion, smallestFoundGross: report.smallestFound?.gross ?? null, minimumProven: report.coverage.minimumProven, uniquenessProven: report.coverage.uniquenessProven, noExactMatchProven: report.coverage.noExactMatchProven, exactSetComplete: report.coverage.exactSetComplete, recommendationBasis: report.recommendationBasis, alternatives: report.exactCandidates, stopReason: report.metrics.stopReason }),
  })
}

/** Frontera única de integración: sin React, JSX ni ejecución desde App en 3B.1. */
export function createFiscalAdapter(context: StandardGrossToNetContext = standardGrossToNetContext2026(),contextual=false): FiscalAdapter {
  const ctx = freeze(structuredClone(context))
  const configuration = Object.freeze({ profileId: STANDARD_CONVENTIONS.id, fiscalPackageVersion: ctx.fiscalPackageVersion, supportedDates: Object.freeze({ ...ctx.supportedDates }) })
  return Object.freeze({
    configuration,
    prepare: (capture, scenario) => prepare(capture, scenario, configuration,contextual),
    direct: request => {
      const report = calculateStandardEstimatedGrossToNet(request.input, ctx)
      return Object.freeze({ kind: "direct", report, presentation: presentDirectFiscalResult(report) })
    },
    inverse: async (request, signal) => {
      const report = await calculateStandardEstimatedNetToGross({ ...request.input, searchOptions: signal ? { signal } : undefined }, ctx)
      if (report.targetNet !== null && report.targetNet !== request.input.targetNet) throw new FiscalPresentationError("El objetivo devuelto no corresponde a la petición inversa.")
      const presentation = presentInverseFiscalResult(report, request.input.referenceDate)
      return Object.freeze({ kind: "inverse", report, presentation })
    },
  })
}
/** Política actual de la aplicación; la entrada v1 se conserva para controles/originales versionados. */
export function createContextualFiscalAdapter(): FiscalAdapter {
  const registry = createEmbeddedFiscalRegistry2026()
  const authorization = ENGINE_FISCAL_CAPABILITIES.authorizations[0]
  const manifest = registry.entries[0].manifest
  const configuration = Object.freeze({ profileId: authorization.simulationProfileId, fiscalPackageVersion: manifest.parameterVersion, supportedDates: manifest.supportedDates })
  const bindings = new WeakMap<PreparedFiscalRequest, Readonly<{ adapter: FiscalAdapter; provenance: ExecutionDocumentProvenance }>>()
  function bound(request: PreparedFiscalRequest): FiscalAdapter {
    const adapter = bindings.get(request)
    if (!adapter) throw new FiscalPresentationError("La petición no pertenece a una resolución fiscal preparada por esta instancia.")
    return adapter.adapter
  }
  return Object.freeze({
    configuration,
    prepare: (capture, scenario) => {
      const preparation = prepare(capture, scenario, configuration, true)
      if (!preparation.ok) return preparation
      const request = preparation.prepared
      const resolution = resolveFiscalExecution({ fiscalDate: request.input.referenceDate, periodicity: request.input.periodicity,
        simulationProfileId: request.input.profileId, ruleProfileId: authorization.ruleProfileId, contextualPolicyId: authorization.contextualPolicyId,
        operation: request.mode, requiredCapabilities: request.mode === "net-to-gross" ? ["direct", "inverse"] : ["direct"],
      }, registry, ENGINE_FISCAL_CAPABILITIES)
      if (resolution.status === "rejected") {
        const dateFailure = ["INVALID_FISCAL_DATE", "EXERCISE_PACKAGE_MISSING", "DATE_OUTSIDE_PACKAGE_COVERAGE"].includes(resolution.code)
        return Object.freeze({ ok: false as const, snapshot: request.snapshot, issues: Object.freeze([
          adapterIssue(dateFailure ? "effectiveDate" : "request", resolution.code, dateFailure ? "No hay parámetros compatibles para la fecha fiscal indicada." : "El paquete fiscal no dispone de una autorización compatible para esta operación.", dateFailure ? "capture" : "technical"),
        ]) })
      }
      bindings.set(request, Object.freeze({ adapter: createFiscalAdapter(resolution.context.engineContext, true), provenance: documentProvenance(resolution.context, request.monthlyScenario) }))
      return preparation
    },
    direct: request => bound(request).direct(request),
    inverse: async (request, signal) => bound(request).inverse(request, signal),
    executionProvenance: request => {
      const binding = bindings.get(request)
      if (!binding) throw new FiscalPresentationError("La petición no pertenece a esta resolución documental.")
      return binding.provenance
    },
  })
}
