import type { ImssBranch, ImssConstants } from "./contracts"
import { FiscalFoundationError } from "./errors"
import { addDecimals, compareDecimals, DECIMAL_POLICY, decimalText, moneyText, multiplyDecimals, presentMoney, subtractDecimals, type DecimalComputation, type MoneyText } from "./money"
import { selectByEffectiveDate } from "./parameters"
import { calculateStandardEstimatedSbc } from "./sbc"
import { STANDARD_CONVENTIONS } from "./simulation-conventions"
import type { SbcWarning } from "./sbc-contracts"
import type { EstimatedSbcSuccess, StandardEstimatedWorkerImssResult, StandardWorkerImssContext, WorkerImssAllocation, WorkerImssAmounts, WorkerImssBranchResult, WorkerImssFailure, WorkerImssIssue } from "./worker-imss-contracts"

const branches: readonly ImssBranch[] = Object.freeze([
  "pensioner-medical", "cash-benefits", "disability-life", "unemployment-old-age", "excess-medical",
])
const zero = moneyText("0", "non-negative")

export const STANDARD_WORKER_IMSS_POLICY = Object.freeze({
  id: "standard-worker-imss-general-2026-half-up-per-branch-v1",
  nature: "explicit-simulation-policy" as const,
  base: "existing-estimated-sbc-at-cents" as const,
  order: "unrounded-daily-quota-then-reference-days-then-round-each-branch-then-sum" as const,
  rounding: "half-up" as const,
  decimals: 2 as const,
  minimumComparison: "unrounded-contractual-daily-salary" as const,
  subminimumTreatment: "not-supported-even-when-imss-excluded" as const,
  allocationPriority: "legal-absorption-before-simulation-switch" as const,
  suaEquivalence: "not-validated" as const,
  contpaqiEquivalence: "not-validated" as const,
})

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
function issue(field: WorkerImssIssue["field"], kind: WorkerImssIssue["kind"], code: string, message: string): WorkerImssIssue {
  return Object.freeze({ field, kind, code, message })
}
function failure(issues: readonly WorkerImssIssue[], warnings: readonly SbcWarning[] = [], diagnosticSbc: EstimatedSbcSuccess | null = null): WorkerImssFailure {
  return Object.freeze({
    status: issues.some(item => item.kind === "unsupported-scenario") ? "not-supported" : "not-determinable",
    data: null,
    quotas: Object.freeze({ calculated: null, deducted: null, absorbedByEmployer: null, excludedBySimulation: null }),
    byBranch: null, diagnosticSbc, issues: Object.freeze([...issues]), warnings: Object.freeze([...warnings]),
  })
}

/** Guard incomplete dataset bodies/metadata before delegating to the typed SBC API. */
function validateContextBodies(context: StandardWorkerImssContext): void {
  if (!context || !Array.isArray(context.imssConstants)) {
    throw new FiscalFoundationError("MISSING_PARAMETER", "Falta el contexto versionado de cuotas IMSS.")
  }
  for (const series of [context.contractualDivisors, context.laborBenefitMinima, context.uma, context.minimumWages, context.imssConstants]) {
    if (!Array.isArray(series)) throw new FiscalFoundationError("MISSING_PARAMETER", "Falta una serie necesaria para el SBC y las cuotas.")
    for (const set of series) {
      if (!record(set) || !record(set.data)) throw new FiscalFoundationError("INVALID_METADATA", "Un conjunto de parámetros carece de datos estructurados.")
      if (typeof set.id !== "string" || typeof set.key !== "string" || typeof set.version !== "string" || !Array.isArray(set.sources)
        || set.sources.some(source => !record(source) || typeof source.document !== "string" || typeof source.locator !== "string")) {
        throw new FiscalFoundationError("INVALID_METADATA", "Los identificadores, versiones o fuentes de un conjunto están incompletos.")
      }
      if (set.kind === "minimum-wages" && !record(set.data.general)) {
        throw new FiscalFoundationError("INVALID_METADATA", "Falta el salario mínimo de zona general.")
      }
    }
  }
}

