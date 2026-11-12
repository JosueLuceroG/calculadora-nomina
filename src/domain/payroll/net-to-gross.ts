import { calculateStandardEstimatedGrossToNet } from "./gross-to-net"
import type { StandardEstimatedGrossToNetResult } from "./gross-to-net-contracts"
import { moneyText, type MoneyText } from "./money"
import { certifyInverseProfile, inverseCents, inverseSignature, reviewedPolicies, type InverseSignature, type SearchCertificate } from "./net-to-gross-certificate"
import type { InverseCandidate, InverseEvidence, MinimumWageCandidateScenario, StandardEstimatedNetToGrossResult, StandardNetToGrossContext } from "./net-to-gross-contracts"
import {isContextualRetention,parseRetentionContext,type ContextualRetentionContext} from './minimum-retention-context'

type Forward = Extract<StandardEstimatedGrossToNetResult, { status: "estimated" }>
type Interval = { lo: bigint; hi: bigint }
type Observation = Readonly<{ g: bigint; n: bigint | null; r: bigint | null; d: bigint | null; k: bigint | null; status: string; codes: readonly string[]; signature: InverseSignature | null; reviewed: boolean; scenario: "unconfirmed" | "conditional-minimum" }>
const MAX_GROSS = 100000000000n
const UNCONFIRMED = Object.freeze({ kind: "unconfirmed" as const })
const inputFields = new Set(["targetNet", "fiscalPackageVersion", "profileId", "periodicity", "referenceDate", "benefits", "area", "includeWorkerImss", "minimumWageCandidateScenario", "searchOptions"])
export const STANDARD_NET_TO_GROSS_POLICY = Object.freeze({
  id: "standard-net-to-gross-2026-certified-intervals-v1",
  technicalGrossRange: Object.freeze({ from: "0.01", to: "1000000000.00" }),
  maxEvaluations: 4096, maxDurationMs: 3000, leafCents: 128, yieldEveryEvaluations: 32,
  authority: "calculateStandardEstimatedGrossToNet-only" as const,
  exactness: "zero-cent-difference-with-complete-reconciled-direct-result" as const,
})
function record(v: unknown): v is Record<string, unknown> { return v !== null && typeof v === "object" && !Array.isArray(v) }
function text(cents: bigint): MoneyText {
  const a = cents < 0n ? -cents : cents
  return moneyText(`${cents < 0n ? "-" : ""}${a / 100n}.${(a % 100n).toString().padStart(2, "0")}`)
}
function frozenCopy<T>(v: T): T {
  if (v !== null && typeof v === "object") { Object.values(v).forEach(frozenCopy); Object.freeze(v) }
  return v
}
class SearchStop extends Error {
  constructor(readonly reason: "evaluation-budget" | "time-budget" | "aborted") { super(reason) }
}
class PreflightStop extends Error {
  constructor(readonly status: "not-supported" | "not-determinable", readonly code: string, message: string) { super(message) }
}
function sameSignature(a: InverseSignature, b: InverseSignature): boolean { return a.every((value, i) => value === b[i]) }

