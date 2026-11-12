import { civilDate } from "./civil-date"
import type { FiscalSource, MonetaryComponent } from "./contracts"
import { calculateStandardEstimatedEmploymentSubsidy } from "./employment-subsidy"
import type { StandardEstimatedEmploymentSubsidyResult } from "./employment-subsidy-contracts"
import { FiscalFoundationError } from "./errors"
import { addDecimals, compareDecimals, DECIMAL_POLICY, moneyText, subtractDecimals, type MoneyText } from "./money"
import { selectByEffectiveDate, validateFiscalSource } from "./parameters"
import {assessMinimumRetention,CONTEXTUAL_WITHHOLDING_POLICY,isContextualRetention,parseRetentionContext,type RetentionAssessment} from './minimum-retention-context'
import { STANDARD_CONVENTIONS } from "./simulation-conventions"
import { calculateStandardEstimatedWorkerImss } from "./worker-imss"
import type { StandardEstimatedWorkerImssResult } from "./worker-imss-contracts"
import type { GrossToNetIssue, GrossToNetStage, GrossToNetStatus, GrossToNetWarning, MinimumWageMonthlyScenario, StandardEstimatedGrossToNetResult, StandardGrossToNetContext, StandardWithholdingDecision } from "./gross-to-net-contracts"

type ImssSuccess = Extract<StandardEstimatedWorkerImssResult, { status: "estimated" }>
type SubsidySuccess = Extract<StandardEstimatedEmploymentSubsidyResult, { status: "estimated" }>
const inputFields = new Set(["profileId", "grossPeriodSalary", "periodicity", "referenceDate", "benefits", "area", "includeWorkerImss", "minimumWageMonthlyScenario"])
const zero = moneyText("0", "non-negative")

export const STANDARD_ISR_WITHHOLDING_POLICY = Object.freeze({
  id: "standard-isr-withholding-2026-monthly-minimum-explicit-assumption-v1",
  reference: "LISR-96-first-paragraph" as const,
  ordinary: "reuse-provisional-isr-for-above-minimum-standard-salary" as const,
  minimum: "explicit-compatible-monthly-assumption-or-not-determinable" as const,
  subsidyPartition: "applied-plus-potential-displaced-by-no-withholding-plus-preexisting-excess-over-tariff-isr" as const,
  nature: "conditional-standard-estimate-not-factual-certification" as const,
})
export const STANDARD_GROSS_TO_NET_POLICY = Object.freeze({
  id: "standard-gross-to-net-2026-component-cent-reconciliation-v1",
  order: "compose-worker-imss-and-subsidy-once-then-resolve-withholding-then-exact-net" as const,
  net: "gross-minus-estimated-withheld-isr-minus-imss-deducted" as const,
  rounding: "none-beyond-component-determinations" as const,
  nature: "explicit-simulation-policy" as const,
})

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
function issue(stage: GrossToNetStage, field: string, kind: GrossToNetIssue["kind"], code: string, message: string): GrossToNetIssue {
  return Object.freeze({ stages: Object.freeze([stage]), field, kind, code, message })
}
function monetary(amount: MoneyText | null, status: MonetaryComponent["status"], reason?: string): MonetaryComponent {
  return Object.freeze({ status, amount, ...(reason ? { reason } : {}) })
}
function statusOf(issues: readonly GrossToNetIssue[]): GrossToNetStatus {
  return issues.some(item => item.kind === "unsupported-scenario") ? "not-supported" : issues.length ? "not-determinable" : "estimated"
}
function uniqueIssues(issues: readonly GrossToNetIssue[]): readonly GrossToNetIssue[] {
  const items = new Map<string, GrossToNetIssue>()
  for (const item of issues) {
    const key = `${item.field}|${item.kind}|${item.code}`
    const previous = items.get(key)
    items.set(key, previous ? Object.freeze({ ...previous, stages: Object.freeze([...new Set([...previous.stages, ...item.stages])]) }) : item)
  }
  return Object.freeze([...items.values()])
}

