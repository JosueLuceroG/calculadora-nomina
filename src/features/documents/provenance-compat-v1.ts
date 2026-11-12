import grammar from "./closed-shape-compat-v1.json"
import legacy from "./frozen-shape-v3.json"
import identity from "../storage/build-identity.json"
import { hashObject, verifyObservedPackage } from "./evidence-v3"
import { validateFiscalRegistry2026 } from "../../infrastructure/fiscal/2026"
import { assertCompatPresentation } from "./presentation-compat-v1"
import type { StoredCompatSnapshot, CompatOutcome } from "./contracts-compat-v1"
import type { StandardEstimatedGrossToNetResult } from "../../domain/payroll/gross-to-net-contracts"
import { preflightDocumentValue } from "./budget-v3"
import { validateFiscalSource } from "../../domain/payroll/parameters"
import { STANDARD_CONVENTIONS } from "../../domain/payroll/simulation-conventions"
import reviewedProducer from "../../infrastructure/fiscal/document-producer.json"

type ObjectValue = Record<string, unknown>
function fail(): never { throw new Error("INVALID_COMPAT_DOCUMENT") }
function object(v: unknown): ObjectValue { if (!v || typeof v !== "object" || Array.isArray(v)) fail(); return v as ObjectValue }
function array(v: unknown): unknown[] { if (!Array.isArray(v)) fail(); return v }
function same(a: unknown, b: unknown): boolean { return hashObject(a) === hashObject(b) }
function date(v: unknown): boolean { return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !v.startsWith("0000") && Number.isFinite(Date.parse(v + "T00:00:00Z")) && new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v }
function format(v: unknown, f: unknown): boolean {
  if (f === "count") return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && !Object.is(v, -0)
  if (f === "elapsed") return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER && !Object.is(v, -0)
  if (typeof v !== "string") return false
  if (f === "money" || f === "decimal") return v.replace(/^-/, "").length <= 256 && (f === "money" ? /^-?\d+(?:\.\d{1,2})?$/ : /^-?\d+(?:\.\d{1,64})?$/).test(v)
  if (f === "digest") return /^[0-9a-f]{64}$/.test(v)
  if (f === "uuid") return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v)
  if (f === "date") return date(v)
  if (f === "month") return /^\d{4}-(?:0[1-9]|1[0-2])$/.test(v) && !v.startsWith("0000")
  if (f === "fiscal-instant") return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v) && date(v.slice(0, 10)) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v.replace("Z", ".000Z")
  return false
}
function legacyNode(path: string): ObjectValue {
  let n: unknown = legacy
  path.split(".").forEach((part, index) => {
    const list = part.endsWith("[]"), key = list ? part.slice(0, -2) : part
    n = index === 0 ? object(n)[key] : object(object(n).properties)[key]
    if (list) n = object(n).items
  })
  return object(n)
}
function kind(v: unknown): string { return v === null ? "null" : Array.isArray(v) ? "array" : typeof v }
/** Closed grammar interpreter shared in data with Rust, independent of fixtures. */
export function assertCompatShape(v: unknown, node: unknown = grammar.root): void {
  const n = object(node)
  if (typeof n.ref === "string") return assertCompatShape(v, object(grammar.definitions)[n.ref])
  if (n.nullable !== undefined) { if (v !== null) assertCompatShape(v, n.nullable); return }
  if (n.oneOf !== undefined) {
    let matches = 0
    for (const variant of array(n.oneOf)) { try { assertCompatShape(v, variant); matches++ } catch { /* another closed union branch */ } }
    if (matches !== 1) fail()
    return
  }
  if (n.enum !== undefined) { if (!array(n.enum).some(x => same(x, v))) fail(); return }
  if (n.format !== undefined) { if (!format(v, n.format)) fail(); return }
  if (n.array !== undefined) { for (const x of array(v)) assertCompatShape(x, n.array); return }
  if (n.type !== undefined) { if (kind(v) !== n.type) fail(); return }
  if (n.fields !== undefined) {
    const fields = object(n.fields), data = object(v), optional = n.optional === undefined ? [] : array(n.optional)
    if (Object.keys(data).some(k => !Object.hasOwn(fields, k)) || Object.keys(fields).some(k => !optional.includes(k) && !Object.hasOwn(data, k))) fail()
    for (const [k, x] of Object.entries(data)) assertCompatShape(x, fields[k])
    return
  }
  const b = typeof n.legacy === "string" ? legacyNode(n.legacy) : n
  if (!array(b.types).includes(kind(v))) fail()
  if (Array.isArray(v)) {
    if (!b.items && v.length) fail()
    for (const x of v) assertCompatShape(x, b.items)
  } else if (v && typeof v === "object") {
    const fields = { ...object(b.properties), ...(n.properties ? object(n.properties) : {}) }, data = object(v)
    const optional = n.optional ? array(n.optional) : []
    if (Object.keys(data).some(k => !Object.hasOwn(fields, k)) || array(b.required).some(k => typeof k !== "string" || (!optional.includes(k) && !Object.hasOwn(data, k)))) fail()
    for (const [k, x] of Object.entries(data)) assertCompatShape(x, fields[k])
  }
}
function cents(v: unknown): bigint {
  if (!format(v, "money") || typeof v !== "string") fail()
  const neg = v.startsWith("-"), [a, b = ""] = v.replace(/^-/, "").split(".")
  const n = BigInt(a + b.padEnd(2, "0")); if (n > (1n << 127n) - 1n) fail()
  return neg ? -n : n
}
function scalars(v: unknown): void {
  if (typeof v === "number" && (!Number.isFinite(v) || Math.abs(v) > Number.MAX_SAFE_INTEGER || Object.is(v, -0))) fail()
  if (Array.isArray(v)) { v.forEach(scalars); return }
  if (!v || typeof v !== "object") return
  for (const [k, x] of Object.entries(v)) {
    if (Object.hasOwn(grammar.literalFields, k) && !same(x, object(grammar.literalFields)[k])) fail()
    if (Object.hasOwn(grammar.literalObjects, k) && !same(x, object(grammar.literalObjects)[k])) fail()
    if (["amount", "gross", "net", "targetNet", "difference", "absoluteDifference", "grossPeriodSalary", "isrByTariff", "estimatedSbc"].includes(k) && x !== null && typeof x !== "object") cents(x)
    scalars(x)
  }
}
function reconcile(f: StandardEstimatedGrossToNetResult): void {
  if (f.net.status !== f.status || ((f.integration.status === "estimated" || f.integration.status === "valid") !== (f.integration.data !== null))) fail()
  const components = [f.gross, f.net, ...Object.values(f.isr), ...Object.values(f.subsidy), f.imss.calculated, f.imss.deducted, f.imss.absorbedByEmployer, f.imss.excludedBySimulation]
  for (const c of components) {
    if (c.status === "estimated" || c.status === "valid") { if (c.amount === null || cents(c.amount) < 0n) fail() }
    else if (c.amount !== null || !c.reason) fail()
  }
  const determined = [f.gross.amount, f.net.amount, f.isr.withheld.amount, f.imss.deducted.amount]
  if (determined.every(x => x !== null) && cents(f.gross.amount) !== cents(f.net.amount) + cents(f.isr.withheld.amount) + cents(f.imss.deducted.amount)) fail()
  if (f.status === "estimated") { if (!f.complete || !f.reconciliationVerified || determined.some(x => x === null) || !f.integration.data || f.sbc?.status !== "estimated" || f.modules.workerImss?.status !== "estimated" || f.modules.employmentSubsidy?.status !== "estimated") fail() }
  else if (f.complete || f.reconciliationVerified || f.net.amount !== null) fail()
  for (const [total, parts] of [[f.imss.calculated, [f.imss.deducted, f.imss.absorbedByEmployer, f.imss.excludedBySimulation]], [f.subsidy.determined, [f.subsidy.applied, f.subsidy.notAppliedDueToNoWithholding, f.subsidy.excessOverTariffIsrNotDelivered]]] as const) {
    if (total.amount !== null && parts.every(x => x.amount !== null) && cents(total.amount) !== parts.reduce((n, x) => n + cents(x.amount), 0n)) fail()
  }
  for (const m of [f.sbc, f.modules.workerImss, f.modules.employmentSubsidy]) if (m && (m.status === "estimated") !== (m.data !== null)) fail()
  for (const m of [f.modules.workerImss, f.modules.employmentSubsidy]) if (m?.status === "estimated" && m.data.reconciliationVerified !== true) fail()
  if (f.modules.workerImss?.status === "estimated" && f.modules.workerImss.data.sbcResult.status !== "estimated") fail()
}
function inverse(o: Extract<CompatOutcome, { kind: "inverse" }>): void {
  const r = o.report, c = r.coverage, domain = c.domain
  const checkCandidate = (x: NonNullable<typeof r.recommended>, direction = 0) => {
    const d = cents(x.net) - cents(r.targetNet)
    if (cents(x.gross) <= 0n || cents(x.net) < 0n || cents(x.difference) !== d || cents(x.absoluteDifference) !== (d < 0n ? -d : d)
      || direction < 0 && d >= 0n || direction > 0 && d <= 0n || domain && (cents(x.gross) < cents(domain.from) || cents(x.gross) > cents(domain.to))) fail()
  }
  r.exactCandidates.forEach(x => { checkCandidate(x); if (cents(x.difference) !== 0n) fail() })
  if (new Set(r.exactCandidates.map(x => cents(x.gross).toString())).size !== r.exactCandidates.length) fail()
  const smallest = r.exactCandidates.reduce<(typeof r.exactCandidates)[number] | null>((a, x) => !a || cents(x.gross) < cents(a.gross) ? x : a, null)
  if (!same(r.smallestFound, smallest)) fail()
  if (r.match === "exact" && (!same(r.recommended, smallest) || r.recommendationBasis !== (c.minimumProven ? "minimum-proven-in-domain" : "smallest-verified-only"))
    || r.match === "approximate" && (smallest !== null || r.recommendationBasis !== "closest-verified-only")
    || r.match === "none" && r.recommendationBasis !== "none") fail()
  if (r.nearestVerifiedBelow) checkCandidate(r.nearestVerifiedBelow, -1)
  if (r.nearestVerifiedAbove) checkCandidate(r.nearestVerifiedAbove, 1)
  if (r.recommended) {
    const f = r.recommendedForwardResult; checkCandidate(r.recommended); reconcile(f)
    if (f.status !== "estimated" || f.gross.amount !== r.recommended.gross || f.net.amount !== r.recommended.net
      || object(r).status === "not-supported" || object(r).match === "none" || (r.match === "exact") !== (cents(r.recommended.difference) === 0n)) fail()
  } else if (r.recommendedForwardResult !== null || r.match !== "none" || r.nearestVerifiedAbove || r.nearestVerifiedBelow || r.smallestFound || r.exactCandidates.length) fail()
  if (r.metrics.stopReason === "aborted" || r.metrics.stopReason === "invalid-input" || r.metrics.maxEvaluations < 1 || r.metrics.maxEvaluations > 4096 || r.metrics.maxDurationMs < 1 || r.metrics.maxDurationMs > 3000 || r.metrics.directEvaluations > r.metrics.maxEvaluations) fail()
  if (!r.provenance.certificationAvailable && (r.metrics.certifiedClosures || c.evidence.some(x => x.proof))) fail()
  if (r.metrics.certifiedClosures !== c.evidence.filter(x => x.proof).length) fail()
  if ((c.pendingIntervals.length > 0) !== (c.state === "limited") || c.state === "fiscally-incomplete" && !c.fiscalUnresolvedIntervals.length) fail()
  for (const x of c.evidence) {
    if (!x.reason.trim()) fail()
    const p = x.proof
    if (p && (x.disposition !== "proved-no-exact" || cents(p.from) > cents(x.from) || cents(p.to) < cents(x.to)
      || cents(p.kFrom) < 0n || cents(p.kTo) < cents(p.kFrom)
      || cents(p.netLower) !== cents(p.from) - cents(p.kTo) || cents(p.netUpper) !== cents(p.to) - cents(p.kFrom))) fail()
  }
  for (const x of [...c.pendingIntervals, ...c.fiscalUnresolvedIntervals]) if (!domain || cents(x.from) > cents(x.to) || cents(x.from) < cents(domain.from) || cents(x.to) > cents(domain.to)) fail()
  if (c.evidence.length) {
    if (!domain) fail()
    let next = cents(domain.from)
    for (const x of c.evidence) { if (cents(x.from) !== next || cents(x.to) < next || cents(x.to) > cents(domain.to)) fail(); next = cents(x.to) + 1n }
    if (next !== cents(domain.to) + 1n) fail()
    for (const [items, disposition] of [[c.pendingIntervals, "pending-budget"], [c.fiscalUnresolvedIntervals, "fiscally-unresolved"]] as const) {
      const keys = (xs: readonly { from: string; to: string }[]) => xs.map(x => x.from + "|" + x.to).sort()
      if (!same(keys(items), keys(c.evidence.filter(x => x.disposition === disposition)))) fail()
    }
  }
  if (c.state === "complete" && (!domain || c.pendingIntervals.length || c.fiscalUnresolvedIntervals.length || !c.exactSetComplete)
    || c.state !== "complete" && c.exactSetComplete
    || c.state === "limited" && !c.pendingIntervals.length
    || c.uniquenessProven && (c.state !== "complete" || r.exactCandidates.length !== 1)
    || c.noExactMatchProven && (c.state !== "complete" || r.exactCandidates.length !== 0)
    || c.minimumProven && (!r.smallestFound || r.recommendationBasis !== "minimum-proven-in-domain" || [...c.pendingIntervals, ...c.fiscalUnresolvedIntervals].some(x => cents(x.from) < cents(r.smallestFound!.gross)))) fail()
}