function validateWorkerConstants(data: ImssConstants): void {
  if (!record(data.workerRates) || !record(data.baseReferences) || data.workerAbsorptionReference !== "LSS-36") {
    throw new FiscalFoundationError("INCOMPATIBLE_PARAMETERS", "Faltan las tasas, bases o referencia de absorción obrera.")
  }
  const multiple = decimalText(data.excessThresholdUmaDailyMultiple)
  if (compareDecimals(multiple, "0") <= 0 || compareDecimals(multiple, data.sbcCeilingUmaDailyMultiple) >= 0) {
    throw new FiscalFoundationError("INCOMPATIBLE_PARAMETERS", "El umbral de excedente debe ser positivo e inferior al tope SBC.")
  }
  for (const branch of branches) {
    const rate = decimalText(data.workerRates[branch])
    const expectedBase = branch === "excess-medical" ? "sbc-excess-over-threshold" : "sbc"
    if (compareDecimals(rate, "0") <= 0 || compareDecimals(rate, "1") > 0 || data.baseReferences[branch] !== expectedBase) {
      throw new FiscalFoundationError("INCOMPATIBLE_PARAMETERS", "Una tasa o base obrera es incompatible con su ramo.")
    }
  }
  if (Object.keys(data.workerRates).some(key => !branches.includes(key as ImssBranch)) || Object.keys(data.baseReferences).some(key => !branches.includes(key as ImssBranch))) {
    throw new FiscalFoundationError("INCOMPATIBLE_PARAMETERS", "Las constantes incluyen ramos fuera del perfil obrero.")
  }
}

function exact(computation: DecimalComputation): DecimalComputation {
  if (!computation.exact) throw new FiscalFoundationError("DECIMAL_RANGE", "La cuota excede la precisión interna antes de determinar centavos.")
  return computation
}
function verifyReconciliation(amounts: WorkerImssAmounts): void {
  const distributed = addDecimals(addDecimals(amounts.deducted, amounts.absorbedByEmployer).value, amounts.excludedBySimulation)
  if (!distributed.exact || compareDecimals(amounts.calculated, distributed.value) !== 0) {
    throw new FiscalFoundationError("INCOMPATIBLE_PARAMETERS", "La cuota obrera no concilia con su distribución.")
  }
}
function allocate(calculated: MoneyText, allocation: WorkerImssAllocation): WorkerImssAmounts {
  const amounts = Object.freeze({
    calculated,
    deducted: allocation === "deducted" ? calculated : zero,
    absorbedByEmployer: allocation === "absorbed-under-LSS-36" ? calculated : zero,
    excludedBySimulation: allocation === "excluded-by-simulation" ? calculated : zero,
  })
  verifyReconciliation(amounts)
  return amounts
}