function parseScenario(value: unknown, issues: GrossToNetIssue[]): MinimumWageMonthlyScenario | null {
  const field = "minimumWageMonthlyScenario"
  if (!record(value)) {
    issues.push(issue("capture", field, value == null ? "missing-data" : "invalid-format", "REQUIRED_MONTHLY_MINIMUM_SCENARIO", "Indica explícitamente un contexto sin confirmar, hipótesis mensual o contexto fuera del perfil."))
    return null
  }
  if (typeof value.kind !== "string" || !value.kind.trim()) {
    issues.push(issue("capture", field, value.kind == null || value.kind === "" ? "missing-data" : "invalid-format", "REQUIRED_MONTHLY_MINIMUM_SCENARIO_KIND", "La declaración requiere un identificador de modalidad explícito."))
    return null
  }
  if(isContextualRetention(value)){
    try{return parseRetentionContext(value)}catch(error){issues.push(issue('capture',field,'invalid-format','INVALID_RETENTION_CONTEXT',error instanceof Error?error.message:'Contexto inválido.'));return null}
  }
  if (value.kind === "unconfirmed" || value.kind === "monthly-payments-outside-standard-profile") {
    if (Object.keys(value).some(key => key !== "kind")) {
      issues.push(issue("capture", field, "unsupported-scenario", "EXTRA_MONTHLY_CONTEXT_NOT_SUPPORTED", "No se admiten importes, intervalos ni hechos mensuales adicionales en este escenario."))
      return null
    }
    if (value.kind === "monthly-payments-outside-standard-profile") issues.push(issue("retention", field, "unsupported-scenario", "MONTHLY_PAYMENTS_OUTSIDE_STANDARD_PROFILE", "Los pagos o cambios mensuales adicionales requieren otro perfil; no se calcula neto omitiéndolos."))
    return Object.freeze({ kind: value.kind })
  }
  if (value.kind !== "only-general-minimum-assumed-for-reference-month") {
    issues.push(issue("capture", field, "unsupported-scenario", "MONTHLY_MINIMUM_SCENARIO_NOT_SUPPORTED", "La modalidad de declaración mensual no pertenece al contrato aprobado."))
    return null
  }
  const allowed = new Set(["kind", "referenceMonth", "noOtherSalaryPayments", "acknowledgement"])
  if (Object.keys(value).some(key => !allowed.has(key))) {
    issues.push(issue("capture", field, "unsupported-scenario", "EXTRA_MONTHLY_CONTEXT_NOT_SUPPORTED", "La hipótesis no acepta percepciones reales, intervalos ni otros conceptos."))
    return null
  }
  if (typeof value.referenceMonth !== "string" || !/^\d{4}-\d{2}$/.test(value.referenceMonth)) {
    issues.push(issue("capture", `${field}.referenceMonth`, "invalid-format", "INVALID_REFERENCE_MONTH", "El mes civil debe expresarse como YYYY-MM."))
    return null
  }
  try { civilDate(`${value.referenceMonth}-01`) }
  catch (error) {
    if (!(error instanceof FiscalFoundationError)) throw error
    issues.push(issue("capture", `${field}.referenceMonth`, "invalid-format", "INVALID_REFERENCE_MONTH", error.message))
    return null
  }
  if (value.noOtherSalaryPayments !== true || value.acknowledgement !== "explicit-standard-simulation-assumption-not-payroll-verification") {
    issues.push(issue("capture", field, value.noOtherSalaryPayments === false ? "unsupported-scenario" : "invalid-value", "INCOMPLETE_MONTHLY_MINIMUM_ASSUMPTION", "Se exige afirmar ausencia de otras percepciones salariales y reconocer que es hipótesis explícita, no verificación de nómina real."))
    return null
  }
  return Object.freeze({ kind: value.kind, referenceMonth: value.referenceMonth, noOtherSalaryPayments: true, acknowledgement: value.acknowledgement })
}