/** Async oracle-driven search. Macrotask yields allow AbortSignal/UI events to run. */
export async function calculateStandardEstimatedNetToGross(input: unknown, context: StandardNetToGrossContext): Promise<StandardEstimatedNetToGrossResult> {
  const start = performance.now()
  let maxEvaluations = 4096, maxDurationMs = 3000
  let signal: AbortSignal | undefined
  let target: bigint | null = null
  let domain: Interval | null = null
  let snapshot: StandardNetToGrossContext | null = null
  let capture: Record<string, unknown> | null = null
  let minimumScenario: MinimumWageCandidateScenario | null = null
  let minimumGross: bigint | null = null
  let reviewRegion:Readonly<{from:MoneyText;to:MoneyText}>|null=null
  let contextSources:StandardEstimatedGrossToNetResult['provenance']['sources']=Object.freeze([])
  let ready = false
  const cache = new Map<string, Observation>()
  const preflightReports = new Map<string, StandardEstimatedGrossToNetResult>()
  const exact = new Map<bigint, InverseCandidate>()
  let below: InverseCandidate | null = null, above: InverseCandidate | null = null
  let recommendedReport: Forward | null = null
  let recommendedGross: bigint | null = null
  let bestDistance: bigint | null = null
  let smallestExact: bigint | null = null
  let anchor: Forward | null = null
  let certificate: SearchCertificate = Object.freeze({ available: false, reason: "NO_PROFILE_CERTIFICATE", maximumRateBasisPoints: 0n, policies: "" })
  let queue: Interval[] = [], active: Interval | null = null
  let initialized = false
  const evidence: InverseEvidence[] = []
  const discontinuities: { before: MoneyText; after: MoneyText; reason: string }[] = []
  const diagnostics: { gross: MoneyText; status: string; codes: readonly string[] }[] = []
  const issues: { field: string; code: string; message: string }[] = []
  let evaluations = 0, hits = 0, yields = 0, peakQueue = 0, certifiedClosures = 0, exhaustivePoints = 0
  let stopReason: StandardEstimatedNetToGrossResult["metrics"]["stopReason"] = "completed"
  let invalidStatus: "not-supported" | "not-determinable" | null = null
  const check = () => {
    if (signal?.aborted) throw new SearchStop("aborted")
    if (performance.now() - start >= maxDurationMs) throw new SearchStop("time-budget")
  }
  const close = (i: Interval, disposition: InverseEvidence["disposition"], reason: string, proof?: InverseEvidence["proof"]) => {
    if (i.lo > i.hi) return
    evidence.push(Object.freeze({ from: text(i.lo), to: text(i.hi), disposition, reason, ...(proof ? { proof } : {}) }))
    if (proof) certifiedClosures++
  }
  const inside = (g: bigint) => domain !== null && g >= domain.lo && g <= domain.hi
  const keyOf = (g: bigint, scenario: unknown) => `${g}|${JSON.stringify(scenario)}`
  const unknownContext=(s:ContextualRetentionContext):ContextualRetentionContext=>Object.freeze({...s,monthlyCondition:'unknown'})
  function collect(o: Observation, report: Forward) {
    if (!ready || target === null || !inside(o.g) || o.n === null) return
    if (minimumScenario?.kind === "conditional-for-exact-minimum" && o.g === minimumGross && o.scenario !== "conditional-minimum") return
    const difference = o.n - target
    const distance = difference < 0n ? -difference : difference
    const candidate: InverseCandidate = Object.freeze({ gross: text(o.g), net: text(o.n), difference: text(difference), absoluteDifference: text(distance), fiscalStatus: "estimated", scenario: o.scenario })
    if (difference === 0n) {
      exact.set(o.g, candidate)
      if (smallestExact === null || o.g < smallestExact) { smallestExact = o.g; recommendedReport = report; recommendedGross = o.g }
    } else {
      if (difference < 0n && (!below || distance < inverseCents(below.absoluteDifference) || (distance === inverseCents(below.absoluteDifference) && o.g < inverseCents(below.gross)))) below = candidate
      if (difference > 0n && (!above || distance < inverseCents(above.absoluteDifference) || (distance === inverseCents(above.absoluteDifference) && o.g < inverseCents(above.gross)))) above = candidate
      if (smallestExact === null && (bestDistance === null || distance < bestDistance || (distance === bestDistance && (recommendedGross === null || o.g < recommendedGross)))) {
        bestDistance = distance; recommendedReport = report; recommendedGross = o.g
      }
    }
  }
  async function evaluate(g: bigint, forcedScenario?: unknown, retain = false): Promise<Observation> {
    check()
    const scenario = forcedScenario ?? (isContextualRetention(minimumScenario)?minimumScenario.monthlyCondition==='minimum-only-assumed'&&g!==minimumGross?unknownContext(minimumScenario):minimumScenario:minimumScenario?.kind === "conditional-for-exact-minimum" && g === minimumGross ? minimumScenario.declaration : UNCONFIRMED)
    const key = keyOf(g, scenario)
    const cached = cache.get(key)
    if (cached) { hits++; return cached }
    if (evaluations >= maxEvaluations) throw new SearchStop("evaluation-budget")
    let report: StandardEstimatedGrossToNetResult
    evaluations++
    try {
      report = calculateStandardEstimatedGrossToNet({ ...capture, grossPeriodSalary: text(g), minimumWageMonthlyScenario: scenario }, snapshot as StandardNetToGrossContext)
    } catch {
      const failed: Observation = Object.freeze({ g, n: null, r: null, d: null, k: null, status: "not-determinable", codes: Object.freeze(["DIRECT_EVALUATION_FAILED"]), signature: null, reviewed: false, scenario: scenario === UNCONFIRMED ? "unconfirmed" : "conditional-minimum" })
      cache.set(key, failed)
      diagnostics.push({ gross: text(g), status: failed.status, codes: failed.codes })
      if (evaluations % STANDARD_NET_TO_GROSS_POLICY.yieldEveryEvaluations === 0) {
        yields++
        await new Promise<void>(resolve => setTimeout(resolve, 0))
        check()
      }
      return failed
    }
    let n: bigint | null = null, r: bigint | null = null, d: bigint | null = null
    const codes = report.issues.map(item => item.code)
    if (report.status === "estimated" && report.complete && report.reconciliationVerified && report.gross.amount !== null && report.isr.withheld.amount !== null && report.imss.deducted.amount !== null) {
      n = inverseCents(report.net.amount); r = inverseCents(report.isr.withheld.amount); d = inverseCents(report.imss.deducted.amount)
      if (inverseCents(report.gross.amount) !== g || n < 0n || r < 0n || d < 0n || n + r + d !== g || report.provenance.fiscalPackageVersion !== snapshot?.fiscalPackageVersion) {
        n = r = d = null; codes.push("DIRECT_RESULT_RECONCILIATION_OR_VERSION_MISMATCH")
      }
    }
    const observation: Observation = Object.freeze({ g, n, r, d, k: r !== null && d !== null ? r + d : null, status: n !== null ? "estimated" : report.status === "not-supported" ? "not-supported" : "not-determinable", codes: Object.freeze(codes), signature: n !== null && report.status === "estimated" ? inverseSignature(report) : null, reviewed: n !== null && report.status === "estimated" && report.retention.kind === "ordinary-above-minimum" && reviewedPolicies(report), scenario: report.retention.kind==='conditional-no-withholding-LISR-96'?'conditional-minimum':'unconfirmed' })
    cache.set(key, observation)
    if (retain) preflightReports.set(key, report)
    if (observation.n === null) diagnostics.push({ gross: text(g), status: observation.status, codes: observation.codes })
    if (observation.n !== null && report.status === "estimated") collect(observation, report)
    if (evaluations % STANDARD_NET_TO_GROSS_POLICY.yieldEveryEvaluations === 0) {
      yields++
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      check()
    }
    return observation
  }
  function proof(a: Observation, b: Observation): InverseEvidence["proof"] | null {
    if (!certificate.available || a.n === null || b.n === null || a.r === null || b.r === null || a.d === null || b.d === null || a.k === null || b.k === null
      || !a.reviewed || !b.reviewed || !a.signature || !b.signature || a.signature[0] !== b.signature[0] || a.r > b.r || a.d > b.d
      || minimumGross === null || a.g <= minimumGross) return null
    // Sufficient admissibility bound for EVERY interior point, not sampled net monotonicity.
    if ((10000n - certificate.maximumRateBasisPoints) * a.g - 10000n * b.d < 5000n) return null
    return Object.freeze({ certificate: "reviewed-components-monotone-2026-v1", from: text(a.g), to: text(b.g), kFrom: text(a.k), kTo: text(b.k), netLower: text(a.g - b.k), netUpper: text(b.g - a.k) })
  }
  try {
    if (!record(input)) throw new PreflightStop("not-determinable", "INVALID_INVERSE_REQUEST", "Se requiere captura explícita del neto objetivo y perfil fiscal.")
    if (Object.keys(input).some(k => !inputFields.has(k))) throw new PreflightStop("not-supported", "INVERSE_EXTRA_CONCEPT_NOT_SUPPORTED", "No se admite bruto inicial, calendario ni conceptos adicionales.")
    target = inverseCents(moneyText(input.targetNet as string, "positive"))
    if (target > MAX_GROSS) throw new PreflightStop("not-supported", "TARGET_OUTSIDE_INVERSE_TECHNICAL_DOMAIN", "El neto objetivo supera el máximo técnico del inverso; no es un límite fiscal.")
    const opts = input.searchOptions === undefined ? {} : input.searchOptions
    if (!record(opts) || Object.keys(opts).some(k => !["grossRange", "maxEvaluations", "maxDurationMs", "signal"].includes(k))) throw new PreflightStop("not-determinable", "INVALID_SEARCH_OPTIONS", "Opciones técnicas de búsqueda inválidas.")
    for (const [name, upper] of [["maxEvaluations", 4096], ["maxDurationMs", 3000]] as const) {
      const v = opts[name]
      if (v !== undefined && (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1 || v > upper)) throw new PreflightStop("not-determinable", "INVALID_SEARCH_BUDGET", "El presupuesto técnico debe ser entero positivo dentro del máximo aprobado.")
    }
    maxEvaluations = opts.maxEvaluations as number ?? 4096; maxDurationMs = opts.maxDurationMs as number ?? 3000
    if (opts.signal !== undefined && (!record(opts.signal) || typeof opts.signal.aborted !== "boolean" || typeof opts.signal.addEventListener !== "function")) throw new PreflightStop("not-determinable", "INVALID_ABORT_SIGNAL", "Se requiere un AbortSignal compatible.")
    signal = opts.signal as AbortSignal | undefined
    let lo = 1n, hi = MAX_GROSS
    if (opts.grossRange !== undefined) {
      if (!record(opts.grossRange) || Object.keys(opts.grossRange).some(k => !["from", "to"].includes(k))) throw new PreflightStop("not-determinable", "INVALID_GROSS_SEARCH_RANGE", "El subdominio debe indicar from/to explícitos.")
      lo = inverseCents(moneyText(opts.grossRange.from as string, "positive")); hi = inverseCents(moneyText(opts.grossRange.to as string, "positive"))
      if (lo > hi || hi > MAX_GROSS) throw new PreflightStop("not-determinable", "INVALID_GROSS_SEARCH_RANGE", "El subdominio está invertido o supera el máximo técnico.")
    }
    domain = { lo, hi }
    if (!context || typeof input.fiscalPackageVersion !== "string" || input.fiscalPackageVersion !== context.fiscalPackageVersion) throw new PreflightStop("not-supported", "INVERSE_FISCAL_VERSION_MISMATCH", "La versión fiscal declarada debe coincidir con el contexto; no se sustituye.")
    const monthly = input.minimumWageCandidateScenario
    if (!record(monthly)) throw new PreflightStop("not-determinable", "REQUIRED_MINIMUM_CANDIDATE_SCENARIO", "Indica explícitamente el escenario del candidato mínimo.")
    if (monthly.kind === "monthly-payments-outside-standard-profile") throw new PreflightStop("not-supported", "MONTHLY_PAYMENTS_OUTSIDE_STANDARD_PROFILE", "El contexto mensual adicional no pertenece al simulador estándar.")
    if(isContextualRetention(monthly))minimumScenario=parseRetentionContext(monthly)
    else if (monthly.kind === "unconfirmed" && Object.keys(monthly).length === 1) minimumScenario = Object.freeze({ kind: "unconfirmed" })
    else if (monthly.kind === "conditional-for-exact-minimum" && Object.keys(monthly).every(k => ["kind", "declaration"].includes(k)) && record(monthly.declaration)) minimumScenario = frozenCopy(structuredClone(monthly)) as unknown as MinimumWageCandidateScenario
    else throw new PreflightStop("not-determinable", "INVALID_MINIMUM_CANDIDATE_SCENARIO", "La hipótesis debe estar tipada y limitada al candidato mínimo exacto.")
    if(isContextualRetention(minimumScenario)){
      if(minimumScenario.salaryBasis==='actual-calendar')throw new PreflightStop('not-supported','ACTUAL_SALARY_CALENDAR_NOT_SUPPORTED','Los pagos por 28/30/31 días reales no se reinterpretan como un periodo estándar en el inverso.')
      if(minimumScenario.monthlyCondition==='outside-profile'||minimumScenario.noOtherSalaryPayments===false)throw new PreflightStop('not-supported','MONTHLY_PAYMENTS_OUTSIDE_STANDARD_PROFILE','El contexto mensual adicional no pertenece al simulador estándar.')
      if(minimumScenario.referenceMonth!==String(input.referenceDate).slice(0,7))throw new PreflightStop('not-supported','LISR96_CONTEXT_MONTH_MISMATCH','La declaración corresponde a otro mes fiscal.')
      if(minimumScenario.monthlyCondition==='minimum-only-assumed'&&minimumScenario.salaryBasis!=='agreed-daily-reference')throw new PreflightStop(input.periodicity==='monthly'?'not-supported':'not-determinable',input.periodicity==='monthly'?'FIXED_MONTHLY_MINIMUM_OUTSIDE_PROFILE':'LISR96_MONTHLY_BASIS_REQUIRED','El mínimo mensual fijo declarado no se resuelve sustituyendo referencias; requiere una política fuera del alcance soportado, no una retención cero automática.')
    }
    snapshot = frozenCopy(structuredClone(context))
    capture = frozenCopy(structuredClone({ profileId: input.profileId, periodicity: input.periodicity, referenceDate: input.referenceDate, benefits: input.benefits, area: input.area, includeWorkerImss: input.includeWorkerImss }))
    ready = minimumScenario.kind === "unconfirmed"||isContextualRetention(minimumScenario)
    check()
    const probeGross = target < lo ? lo : target > hi ? hi : target
    const initialScenario=isContextualRetention(minimumScenario)?unknownContext(minimumScenario):UNCONFIRMED
    await evaluate(probeGross, initialScenario, true)
    const initial = preflightReports.get(keyOf(probeGross, initialScenario))
    if (!initial) throw new PreflightStop("not-determinable", "DIRECT_PREFLIGHT_FAILED", "El directo no proporcionó metadatos verificables.")
    contextSources=initial.provenance.sources
    if(initial.retention.assessment)reviewRegion=Object.freeze({from:moneyText(initial.retention.assessment.reviewRegion.from),to:moneyText(initial.retention.assessment.reviewRegion.to)})
    const permitted = new Set(["WORKER_IMSS_CONTRACT_BELOW_GENERAL_MINIMUM", "MONTHLY_MINIMUM_CONFIRMATION_REQUIRED",'LISR96_MONTHLY_BASIS_REQUIRED','DAILY_REFERENCE_BELOW_PROFILE_MINIMUM','FIXED_PERIOD_DAILY_REFERENCE_BELOW_PROFILE'])
    if (initial.issues.some(i => !permitted.has(i.code))) throw new PreflightStop(initial.status === "not-supported" ? "not-supported" : "not-determinable", "DIRECT_PREFLIGHT_BLOCKED", initial.issues.map(i => `${i.code}: ${i.message}`).join("; "))
    if (initial.sbc?.status !== "estimated") throw new PreflightStop("not-determinable", "MINIMUM_METADATA_UNAVAILABLE", "No hay SBC diagnóstico para localizar el mínimo contractual.")
    minimumGross = inverseCents(initial.sbc.data.contractualMinimumCheck.referenceMinimum) * BigInt(initial.sbc.data.integration.normalized.contractualDivisor)
    if (minimumGross < 1n || minimumGross >= MAX_GROSS) throw new PreflightStop("not-supported", "MINIMUM_OUTSIDE_INVERSE_DOMAIN", "El mínimo contractual no cabe en el dominio técnico admitido.")
    if(isContextualRetention(minimumScenario)&&minimumScenario.monthlyCondition==='minimum-only-assumed'&&minimumScenario.salaryBasis!=='agreed-daily-reference')throw new PreflightStop('not-determinable','LISR96_MONTHLY_BASIS_REQUIRED','La hipótesis de mínimo mensual requiere una base compatible; no se fuerza sobre el importe publicado por CONASAMI.')
    const minScenario: unknown = isContextualRetention(minimumScenario)?minimumScenario:minimumScenario.kind === "conditional-for-exact-minimum" ? minimumScenario.declaration : UNCONFIRMED
    await evaluate(minimumGross, minScenario, true)
    const minimumReport = preflightReports.get(keyOf(minimumGross, minScenario))
    if (!minimumReport || minimumReport.sbc?.status !== "estimated" || minimumReport.sbc.data.contractualMinimumCheck.relation !== "at-general-minimum"
      || minimumReport.issues.some(i => !['MONTHLY_MINIMUM_CONFIRMATION_REQUIRED','LISR96_MONTHLY_BASIS_REQUIRED'].includes(i.code))
      || (minimumScenario.kind === "conditional-for-exact-minimum" && (minimumReport.status !== "estimated" || minimumReport.retention.kind !== "conditional-no-withholding-LISR-96"))) {
      throw new PreflightStop(minimumReport?.status === "not-supported" ? "not-supported" : "not-determinable", "MINIMUM_DECLARATION_OR_BOUNDARY_REJECTED", minimumReport?.issues.map(i => `${i.code}: ${i.message}`).join("; ") || "El directo no confirma la frontera mínima.")
    }
    ready = true
    for (const [key, report] of preflightReports) {
      const observation = cache.get(key)
      if (observation && report.status === "estimated") collect(observation, report)
    }
    let ordinaryGross = probeGross > minimumGross ? probeGross : minimumGross + 1n
    if(isContextualRetention(minimumScenario)&&minimumScenario.salaryBasis==='fixed-period'&&capture.periodicity==='monthly'&&reviewRegion&&ordinaryGross<=inverseCents(reviewRegion.to))ordinaryGross=inverseCents(reviewRegion.to)+1n
    const ordinaryScenario=isContextualRetention(minimumScenario)?unknownContext(minimumScenario):UNCONFIRMED
    await evaluate(ordinaryGross, ordinaryScenario, true)
    const ordinary = preflightReports.get(keyOf(ordinaryGross, ordinaryScenario))
    if (!ordinary || ordinary.status !== "estimated") throw new PreflightStop(ordinary?.status === "not-supported" ? "not-supported" : "not-determinable", "ORDINARY_FISCAL_PREFLIGHT_BLOCKED", ordinary?.issues.map(i => `${i.code}: ${i.message}`).join("; ") || "No hay reporte ordinario completo.")
    anchor = ordinary
    certificate = certifyInverseProfile(ordinary)
    ready = true
    for (const [key, report] of preflightReports) {
      const observation = cache.get(key)
      if (observation && report.status === "estimated") collect(observation, report)
    }
    preflightReports.clear()
    let effectiveLo = lo
    if (effectiveLo < minimumGross && reviewedPolicies(ordinary)) {
      const end = hi < minimumGross ? hi : minimumGross - 1n
      close({ lo: effectiveLo, hi: end }, "excluded-by-scope", "BELOW_DIRECT_VERIFIED_CONTRACTUAL_MINIMUM")
      effectiveLo = end + 1n
    }
    if (effectiveLo < target) {
      const end = hi < target ? hi : target - 1n
      close({ lo: effectiveLo, hi: end }, "proved-no-exact", "NET_CANNOT_EXCEED_GROSS")
      effectiveLo = end + 1n
    }
    const isrReport = ordinary.modules.employmentSubsidy
    if (isrReport?.status !== "estimated") throw new PreflightStop("not-determinable", "TARIFF_PARTITION_UNAVAILABLE", "Falta tarifa seleccionada para particionar.")
    const cuts = new Set<bigint>([effectiveLo, hi + 1n])
    let unresolvedRegion:Interval|null=null
    if(isContextualRetention(minimumScenario)){
      if(minimumScenario.salaryBasis==='fixed-period'&&capture.periodicity==='monthly'&&reviewRegion)unresolvedRegion={lo:minimumGross,hi:inverseCents(reviewRegion.to)}
      else if(minimumScenario.monthlyCondition!=='minimum-only-assumed')unresolvedRegion={lo:minimumGross,hi:minimumGross}
      if(unresolvedRegion){for(const cut of [unresolvedRegion.lo,unresolvedRegion.hi+1n])if(cut>effectiveLo&&cut<=hi)cuts.add(cut)}
    }
    for (const row of isrReport.data.isrResult.data.tariff.data.rows) {
      const lower = inverseCents(row.lower)
      if (lower > effectiveLo && lower <= hi) cuts.add(lower)
      if (row.upper !== null) { const after = inverseCents(row.upper) + 1n; if (after > effectiveLo && after <= hi) cuts.add(after) }
    }
    if (minimumGross >= effectiveLo && minimumGross <= hi) cuts.add(minimumGross)
    if ((!unresolvedRegion||unresolvedRegion.hi===minimumGross)&&minimumGross + 1n > effectiveLo && minimumGross + 1n <= hi) cuts.add(minimumGross + 1n)
    const ordered = [...cuts].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
    queue = []
    if (effectiveLo <= hi) for (let i = 0; i + 1 < ordered.length; i++){
      const part={lo:ordered[i],hi:ordered[i+1]-1n}
      if(unresolvedRegion&&part.lo>=unresolvedRegion.lo&&part.hi<=unresolvedRegion.hi)close(part,'fiscally-unresolved','LISR96_CONTEXTUAL_REGION_UNRESOLVED')
      else queue.push(part)
    }
    queue.reverse(); initialized = true; peakQueue = queue.length
    for (const cut of ordered.slice(1, -1)) discontinuities.push({ before: text(cut - 1n), after: text(cut), reason: cut === minimumGross + 1n ? "MINIMUM_SINGLETON_BOUNDARY" : "OFFICIAL_ISR_BRACKET_BOUNDARY" })
    while (queue.length) {
      check()
      active = queue.pop()!
      const { lo: a, hi: b } = active
      if (b - a + 1n <= 128n) {
        let previous: Observation | null = null
        for (let g = a; g <= b; g++) {
          active = { lo: g, hi: b }
          const o = await evaluate(g)
          if (previous && previous.signature && o.signature && !sameSignature(previous.signature, o.signature)) {
            discontinuities.push({ before: text(previous.g), after: text(g), reason: "EXHAUSTIVELY_OBSERVED_FISCAL_TRANSITION" })
          }
          previous = o
          exhaustivePoints++
          close({ lo: g, hi: g }, o.n === null ? "fiscally-unresolved" : "examined", o.n === null ? o.codes.join("|") || "DIRECT_NET_UNDETERMINED" : "EXHAUSTIVE_CENT")
          active = g < b ? { lo: g + 1n, hi: b } : null
        }
        continue
      }
      const left = await evaluate(a), right = await evaluate(b)
      const p = proof(left, right)
      if (p && target !== null) {
        if (target < inverseCents(p.netLower) || target > inverseCents(p.netUpper)) {
          close(active, "proved-no-exact", "CERTIFIED_NET_ENVELOPE_EXCLUDES_TARGET", p); active = null; continue
        }
        const newLo = a > target + left.k! ? a : target + left.k!
        const newHi = b < target + right.k! ? b : target + right.k!
        if (newLo > a || newHi < b) {
          close({ lo: a, hi: newLo - 1n }, "proved-no-exact", "CERTIFIED_CONTRACTION_LOWER", p)
          close({ lo: newHi + 1n, hi: b }, "proved-no-exact", "CERTIFIED_CONTRACTION_UPPER", p)
          if (newLo <= newHi) queue.push({ lo: newLo, hi: newHi })
          active = null; continue
        }
        if (left.signature && right.signature && !sameSignature(left.signature, right.signature)) {
          // Binary search on a reviewed nondecreasing fiscal signature, NEVER net.
          let low = a, high = b, interrupted = false
          while (high - low > 1n) {
            const middle = (low + high) / 2n
            const o = await evaluate(middle)
            if (!o.reviewed || !o.signature || o.n === null) { interrupted = true; break }
            if (sameSignature(o.signature, left.signature)) low = middle; else high = middle
          }
          if (!interrupted) {
            queue.push({ lo: high, hi: b }, { lo: a, hi: high - 1n })
            discontinuities.push({ before: text(high - 1n), after: text(high), reason: "DIRECT_TRACE_SUBSIDY_UMA_OR_SBC_TRANSITION" })
            active = null; peakQueue = Math.max(peakQueue, queue.length); continue
          }
        }
      }
      const middle = (a + b) / 2n
      queue.push({ lo: middle + 1n, hi: b }, { lo: a, hi: middle })
      active = null; peakQueue = Math.max(peakQueue, queue.length)
    }
  } catch (error) {
    if (error instanceof SearchStop) stopReason = error.reason
    else {
      stopReason = error instanceof PreflightStop ? "fiscal-preflight" : "invalid-input"
      invalidStatus = error instanceof PreflightStop ? error.status : "not-determinable"
      issues.push({ field: "request", code: error instanceof PreflightStop ? error.code : "INVALID_INVERSE_INPUT", message: error instanceof Error ? error.message : "Captura o contexto inválido." })
    }
  }
  if (!initialized) evidence.length = 0
  const pending = initialized ? [...queue, ...(active ? [active] : [])] : domain ? [domain] : []
  for (const i of pending) close(i, invalidStatus ? "fiscally-unresolved" : "pending-budget", invalidStatus ? "FISCAL_PREFLIGHT_UNRESOLVED" : stopReason)
  const fiscal = evidence.filter(e => e.disposition === "fiscally-unresolved")
  const pendingEvidence = evidence.filter(e => e.disposition === "pending-budget")
  const complete = initialized && !pendingEvidence.length && !fiscal.length && invalidStatus === null
  const candidates = [...exact.values()].sort((a, b) => inverseCents(a.gross) < inverseCents(b.gross) ? -1 : inverseCents(a.gross) > inverseCents(b.gross) ? 1 : 0)
  const smallest = candidates[0] ?? null
  const unresolved = [...fiscal, ...pendingEvidence]
  const minimumProven = initialized && smallest !== null && unresolved.every(i => inverseCents(i.from) >= inverseCents(smallest.gross))
  const approximations: (InverseCandidate | null)[] = [below as InverseCandidate | null, above as InverseCandidate | null]
  const approximate = approximations.filter((c): c is InverseCandidate => c !== null).sort((a, b) => inverseCents(a.absoluteDifference) < inverseCents(b.absoluteDifference) ? -1 : inverseCents(a.absoluteDifference) > inverseCents(b.absoluteDifference) ? 1 : inverseCents(a.gross) < inverseCents(b.gross) ? -1 : 1)[0] ?? null
  const recommended = smallest ?? approximate
  const result: StandardEstimatedNetToGrossResult = {
    operation: "net-to-gross", status: invalidStatus ?? (candidates.length || complete ? "estimated" : "not-determinable"), targetNet: target === null ? null : text(target),
    match: smallest ? "exact" : approximate ? "approximate" : "none", exactCandidates: Object.freeze(candidates), smallestFound: smallest, recommended,
    recommendationBasis: smallest ? minimumProven ? "minimum-proven-in-domain" : "smallest-verified-only" : approximate ? "closest-verified-only" : "none",
    nearestVerifiedBelow: below, nearestVerifiedAbove: above, recommendedForwardResult: recommended ? recommendedReport : null,
    coverage: Object.freeze({ state: pendingEvidence.length ? "limited" : complete ? "complete" : "fiscally-incomplete", domain: domain ? Object.freeze({ from: text(domain.lo), to: text(domain.hi) }) : null, technicalMaximumGross: text(MAX_GROSS), evidence: Object.freeze(evidence.sort((a, b) => inverseCents(a.from) < inverseCents(b.from) ? -1 : 1)), pendingIntervals: Object.freeze(pendingEvidence.map(e => Object.freeze({ from: e.from, to: e.to }))), fiscalUnresolvedIntervals: Object.freeze(fiscal.map(e => Object.freeze({ from: e.from, to: e.to }))), minimumProven, uniquenessProven: complete && candidates.length === 1, noExactMatchProven: complete && !candidates.length, exactSetComplete: complete, multipleSolutionsVerified: candidates.length > 1, approximationOptimality: "not-proven" }),
    conclusion: invalidStatus ?? (complete ? candidates.length === 1 ? "unique-exact-in-domain" : candidates.length > 1 ? "multiple-exact-in-domain" : "no-exact-in-domain-proven" : candidates.length ? "exact-found-inconclusive" : "search-inconclusive"),
    metrics: Object.freeze({ directEvaluations: evaluations, cacheHits: hits, cacheEntries: cache.size, elapsedMs: performance.now() - start, yields, peakQueueIntervals: peakQueue, certifiedClosures, exhaustivePoints, maxEvaluations, maxDurationMs, stopReason }),
    discontinuities: Object.freeze(discontinuities.map(d => Object.freeze(d))), fiscalDiagnostics: Object.freeze(diagnostics.map(d => Object.freeze(d))),
    provenance: Object.freeze({ policyVersion: isContextualRetention(minimumScenario)?'standard-net-to-gross-2026-contextual-partitions-v2':STANDARD_NET_TO_GROSS_POLICY.id, fiscalPackageVersion: snapshot?.fiscalPackageVersion ?? null, forwardPolicyVersions: anchor?.provenance.policyVersions ?? Object.freeze([]), sources: anchor?.provenance.sources ?? (isContextualRetention(minimumScenario)?contextSources:Object.freeze([])), assumptions: Object.freeze(["Única autoridad fiscal: cálculo directo completo y conciliado; no se recalculan impuestos, cuotas, SDI ni SBC.", "Todos los índices son centavos BigInt; límites de búsqueda técnicos, no límites fiscales.", "La hipótesis mensual es condicional solo para el candidato mínimo exacto; los demás usan escenario sin confirmar.", "Las podas usan monotonía demostrada de componentes dentro de tramos, nunca monotonía del neto.", "La aproximación es la más cercana entre las evaluadas, sin garantía de óptimo global.", "Mínimo, unicidad y ausencia se limitan al dominio declarado y a su evidencia de cobertura."]), certificationAvailable: certificate.available, certificationReason: certificate.reason, fiscalCertification: "not-certified",...(isContextualRetention(minimumScenario)?{retentionContext:minimumScenario,...(reviewRegion?{retentionReviewRegion:reviewRegion}:{})}:{}) }),
    issues: Object.freeze(issues.map(i => Object.freeze(i))),
  }
  return Object.freeze(result)
}