/** Historical documentary validation only. Never issues authority or writes. */
export function assertCompatSnapshot(value: unknown): asserts value is StoredCompatSnapshot {
  preflightDocumentValue(value); assertCompatShape(value); scalars(value)
  const s = value as StoredCompatSnapshot, p = s.executionProvenance, r = p.resolution, c = s.effectiveContext
  const report = s.outcome.report, f = report.operation === "gross-to-net" ? report : report.recommendedForwardResult
  const capture = s.capture.form, e = s.fiscalEvidence, signed = e.packageEnvelope.signed, manifest = signed.manifest
  const ex = s.execution
  for (const instant of [ex.preparedAt, ex.startedAt, ex.completedAt]) if (typeof instant !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(instant) || !Number.isFinite(Date.parse(instant)) || new Date(instant).toISOString() !== instant || !date(instant.slice(0, 10))) fail()
  if (!date(ex.consultationLocalDate) || !date(ex.completedLocalDate) || typeof ex.completedLocalTime !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(ex.completedLocalTime) || !Number.isSafeInteger(ex.utcOffsetMinutes) || Math.abs(ex.utcOffsetMinutes!) > 840 || !Number.isSafeInteger(ex.requestId) || ex.requestId < 1 || !["manual", "automatic"].includes(ex.referenceMode)) fail()
  for (const amount of [capture.bonusDays, capture.vacationDays, capture.vacationPremium]) if (!format(amount, "decimal") || amount.startsWith("-")) fail()
  if (s.versions.engine !== identity.engineVersion || !s.versions.application || capture.period !== r.periodicity || capture.mode !== r.operation || capture.effectiveDate !== r.fiscalDate || !r.fiscalDate.startsWith("2026-") || cents(capture.amount) <= 0n || s.capture.area !== "general-zone" || report.operation !== r.operation || s.outcome.kind !== (r.operation === "gross-to-net" ? "direct" : "inverse")) fail()
  if (report.operation === "gross-to-net") { reconcile(report); if (cents(report.gross.amount) !== cents(capture.amount)) fail() }
  else { if (cents(report.targetNet) !== cents(capture.amount) || s.outcome.kind !== "inverse") fail(); inverse(s.outcome) }
  if (report.operation === "net-to-gross" && report.provenance.policyVersion !== "standard-net-to-gross-2026-contextual-partitions-v2") fail()
  if (p.requestScenario.actualDays !== undefined && p.requestScenario.salaryBasis !== "actual-calendar") fail()
  if (report.provenance.fiscalPackageVersion !== s.fiscalPackage.version || s.execution.packageId !== s.fiscalPackage.id || s.execution.fiscalDate !== r.fiscalDate) fail()
  if (!same(p.requestScenario, report.operation === "gross-to-net" ? report.retention.assessment?.context ?? report.retention.scenario : report.provenance.retentionContext) || p.requestScenario.referenceMonth !== r.fiscalDate.slice(0, 7)) fail()
  const expectedPolicies = f?.provenance.policyVersions ?? (report.operation === "net-to-gross" ? report.provenance.forwardPolicyVersions : [])
  const known = reviewedProducer.authorization.policyVersions
  const reportedLists = [expectedPolicies, ...(report.operation === "net-to-gross" ? [report.provenance.forwardPolicyVersions] : [])]
  for (const policies of reportedLists) if (new Set(policies.map(x => x.component)).size !== policies.length || policies.some(x => x.component === "net-to-gross" || !known.some(y => y.component === x.component && y.version === x.version))) fail()
  if (f?.status === "estimated" && expectedPolicies.length !== known.filter(x => x.component !== "net-to-gross").length) fail()
  const expected = [...expectedPolicies, ...(report.operation === "net-to-gross" ? [{ component: "net-to-gross", version: report.provenance.policyVersion }] : [])]
  if (!same(p.policyVersions, expected) || new Set(p.policyVersions.map(x => x.component)).size !== p.policyVersions.length) fail()
  if (f && f.retention.policyVersion !== r.contextualPolicyId) fail()
  const selected = object(signed.registry), roles: Readonly<Record<string, string>> = { isrTariff: "isrTariffs", uma: "uma", minimumWages: "minimumWages", subsidy: "subsidy", imssConstants: "imssConstants", contractualDivisors: "contractualDivisors", laborBenefitMinima: "laborBenefitMinima" }
  if (c.sets.length !== 7 || new Set(c.sets.map(x => x.role)).size !== 7 || c.registryVersion !== signed.registry.version || c.conventionsId !== signed.conventions.id) fail()
  for (const ref of c.sets) {
    if (roles[ref.role] !== ref.family) fail()
    const matches = array(selected[ref.family]).map(object).filter(x => x.id === ref.id && x.version === ref.version && typeof x.effectiveFrom === "string" && x.effectiveFrom <= r.fiscalDate && (x.effectiveThrough === null || typeof x.effectiveThrough === "string" && x.effectiveThrough >= r.fiscalDate) && (ref.role !== "isrTariff" || object(x.data).periodicity === r.periodicity))
    if (matches.length !== 1) fail()
  }
  if (f) {
    const used = f.provenance.parameterSetVersions
    if (new Set(used.map(x => x.id)).size !== used.length || used.some(x => !c.sets.some(y => x.id === y.id && x.version === y.version)) || f.status === "estimated" && used.length !== c.sets.length) fail()
  }
  const evaluation = c.evaluationObservation
  const reportedFacts = [report.operation === "gross-to-net" ? report.provenance.parameterSetVersions : null, report.operation === "gross-to-net" ? report.provenance.policyVersions : report.provenance.forwardPolicyVersions, report.operation === "net-to-gross" ? report.metrics.directEvaluations : null]
  if (evaluation.availability === "not-reported") { if (evaluation.reportedParameterSetVersions !== null || evaluation.reportedForwardPolicyVersions !== null || evaluation.reportedDirectEvaluations !== null || reportedFacts.some(x => x !== null)) fail() }
  else {
    if (!same(evaluation.reportedParameterSetVersions, report.operation === "gross-to-net" ? report.provenance.parameterSetVersions : null)
      || !same(evaluation.reportedForwardPolicyVersions, report.operation === "gross-to-net" ? report.provenance.policyVersions : report.provenance.forwardPolicyVersions)
      || evaluation.reportedDirectEvaluations !== (report.operation === "net-to-gross" ? report.metrics.directEvaluations : null)) fail()
  }
  if (evaluation.reportedParameterSetVersions?.some(x => !c.sets.some(y => x.id === y.id && x.version === y.version))) fail()
  validateFiscalRegistry2026(signed.registry)
  // Existing fiscal-data contract, not a payroll calculation or a trust grant.
  const registry = signed.registry
  const allSets = [...registry.isrTariffs, ...registry.uma, ...registry.minimumWages, ...registry.subsidy, ...registry.imssConstants, ...registry.contractualDivisors, ...registry.laborBenefitMinima]
  const numericParameters = [
    ...registry.isrTariffs.flatMap(x => x.data.rows.flatMap(y => [y.lower, y.upper, y.fixedFee, y.ratePercent])),
    ...registry.uma.flatMap(x => [x.data.daily, x.data.monthly, x.data.annual]),
    ...registry.minimumWages.flatMap(x => [x.data.general.daily, x.data.general.publishedMonthlyReference, x.data.northernBorder.daily, x.data.northernBorder.publishedMonthlyReference]),
    ...registry.subsidy.flatMap(x => [x.data.rateProportion, x.data.submonthlyDivisor, x.data.monthlyIncomeLimit]),
    ...registry.imssConstants.flatMap(x => [x.data.sbcCeilingUmaDailyMultiple, x.data.excessThresholdUmaDailyMultiple, ...Object.values(x.data.workerRates)]),
    ...registry.contractualDivisors.flatMap(x => Object.values(x.data)),
    ...registry.laborBenefitMinima.flatMap(x => [x.data.annualBonusDays, x.data.firstAnnualVacationDays, x.data.vacationPremiumPercent])
  ]
  for (const x of numericParameters) if (x !== null) { const [i, f = ""] = x.split("."); if (!/^\d+(?:\.\d{1,50})?$/.test(x) || i.length > 20 || (i.replace(/^0+/, "") + f).replace(/^0+/, "").length > 50) fail() }
  const identifier = (s: string) => s.length > 0 && new TextEncoder().encode(s).length <= 128 && /^[A-Za-z0-9][A-Za-z0-9_:.\/-]*$/.test(s)
  if (!same(signed.conventions, STANDARD_CONVENTIONS) || registry.contractualDivisors.some(x => !same(x.data, STANDARD_CONVENTIONS.referenceCotizedDays)) || !identifier(manifest.packageId) || !identifier(registry.version) || manifest.parameterVersion !== registry.version || manifest.exercise !== registry.exercise || !same(manifest.supportedDates, registry.supportedDates) || !manifest.sources.length || manifest.sources.length > 256 || !allSets.length || allSets.length > 128 || new Set(allSets.map(x => x.id)).size !== allSets.length || !same(manifest.parameterSets, allSets.map(({ id, version }) => ({ id, version })))) fail()
  manifest.sources.forEach(validateFiscalSource)
  if (new Set(manifest.sources.map(hashObject)).size !== manifest.sources.length) fail()
  for (const set of allSets) {
    if (!identifier(set.id) || !identifier(set.version) || set.sources.some(x => !manifest.sources.some(y => same(x, y)))) fail()
  }
  for (const sources of [signed.ruleSources.subsidy, signed.ruleSources.retention]) {
    if (!sources.length || sources.length > 256) fail()
    for (const source of sources) { validateFiscalSource(source); if (!manifest.sources.some(x => same(x, source))) fail() }
  }
  if (!identifier(signed.review.recordId) || !date(signed.review.reviewedOn) || !format(signed.publication.publishedAt, "fiscal-instant") || signed.review.reviewedOn > signed.publication.publishedAt.slice(0, 10) || !format(signed.review.independentReportSha256, "digest") || signed.review.compatibilityStatement !== "data-only-same-implemented-rules" || signed.review.sourceChecks.length !== manifest.sources.length || !signed.publication.changes.summary.trim()) fail()
  signed.review.sourceChecks.forEach((x, i) => { if (x.sourceIndex !== i || x.verifiedOn !== manifest.sources[i].verifiedOn || x.verifiedOn > signed.review.reviewedOn) fail() })
  for (const sub of registry.subsidy) for (const date of [registry.supportedDates.from, ...registry.uma.map(x => x.effectiveFrom), ...registry.subsidy.map(x => x.effectiveFrom)]) {
    if (date < sub.effectiveFrom || date < registry.supportedDates.from || date > registry.supportedDates.through || sub.effectiveThrough !== null && date > sub.effectiveThrough) continue
    const uma = registry.uma.find(x => x.effectiveFrom <= date && (x.effectiveThrough === null || date <= x.effectiveThrough))
    if (!uma || uma.data.valueYear !== sub.data.umaMonthlyValueYear) fail()
  }
  const hashes = verifyObservedPackage(e.packageEnvelope, e.trustHeadEnvelope, p.verificationObservation.verifiedAt, r.operation), v = p.verificationObservation
  if (s.fiscalPackage.sha256 !== hashes.contentSha256 || s.fiscalPackage.containerIdentity.sha256 !== hashes.envelopeSha256 || s.fiscalPackage.containerIdentity.payloadSha256 !== hashes.payloadSha256 || s.fiscalPackage.containerIdentity.byteLength !== hashes.originalBytes || e.trustEnvelopeSha256 !== hashes.trustEnvelopeSha256 || e.trustPayloadSha256 !== hashes.trustPayloadSha256 || v.rootVersion !== e.trustHeadEnvelope.signed.rootVersion || v.trustEpoch !== e.trustHeadEnvelope.signed.epoch || !same(v.publishingKeys, hashes.publishingKeys) || !same(v.approvalKeys, hashes.approvalKeys)) fail()
  if (s.fiscalPackage.id !== manifest.packageId || s.fiscalPackage.version !== manifest.parameterVersion || !same(s.fiscalPackage.supportedDates, manifest.supportedDates) || r.fiscalDate < manifest.supportedDates.from || r.fiscalDate > manifest.supportedDates.through || r.ruleProfileId !== manifest.requiredRuleProfileId || r.contextualPolicyId !== manifest.requiredContextualPolicyId) fail()
  const h = e.history
  if (h.documentHashes.length > 65536 || h.episodeCount > 4096 || new TextEncoder().encode(h.archiveLocator).length > 256 || hashObject({ documentHashes: h.documentHashes, episodeCount: h.episodeCount, archiveLocator: h.archiveLocator }) !== h.manifestSha256) fail()
  const a = p.authorizationObservation
  if (a.operation !== r.operation) fail()
  if (s.documentKind === "qa-document-fixture") { if (signed.channel !== "qa" || a.kind !== "not-issued-qa-fixture" || [a.nativeExecutionId, a.installationId, a.admissionId, a.selectionId, a.selectionGeneration].some(x => x !== null) || a.authorizedOperations.length) fail() }
  else if (a.kind !== "native-observation-v1" || a.nativeExecutionId !== s.executionId || [a.installationId, a.admissionId, a.selectionId].some(x => x === null) || a.selectionGeneration === null || !a.authorizedOperations.includes("direct") || r.operation === "net-to-gross" && !a.authorizedOperations.includes("inverse")) fail()
  assertCompatPresentation(s)
}