function retentionSources(value: unknown): readonly FiscalSource[] {
  if (!Array.isArray(value) || !value.length) throw new FiscalFoundationError("MISSING_PARAMETER", "Falta la fuente normativa de la decisión de retención LISR 96.")
  for (const source of value) {
    if (!record(source) || typeof source.document !== "string" || typeof source.locator !== "string") throw new FiscalFoundationError("INVALID_METADATA", "La fuente de retención está incompleta.")
    validateFiscalSource(source as unknown as FiscalSource)
  }
  return Object.freeze((value as FiscalSource[]).map(source => Object.freeze({ ...source })))
}
function parameterVersions(imss: ImssSuccess | null, subsidy: SubsidySuccess | null) {
  const versions = new Map<string, string>()
  for (const report of [imss, subsidy]) {
    if (!report) continue
    const ids = report.data.parameterSetIds
    const entries = report.data.parameterSetVersions
    if (new Set(ids).size !== ids.length || new Set(entries.map(entry => entry.id)).size !== entries.length || entries.length !== ids.length) {
      throw new FiscalFoundationError("INCOMPATIBLE_PARAMETERS", "Las referencias de parámetros de un componente son incompletas o duplicadas.")
    }
    for (const { id, version } of entries) {
      if (!ids.includes(id) || !version.trim() || (versions.has(id) && versions.get(id) !== version)) throw new FiscalFoundationError("INCOMPATIBLE_PARAMETERS", "Los componentes discrepan en identificador o versión de un parámetro compartido.")
      versions.set(id, version)
    }
  }
  return Object.freeze([...versions].map(([id, version]) => Object.freeze({ id, version })))
}
function assertCoherent(imss: ImssSuccess, subsidy: SubsidySuccess, capture: Record<string, unknown>, context: StandardGrossToNetContext): void {
  const sbc = imss.data.sbcResult.data
  const normalized = sbc.integration.normalized
  const isr = subsidy.data.isrResult
  const packageVersion = context.fiscalPackageVersion
  const packageVersions = [imss.data.fiscalPackageVersion, sbc.fiscalPackageVersion, normalized.fiscalPackageVersion, subsidy.data.fiscalPackageVersion, isr.data.fiscalPackageVersion]
  const profiles = [normalized.profileId, isr.data.profileId, capture.profileId]
  const dates = [normalized.referenceDate, sbc.referenceDate, imss.data.referenceDate, subsidy.data.referenceDate, isr.data.referenceDate, capture.referenceDate]
  const periods = [normalized.periodicity, imss.data.periodicity, subsidy.data.periodicity, isr.data.periodicity, capture.periodicity]
  if (packageVersions.some(version => version !== packageVersion) || profiles.some(profile => profile !== STANDARD_CONVENTIONS.id)
    || dates.some(date => date !== normalized.referenceDate) || periods.some(period => period !== normalized.periodicity)
    || capture.area !== "general-zone" || imss.data.area !== capture.area || sbc.area !== capture.area || imss.data.includeWorkerImss !== capture.includeWorkerImss
    || compareDecimals(normalized.grossPeriodSalary, isr.data.taxableIncome) !== 0 || compareDecimals(normalized.grossPeriodSalary, capture.grossPeriodSalary as string) !== 0
    || imss.data.estimatedSbc !== sbc.sbc.estimatedSbc
    || imss.data.contractualMinimumCheck.relation !== sbc.contractualMinimumCheck.relation
    || compareDecimals(imss.data.contractualMinimumCheck.comparedValue, sbc.contractualMinimumCheck.comparedValue) !== 0
    || compareDecimals(imss.data.contractualMinimumCheck.referenceMinimum, sbc.contractualMinimumCheck.referenceMinimum) !== 0
    || subsidy.amounts.isrByTariff !== isr.isrByTariff || isr.data.salaryNature !== "ordinary-fixed" || isr.data.taxTreatment !== "fully-taxable") {
    throw new FiscalFoundationError("INCOMPATIBLE_PARAMETERS", "Bruto, perfil, periodo, fecha, zona, interruptor, SBC o paquete discrepan entre componentes.")
  }
  const uma = subsidy.data.parameters.uma
  const subsidySet = subsidy.data.parameters.subsidy
  if (!imss.data.parameterSetIds.includes(uma.id) || !subsidy.data.parameterSetIds.includes(uma.id) || !subsidy.data.parameterSetIds.includes(subsidySet.id)
    || !subsidy.data.parameterSetVersions.some(entry => entry.id === uma.id && entry.version === uma.version)
    || !subsidy.data.parameterSetVersions.some(entry => entry.id === subsidySet.id && entry.version === subsidySet.version)
    || compareDecimals(imss.data.umaDaily, uma.data.daily) !== 0 || compareDecimals(sbc.limits.umaDaily, uma.data.daily) !== 0 || imss.data.umaValueYear !== uma.data.valueYear || subsidy.data.umaValueYear !== uma.data.valueYear
    || imss.data.precisionPolicy !== DECIMAL_POLICY.id || subsidy.data.precisionPolicy !== DECIMAL_POLICY.id || isr.data.precisionPolicy !== DECIMAL_POLICY.id
    || imss.data.conventionVersion !== STANDARD_CONVENTIONS.id || subsidy.data.conventionVersion !== STANDARD_CONVENTIONS.id) {
    throw new FiscalFoundationError("INCOMPATIBLE_PARAMETERS", "Los componentes no comparten UMA, parámetros, precisión o convención coherentes.")
  }
}