/** Standard estimate only. Reuses SBC; does not determine calendar liabilities or net pay. */
export function calculateStandardEstimatedWorkerImss(input: unknown, context: StandardWorkerImssContext): StandardEstimatedWorkerImssResult {
  if (!record(input)) {
    return failure([issue("request", input == null ? "missing-data" : "invalid-format", "INVALID_WORKER_IMSS_REQUEST", "Se requiere captura estándar de SBC y el interruptor IMSS explícito.")])
  }
  if (typeof input.includeWorkerImss !== "boolean") {
    return failure([issue("includeWorkerImss", input.includeWorkerImss == null ? "missing-data" : "invalid-format", "REQUIRED_WORKER_IMSS_SWITCH", "Incluir IMSS debe ser un booleano explícito, sin valor predeterminado.")])
  }
  const { includeWorkerImss, ...sbcInput } = input
  let sbcResult: EstimatedSbcSuccess | null = null
  try {
    validateContextBodies(context)
    const result = calculateStandardEstimatedSbc(sbcInput, context)
    if (result.status !== "estimated") return failure(result.issues, result.warnings)
    sbcResult = result
    const { data } = result
    if (data.contractualMinimumCheck.relation === "below-general-minimum") {
      return failure([issue("grossPeriodSalary", "unsupported-scenario", "WORKER_IMSS_CONTRACT_BELOW_GENERAL_MINIMUM", "El diario contractual interno es inferior al mínimo: no se determinan cuotas ni descuento, incluso con IMSS excluido.")], result.warnings, result)
    }

    const constants = selectByEffectiveDate(context.imssConstants, data.referenceDate, context.supportedDates)
    validateWorkerConstants(constants.data)
    const periodicity = data.integration.normalized.periodicity
    const days = decimalText(STANDARD_CONVENTIONS.referenceCotizedDays[periodicity])
    const thresholdDaily = exact(multiplyDecimals(data.limits.umaDaily, constants.data.excessThresholdUmaDailyMultiple))
    const comparison = compareDecimals(data.sbc.estimatedSbc, thresholdDaily.value)
    const excessDaily = exact(comparison > 0 ? subtractDecimals(data.sbc.estimatedSbc, thresholdDaily.value) : addDecimals("0", "0"))
    const allocation: WorkerImssAllocation = data.contractualMinimumCheck.relation === "at-general-minimum"
      ? "absorbed-under-LSS-36" : includeWorkerImss ? "deducted" : "excluded-by-simulation"

    const entries = branches.map(branch => {
      const baseReference = constants.data.baseReferences[branch]
      const dailyBase = decimalText(baseReference === "sbc" ? data.sbc.estimatedSbc : excessDaily.value)
      const workerRate = decimalText(constants.data.workerRates[branch])
      const dailyQuota = exact(multiplyDecimals(dailyBase, workerRate))
      const periodQuota = exact(multiplyDecimals(dailyQuota.value, days))
      const determined = presentMoney(periodQuota.value, STANDARD_WORKER_IMSS_POLICY.rounding)
      const branchResult: WorkerImssBranchResult = Object.freeze({
        baseReference, dailyBase, workerRate, dailyQuota, periodQuota,
        rounding: Object.freeze({ mode: "half-up", decimals: 2, before: periodQuota.value, after: determined.amount, changed: determined.rounded }),
        quotas: allocate(determined.amount, allocation),
      })
      return [branch, branchResult] as const
    })
    const byBranch = Object.freeze(Object.fromEntries(entries)) as Readonly<Record<ImssBranch, WorkerImssBranchResult>>
    const amountKeys = ["calculated", "deducted", "absorbedByEmployer", "excludedBySimulation"] as const
    const totals = Object.fromEntries(amountKeys.map(key => {
      const sum = entries.reduce((total, [, branch]) => exact(addDecimals(total, branch.quotas[key])).value, decimalText("0"))
      return [key, moneyText(sum, "non-negative")]
    })) as WorkerImssAmounts
    const quotas = Object.freeze(totals)
    verifyReconciliation(quotas)

    const selectedSets = [context.contractualDivisors, context.laborBenefitMinima, context.uma, context.minimumWages, context.imssConstants]
      .map(series => selectByEffectiveDate<unknown>(series, data.referenceDate, context.supportedDates))
    return Object.freeze({
      status: "estimated", inputValidation: "valid",
      data: Object.freeze({
        sbcResult: result, referenceDate: data.referenceDate, periodicity, area: data.area,
        sbcNature: data.sbcNature, estimatedSbc: data.sbc.estimatedSbc, includeWorkerImss,
        referenceCotizedDays: days, daysNature: "simulation-reference-not-actual-cotization", actualCotizedDays: null,
        temporalScope: "effective-date-snapshot", umaDaily: data.limits.umaDaily, umaValueYear: data.limits.umaValueYear,
        excessThresholdUmaDailyMultiple: decimalText(constants.data.excessThresholdUmaDailyMultiple),
        thresholdDaily, excessDaily, thresholdRelation: comparison < 0 ? "below-threshold" : comparison === 0 ? "at-threshold" : "above-threshold",
        contractualMinimumCheck: data.contractualMinimumCheck, allocation, workerAbsorptionReference: constants.data.workerAbsorptionReference,
        fiscalPackageVersion: data.fiscalPackageVersion, parameterSetIds: data.parameterSetIds,
        parameterSetVersions: Object.freeze(selectedSets.map(set => Object.freeze({ id: set.id, version: set.version }))),
        sources: Object.freeze(data.sources.map(source => Object.freeze({ ...source }))),
        conventionVersion: STANDARD_CONVENTIONS.id, policyVersion: STANDARD_WORKER_IMSS_POLICY.id, precisionPolicy: DECIMAL_POLICY.id,
        assumptions: Object.freeze([
          ...data.assumptions,
          "Cuotas obreras estimadas desde el SBC a centavos del módulo existente; no se reintegra el salario.",
          "Días estándar 7/15/30 como referencia de simulación; días cotizados reales desconocidos.",
          "Las tasas y bases de los cinco ramos se leen del paquete fiscal versionado seleccionado.",
          "Se conserva la cuota diaria interna, se multiplica por días y se redondea half-up por ramo y periodo antes de sumar.",
          "La absorción LSS 36 usa igualdad del diario contractual interno con el mínimo general, no igualdad del SBC.",
          "Excluir IMSS omite únicamente el descuento simulado; no representa exención legal, falta de aseguramiento ni pago adicional patronal.",
          "La absorción legal tiene prioridad sobre el interruptor de exclusión de la simulación.",
          "No se reconstruyen meses naturales, bimestres RCV, movimientos, ausencias ni incapacidades.",
          "El redondeo es una convención explícita del simulador, sin certificación SUA ni CONTPAQi.",
        ]),
        reconciliationVerified: true, suaEquivalence: "not-validated", contpaqiEquivalence: "not-validated",
      }),
      quotas, byBranch, diagnosticSbc: null, issues: Object.freeze([]), warnings: Object.freeze([...result.warnings]),
    })
  } catch (error) {
    if (!(error instanceof FiscalFoundationError)) throw error
    const kind = error.code === "UNSUPPORTED_DATE" ? "unsupported-scenario" : error.code === "DECIMAL_RANGE" ? "technical-range" : "parameter-data"
    return failure([issue("parameters", kind, error.code, error.message)], sbcResult?.warnings ?? [], sbcResult)
  }
}