function activeWarnings(imss: StandardEstimatedWorkerImssResult | null, subsidy: StandardEstimatedEmploymentSubsidyResult | null, resolved: boolean, conditional: boolean,assessment?:RetentionAssessment): readonly GrossToNetWarning[] {
  const items = new Map<string, GrossToNetWarning>()
  const superseded = new Set(["MINIMUM_WAGE_WITHHOLDING_EXCEPTION_NOT_EVALUATED", "NOT_FINAL_ISR_WITHHOLDING", "PROVISIONAL_ISR_AFTER_SUBSIDY"])
  function add(stage: GrossToNetStage | "composition", warning: { code: string; message: string; field?: string }) {
    if(assessment?.context.salaryBasis==='fixed-period'&&warning.code==='CONTRACTUAL_DAILY_SALARY_BELOW_GENERAL_MINIMUM')warning={...warning,message:'El cociente del periodo estándar queda por debajo de la referencia del perfil. No acredita un salario diario pactado ni permite reinterpretar pagos por días reales.'}
    if (resolved && stage === "subsidy" && superseded.has(warning.code)) return
    const key = `${warning.code}|${warning.field ?? ""}`
    const previous = items.get(key)
    items.set(key, Object.freeze({ code: warning.code, message: warning.message, ...(warning.field ? { field: warning.field } : {}), stages: Object.freeze([...new Set([...(previous?.stages ?? []), stage])]) }))
  }
  for (const warning of imss?.warnings ?? []) add("imss", warning)
  for (const warning of subsidy?.warnings ?? []) add("subsidy", warning)
  add("composition", { code: "STANDARD_RESULT_NOT_CERTIFIED", message: "El resultado resuelve etapas del escenario estándar estimado; no certifica percepciones, retenciones practicadas ni liquidación mensual real." })
  if (conditional) {
    add("composition", { code: "MONTHLY_MINIMUM_CONDITION_ASSUMED", message: "No retención condicionada a hipótesis mensual expresa del usuario; la igualdad del diario por sí sola no acredita LISR 96." })
    add("composition", { code: "SUBSIDY_DISPLACED_BY_NO_WITHHOLDING", message: "La aplicación potencial no usada por no retención se separa del excedente previo sobre ISR por tarifa; ninguna cantidad se entrega en efectivo." })
  }
  return Object.freeze([...items.values()])
}

/** Composes each approved operation once. No repeated integration, SBC or tariff calculation. */
export function calculateStandardEstimatedGrossToNet(input: unknown, context: StandardGrossToNetContext): StandardEstimatedGrossToNetResult {
  const issues: GrossToNetIssue[] = []
  let imss: StandardEstimatedWorkerImssResult | null = null
  let subsidy: StandardEstimatedEmploymentSubsidyResult | null = null
  let scenario: MinimumWageMonthlyScenario | null = null
  if (!record(input)) issues.push(issue("capture", "request", input == null ? "missing-data" : "invalid-format", "INVALID_GROSS_TO_NET_REQUEST", "Se requiere captura estándar completa para bruto a neto."))
  else {
    if (Object.keys(input).some(key => !inputFields.has(key))) issues.push(issue("capture", "request", "unsupported-scenario", "GROSS_TO_NET_EXTRA_CONCEPT_NOT_SUPPORTED", "No se admiten neto objetivo, pagos adicionales ni calendario real."))
    scenario = parseScenario(input.minimumWageMonthlyScenario, issues)
    const { minimumWageMonthlyScenario: _scenario, ...imssInput } = input
    // Un pago declarado por calendario real no se reinterpreta como G/30 para IMSS.
    if(!(isContextualRetention(scenario)&&scenario.salaryBasis==='actual-calendar'))imss = calculateStandardEstimatedWorkerImss(imssInput, context)
    subsidy = calculateStandardEstimatedEmploymentSubsidy({ profileId: input.profileId, grossPeriodSalary: input.grossPeriodSalary, periodicity: input.periodicity, referenceDate: input.referenceDate }, context)
    if (imss&&imss.status !== "estimated") for (const item of imss.issues){
      const contextualReference=isContextualRetention(scenario)&&scenario.salaryBasis==='fixed-period'&&input.periodicity==='monthly'&&item.code==='WORKER_IMSS_CONTRACT_BELOW_GENERAL_MINIMUM'
      issues.push(issue('imss',item.field,item.kind,contextualReference?'FIXED_PERIOD_DAILY_REFERENCE_BELOW_PROFILE':item.code,contextualReference?'El cociente mensual entre 30 queda fuera del perfil soportado; no demuestra el diario pactado de una remuneración por 28/30/31 días reales.':item.message))
    }
    if (subsidy.status !== "estimated") for (const item of subsidy.issues) issues.push(issue("subsidy", item.field, item.kind, item.code, item.message))
  }
  const imssSuccess = imss?.status === "estimated" ? imss : null
  const subsidySuccess = subsidy?.status === "estimated" ? subsidy : null
  const sbc = imssSuccess?.data.sbcResult ?? (imss?.status !== "estimated" ? imss?.diagnosticSbc : null) ?? null
  const originalIsr = subsidySuccess?.data.isrResult ?? (subsidy?.status !== "estimated" ? subsidy?.diagnosticIsr : null) ?? null
  const gross = sbc?.data.integration.normalized.grossPeriodSalary ?? originalIsr?.data.taxableIncome ?? null
  let sources: readonly FiscalSource[] = Object.freeze([])
  let versions: readonly Readonly<{ id: string; version: string }>[] = Object.freeze([])
  try { sources = retentionSources(context?.retentionRuleSources) }
  catch (error) {
    if (!(error instanceof FiscalFoundationError)) throw error
    issues.push(issue("retention", "parameters", "parameter-data", error.code, error.message))
  }
  try {
    versions = parameterVersions(imssSuccess, subsidySuccess)
    if (imssSuccess && subsidySuccess && record(input)) assertCoherent(imssSuccess, subsidySuccess, input, context)
  } catch (error) {
    if (!(error instanceof FiscalFoundationError)) throw error
    issues.push(issue("coherence", "parameters", "parameter-data", error.code, error.message))
  }
  const date = sbc?.data.referenceDate ?? originalIsr?.data.referenceDate ?? null
  const referenceMonth = date?.slice(0, 7) ?? null
  let assessment:RetentionAssessment|undefined
  if(isContextualRetention(scenario)&&gross&&date){
    try{
      const minimum=selectByEffectiveDate(context.minimumWages,date,context.supportedDates)
      assessment=assessMinimumRetention(scenario,{gross,periodicity:originalIsr!.data.periodicity,date,dailySalary:sbc?.data.integration.dailySalary.internal.value??null,dailyMinimum:minimum.data.general.daily,publishedMonthly:minimum.data.general.publishedMonthlyReference})
    }catch(error){if(!(error instanceof FiscalFoundationError))throw error;issues.push(issue('retention','parameters','parameter-data',error.code,error.message))}
  }
  let decisionKind: StandardWithholdingDecision["kind"] = "blocked"
  let decisionReason = "REQUIRED_COMPONENT_OR_SCENARIO_UNAVAILABLE"
  if (scenario?.kind === "only-general-minimum-assumed-for-reference-month" && referenceMonth && scenario.referenceMonth !== referenceMonth) {
    issues.push(issue("retention", "minimumWageMonthlyScenario.referenceMonth", "invalid-value", "MONTHLY_MINIMUM_MONTH_MISMATCH", "La declaración mensual no corresponde al mes de la fecha normativa."))
  }
  if (scenario?.kind === "only-general-minimum-assumed-for-reference-month" && sbc && sbc.data.contractualMinimumCheck.relation !== "at-general-minimum") {
    issues.push(issue("retention", "minimumWageMonthlyScenario", "unsupported-scenario", "MONTHLY_MINIMUM_SALARY_MISMATCH", "La hipótesis de mínimo no puede forzar la excepción para un diario contractual distinto del mínimo general."))
  }
  if(assessment){
    decisionReason=assessment.reason
    if(assessment.state==='insufficient-context'){decisionKind='unconfirmed-minimum-month';issues.push(issue('retention','minimumWageMonthlyScenario','missing-data',assessment.reason,assessment.message))}
    else if(assessment.state==='outside-profile'){decisionKind='blocked';issues.push(issue('retention','minimumWageMonthlyScenario','unsupported-scenario',assessment.reason,assessment.message))}
    else if(!issues.length&&imssSuccess&&subsidySuccess)decisionKind=assessment.state==='conditional'?'conditional-no-withholding-LISR-96':'ordinary-above-minimum'
  }else if (!issues.length && imssSuccess && subsidySuccess && scenario) {
    if (imssSuccess.data.contractualMinimumCheck.relation === "above-general-minimum") {
      decisionKind = "ordinary-above-minimum"
      decisionReason = "ABOVE_MINIMUM_ORDINARY_FIXED_STANDARD_PROFILE"
    } else if (scenario.kind === "unconfirmed") {
      decisionKind = "unconfirmed-minimum-month"
      decisionReason = "MONTHLY_MINIMUM_CONFIRMATION_REQUIRED"
      issues.push(issue("retention", "minimumWageMonthlyScenario", "missing-data", decisionReason, "Diario mínimo sin hipótesis mensual compatible: ISR retenido y neto no determinables."))
    } else if (scenario.kind === "only-general-minimum-assumed-for-reference-month") {
      decisionKind = "conditional-no-withholding-LISR-96"
      decisionReason = "LISR_96_EXPLICIT_UNVERIFIED_MONTHLY_MINIMUM_ASSUMPTION"
    }
  }
  if (decisionKind === "blocked" && issues.length) {
    decisionReason = (issues.find(item => item.kind === "unsupported-scenario") ?? issues[0]).code
  }
  let final: Readonly<{ susceptible: MoneyText; withheld: MoneyText; applied: MoneyText; displaced: MoneyText; totalNotApplied: MoneyText; net: MoneyText }> | null = null
  if (!issues.length && imssSuccess && subsidySuccess && gross) {
    try {
      const conditional = decisionKind === "conditional-no-withholding-LISR-96"
      const { isrByTariff, subsidyPotentiallyApplicable, isrAfterSubsidyProvisional, subsidyDetermined, excessNotDelivered } = subsidySuccess.amounts
      const withheld = conditional ? zero : isrAfterSubsidyProvisional
      const applied = conditional ? zero : subsidyPotentiallyApplicable
      // Exclusive partition: the previously applicable portion is displaced, not reclassified as excess over tariff ISR.
      const displaced = conditional ? subsidyPotentiallyApplicable : zero
      const totalNotApplied = moneyText(addDecimals(displaced, excessNotDelivered).value, "non-negative")
      const difference = subtractDecimals(subtractDecimals(gross, withheld).value, imssSuccess.quotas.deducted)
      if (!difference.exact || compareDecimals(difference.value, "0") < 0) throw new FiscalFoundationError("INCOMPATIBLE_PARAMETERS", "Las deducciones no permiten un neto no negativo; no se corrige silenciosamente.")
      const net = moneyText(difference.value, "non-negative")
      const reconciliations = [
        [addDecimals(addDecimals(net, withheld).value, imssSuccess.quotas.deducted), gross],
        [addDecimals(addDecimals(imssSuccess.quotas.deducted, imssSuccess.quotas.absorbedByEmployer).value, imssSuccess.quotas.excludedBySimulation), imssSuccess.quotas.calculated],
        [addDecimals(addDecimals(applied, displaced).value, excessNotDelivered), subsidyDetermined],
        [addDecimals(isrAfterSubsidyProvisional, subsidyPotentiallyApplicable), isrByTariff],
      ] as const
      if (reconciliations.some(([sum, expected]) => !sum.exact || compareDecimals(sum.value, expected) !== 0)) throw new FiscalFoundationError("INCOMPATIBLE_PARAMETERS", "Neto, IMSS o distribución del subsidio no concilian exactamente.")
      final = Object.freeze({ susceptible: conditional ? zero : isrByTariff, withheld, applied, displaced, totalNotApplied, net })
    } catch (error) {
      if (!(error instanceof FiscalFoundationError)) throw error
      issues.push(issue("net", "calculation", "parameter-data", error.code, error.message))
      decisionKind = "blocked"
      decisionReason = "MONETARY_RECONCILIATION_FAILED"
    }
  }
  const status = statusOf(issues)
  const blockedStatus = status === "estimated" ? "not-determinable" : status
  const blocked = (reason: string) => monetary(null, blockedStatus, reason)
  const fromSubsidy = (amount: MoneyText | undefined) => amount === undefined ? monetary(null, subsidy?.status === "not-supported" ? "not-supported" : "not-determinable", "SUBSIDY_COMPONENT_UNAVAILABLE") : monetary(amount, "estimated")
  const fromImss = (amount: MoneyText | null | undefined) => amount == null ? monetary(null, imss?.status === "not-supported" ? "not-supported" : "not-determinable", "IMSS_COMPONENT_UNAVAILABLE") : monetary(amount, "estimated")
  const allSources = [...new Map([...(sbc?.data.sources ?? []), ...(subsidySuccess?.data.sources ?? originalIsr?.data.sources ?? []), ...sources].map(source => [`${source.url}|${source.locator}`, Object.freeze({ ...source })])).values()]
  const policies = [
    { component: "gross-to-net", version: STANDARD_GROSS_TO_NET_POLICY.id }, { component: "withholding", version: isContextualRetention(scenario)?CONTEXTUAL_WITHHOLDING_POLICY.id:STANDARD_ISR_WITHHOLDING_POLICY.id },
    { component: "decimal", version: DECIMAL_POLICY.id }, { component: "convention", version: STANDARD_CONVENTIONS.id },
    ...(sbc ? [{ component: "integration", version: sbc.data.integration.integrationRulesVersion }, { component: "sbc", version: sbc.data.policyVersion }] : []),
    ...(imssSuccess ? [{ component: "worker-imss", version: imssSuccess.data.policyVersion }] : []),
    ...(originalIsr ? [{ component: "isr-tariff", version: originalIsr.data.policyVersion }] : []),
    ...(subsidySuccess ? [{ component: "employment-subsidy", version: subsidySuccess.data.policyVersion }] : []),
  ]
  const common = {
    operation: "gross-to-net" as const,
    gross: gross ? monetary(gross, "valid", "VALIDATED_DECLARED_GROSS_NOT_LABOR_CERTIFICATION") : blocked("VALIDATED_GROSS_UNAVAILABLE"),
    integration: Object.freeze({ status: sbc ? "estimated" as const : blockedStatus, data: sbc?.data.integration ?? null }), sbc,
    isr: Object.freeze({
      accordingToTariff: originalIsr ? monetary(originalIsr.isrByTariff, "estimated") : blocked("ISR_TARIFF_UNAVAILABLE"),
      afterSubsidyProvisional: fromSubsidy(subsidySuccess?.amounts.isrAfterSubsidyProvisional),
      beforeSubsidyAfterExceptions: final ? monetary(final.susceptible, "estimated") : blocked("WITHHOLDING_DECISION_UNRESOLVED"),
      withheld: final ? monetary(final.withheld, "estimated", decisionReason) : blocked(decisionReason),
    }),
    subsidy: Object.freeze({
      determined: fromSubsidy(subsidySuccess?.amounts.subsidyDetermined), potentiallyApplicable: fromSubsidy(subsidySuccess?.amounts.subsidyPotentiallyApplicable),
      applied: final ? monetary(final.applied, "estimated") : blocked("FINAL_SUBSIDY_DISTRIBUTION_UNRESOLVED"),
      notAppliedDueToNoWithholding: final ? monetary(final.displaced, "estimated", "POTENTIALLY_APPLICABLE_PORTION_DISPLACED_BY_NO_WITHHOLDING") : blocked("FINAL_SUBSIDY_DISTRIBUTION_UNRESOLVED"),
      excessOverTariffIsrNotDelivered: fromSubsidy(subsidySuccess?.amounts.excessNotDelivered),
      totalNotApplied: final ? monetary(final.totalNotApplied, "estimated") : blocked("FINAL_SUBSIDY_DISTRIBUTION_UNRESOLVED"),
      cashDelivered: fromSubsidy(subsidySuccess?.amounts.cashDelivered),
    }),
    imss: Object.freeze({ calculated: fromImss(imss?.quotas.calculated), deducted: fromImss(imss?.quotas.deducted), absorbedByEmployer: fromImss(imss?.quotas.absorbedByEmployer), excludedBySimulation: fromImss(imss?.quotas.excludedBySimulation), byBranch: imss?.byBranch ?? null }),
    retention: Object.freeze({ status: final ? "estimated" as const : blockedStatus, kind: decisionKind, reason: decisionReason, scenario, referenceMonth, factualMonthlyVerification: "not-performed" as const, nature: "standard-scenario-estimate-not-actual-withholding" as const, policyVersion: isContextualRetention(scenario)?CONTEXTUAL_WITHHOLDING_POLICY.id:STANDARD_ISR_WITHHOLDING_POLICY.id, sources,...(assessment?{assessment}:{}) }),
    modules: Object.freeze({ workerImss: imss, employmentSubsidy: subsidy }),
    provenance: Object.freeze({
      fiscalPackageVersion: typeof context?.fiscalPackageVersion === "string" ? context.fiscalPackageVersion : null,
      parameterSetIds: Object.freeze(versions.map(entry => entry.id)), parameterSetVersions: versions, policyVersions: Object.freeze(policies.map(policy => Object.freeze(policy))), sources: Object.freeze(allSources),
      assumptions: Object.freeze([...new Set([
        ...(imssSuccess?.data.assumptions ?? sbc?.data.assumptions ?? []), ...(subsidySuccess?.data.assumptions ?? []),
        "Los reportes de etapas anteriores se conservan intactos; la retención y distribución final pertenecen solo a esta composición.",
        "La retención ordinaria copia ISR provisional del perfil fijo superior al mínimo; no certifica retenciones realizadas ni conciliación mensual real.",
        "La no retención LISR 96 requiere hipótesis mensual expresa compatible; no se infiere de igualdad del diario, SBC, prestaciones o interruptor IMSS.",
        "Subsidio determinado = aplicado + aplicación potencial desplazada por no retención + excedente previo sobre ISR por tarifa; categorías excluyentes, sin entrega de efectivo.",
        "Neto = bruto − ISR retenido estimado − cuotas IMSS descontadas; sin sumar subsidio, descontar absorción o volver a redondear.",
      ])]), fiscalCertification: "not-certified" as const, actualMonthlyContextVerified: false as const, actualWithholdingConfirmed: false as const, suaEquivalence: "not-validated" as const, contpaqiEquivalence: "not-validated" as const,
    }),
    issues: uniqueIssues(issues), warnings: activeWarnings(imss, subsidy, final !== null, decisionKind === "conditional-no-withholding-LISR-96" && final !== null,assessment),
  }
  return final && status === "estimated"
    ? Object.freeze({ ...common, status: "estimated", complete: true, net: Object.freeze({ status: "estimated", amount: final.net }), reconciliationVerified: true })
    : Object.freeze({ ...common, status: blockedStatus, complete: false, net: Object.freeze({ status: blockedStatus, amount: null, reason: decisionReason }), reconciliationVerified: false })
}
