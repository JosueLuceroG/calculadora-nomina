// Frozen documentary projection of the approved 5C.2 presentation contract.
// Only reads reports. No calculator, parameter selector, resolver or certificate.
import type { FiscalOutcome, FiscalPresentation } from "../calculator/fiscal-adapter"
import { emptyResultValues } from "../calculator/results"
import { serializeStorageValue } from "../storage/serialization"
type Forward = Extract<FiscalOutcome["report"], { operation: "gross-to-net" }>
type Inverse = Extract<FiscalOutcome["report"], { operation: "net-to-gross" }>
function factor(value: string): string {
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error("INVALID_DOCUMENT_DECIMAL")
  const [whole, fraction = ""] = value.split(".")
  const rounded = BigInt(whole + fraction.padEnd(5,"0").slice(0,4)) + (fraction.padEnd(5,"0")[4] >= "5" ? 1n : 0n)
  const text = rounded.toString().padStart(5,"0"); return `${text.slice(0,-4)}.${text.slice(-4)}`
}
const cents = (value: string): bigint => {
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(value)) throw new Error("INVALID_DOCUMENT_AMOUNT")
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".")
  return BigInt(whole + fraction.padEnd(2,"0")) * (value.startsWith("-") ? -1n : 1n)
}
function values(report: Forward | null) {
  const integration=report?.integration.data, sbc=report?.sbc, subsidiary=report?.modules.employmentSubsidy
  const isr=subsidiary?.status==="estimated"?subsidiary.data.isrResult:subsidiary?.diagnosticIsr
  return {
    values: Object.freeze({ ...emptyResultValues, grossSalary:report?.gross.amount??null,netSalary:report?.net.amount??null,
      workerImss:report?.imss.deducted.amount??null,isr:report?.isr.withheld.amount??null,taxableIncome:isr?.data.taxableIncome??null,employmentSubsidy:report?.subsidy.applied.amount??null,
      dailySalary:integration?.dailySalary.presentation.amount??null,integrationFactor:integration?factor(integration.factor.value):null,integratedDailySalary:integration?.theoreticalSdi.presentation.amount??null,
      contributionBaseSalary:sbc?.status==="estimated"?sbc.data.sbc.estimatedSbc:null,integratedBenefitDays:integration?.equivalentAnnualBenefitDays.value??null,integratedVariableIncome:null }),
    componentStates:report?Object.freeze({gross:report.gross,net:report.net,isr:report.isr.withheld,imss:report.imss.deducted,subsidyDetermined:report.subsidy.determined,subsidyApplied:report.subsidy.applied}):null,
    integrationFactorRaw:integration?.factor.value??null,
    subsidy:Object.freeze({determined:report?.subsidy.determined.amount??null,applied:report?.subsidy.applied.amount??null,notAppliedDueToNoWithholding:report?.subsidy.notAppliedDueToNoWithholding.amount??null,excessOverTariffIsrNotDelivered:report?.subsidy.excessOverTariffIsrNotDelivered.amount??null}),
    variableIncome:integration?"not-applicable-to-ordinary-salary" as const:"unknown" as const,
  }
}
function direct(report: Forward): FiscalPresentation {
  const a=report.retention.assessment
  const confirmation=a&&(a.state==="insufficient-context"||a.state==="outside-profile")?Object.freeze({referenceMonth:a.context.referenceMonth,candidateGross:report.gross.amount,basis:"direct-retention" as const,contextual:Object.freeze({salaryBasis:a.context.salaryBasis,monthlyCondition:a.context.monthlyCondition,dailyRelation:a.dailyRelation,message:a.message,references:Object.freeze({daily:a.referenceDailyMinimum,standardMonth:a.reviewRegion.from,publishedMonth:a.publishedMonthlyReference})})})
    :report.retention.kind==="unconfirmed-minimum-month"&&report.retention.referenceMonth!==null&&report.issues.some(i=>i.code==="MONTHLY_MINIMUM_CONFIRMATION_REQUIRED")?Object.freeze({referenceMonth:report.retention.referenceMonth,candidateGross:report.gross.amount,basis:"direct-retention" as const}):null
  return Object.freeze({kind:"direct",fiscalStatus:report.status,determination:report.status==="estimated"?"complete-estimate":"blocked",...values(report),confirmation,
    warnings:Object.freeze(report.warnings.map(w=>Object.freeze({code:w.code,message:w.message}))),issues:Object.freeze(report.issues.map(i=>Object.freeze({field:i.field,code:i.code,message:i.message}))),inverse:null})
}
function inverse(report: Inverse, date: string): FiscalPresentation {
  const candidate=report.recommended,forward=report.recommendedForwardResult
  if(candidate&&(!forward||forward.status!=="estimated"||!forward.complete||!forward.reconciliationVerified||forward.gross.amount!==candidate.gross||forward.net.amount!==candidate.net||report.targetNet===null||candidate.fiscalStatus!=="estimated"
    ||cents(candidate.net)-cents(report.targetNet)!==cents(candidate.difference)|| (cents(candidate.difference)<0n?-cents(candidate.difference):cents(candidate.difference))!==cents(candidate.absoluteDifference)))throw new Error("INCONSISTENT_DOCUMENT_CANDIDATE")
  if((!candidate&&forward)||(report.match==="exact"&&(!candidate||candidate.difference!=="0.00"||!report.exactCandidates.some(c=>c.gross===candidate.gross&&c.net===candidate.net)))||(report.match==="approximate"&&(!candidate||candidate.difference==="0.00"))||(report.match==="none"&&candidate))throw new Error("INCONSISTENT_DOCUMENT_MATCH")
  const coverage=report.coverage
  if((coverage.state==="complete"&&(!coverage.domain||!coverage.exactSetComplete||coverage.pendingIntervals.length||coverage.fiscalUnresolvedIntervals.length))||(coverage.state!=="complete"&&coverage.exactSetComplete)
    ||(coverage.uniquenessProven&&(coverage.state!=="complete"||!coverage.exactSetComplete||report.exactCandidates.length!==1))||(coverage.noExactMatchProven&&(coverage.state!=="complete"||!coverage.exactSetComplete||report.exactCandidates.length!==0))
    ||(coverage.minimumProven&&(!report.exactCandidates.length||!report.smallestFound||report.recommendationBasis!=="minimum-proven-in-domain"||candidate?.gross!==report.smallestFound.gross))
    ||(report.conclusion==="unique-exact-in-domain"&&!coverage.uniquenessProven)||(report.conclusion==="no-exact-in-domain-proven"&&!coverage.noExactMatchProven)||(report.conclusion==="multiple-exact-in-domain"&&(coverage.state!=="complete"||!coverage.exactSetComplete||report.exactCandidates.length<2)))throw new Error("INCONSISTENT_DOCUMENT_GUARANTEES")
  const point=coverage.evidence.find(e=>e.disposition==="fiscally-unresolved"&&e.from===e.to&&e.reason.split("|").includes("MONTHLY_MINIMUM_CONFIRMATION_REQUIRED")&&coverage.fiscalUnresolvedIntervals.some(i=>i.from===e.from&&i.to===e.to))
  const context=report.provenance.retentionContext,pending=coverage.fiscalUnresolvedIntervals.length>0||report.status==="not-supported"||report.status==="not-determinable"
  const confirmation=context&&pending?Object.freeze({referenceMonth:context.referenceMonth,candidateGross:null,basis:"inverse-relevant-unresolved-point" as const,contextual:Object.freeze({salaryBasis:context.salaryBasis,monthlyCondition:context.monthlyCondition,dailyRelation:null,message:"El dominio conserva condiciones fiscales pendientes. Precisa la base del periodo; no se confunde candidato exacto con mínimo demostrado."})})
    :point?Object.freeze({referenceMonth:date.slice(0,7),candidateGross:point.from,basis:"inverse-relevant-unresolved-point" as const}):null
  const warnings=[...(forward?.warnings.map(w=>({code:w.code,message:w.message}))??[])]
  if(coverage.state==="limited")warnings.push({code:"INVERSE_SEARCH_LIMITED",message:"Búsqueda limitada: los candidatos están verificados, pero pueden quedar alternativas o conclusiones pendientes."})
  if(coverage.state==="fiscally-incomplete")warnings.push({code:"INVERSE_FISCALLY_INCOMPLETE",message:"Hay condiciones fiscales irresueltas; no se presenta ausencia o unicidad sin demostración."})
  if(report.match==="approximate")warnings.push({code:"INVERSE_APPROXIMATE",message:"El neto obtenido difiere del objetivo. La aproximación no es una coincidencia exacta ni se garantiza óptima globalmente."})
  return Object.freeze({kind:"inverse",fiscalStatus:report.status,determination:candidate?"verified-candidate":"blocked",...values(candidate?forward:null),confirmation,
    warnings:Object.freeze([...new Map(warnings.map(w=>[w.code,Object.freeze(w)])).values()]),issues:Object.freeze(report.issues.map(i=>Object.freeze({...i}))),
    inverse:Object.freeze({targetNet:report.targetNet,recommendedGross:candidate?.gross??null,obtainedNet:candidate?.net??null,difference:candidate?.difference??null,absoluteDifference:candidate?.absoluteDifference??null,
      match:report.match,coverage:coverage.state,domain:coverage.domain,conclusion:report.conclusion,smallestFoundGross:report.smallestFound?.gross??null,minimumProven:coverage.minimumProven,uniquenessProven:coverage.uniquenessProven,
      noExactMatchProven:coverage.noExactMatchProven,exactSetComplete:coverage.exactSetComplete,recommendationBasis:report.recommendationBasis,alternatives:report.exactCandidates,stopReason:report.metrics.stopReason})})
}
export function assertDocumentOutcome(outcome: FiscalOutcome, date: string): void {
  const report=outcome.report
  const policy=report.operation==="gross-to-net"?report.retention.policyVersion:report.provenance.policyVersion
  const known=report.operation==="gross-to-net"?["standard-isr-withholding-2026-monthly-minimum-explicit-assumption-v1","standard-isr-withholding-2026-independent-context-v2"]:["standard-net-to-gross-2026-certified-intervals-v1","standard-net-to-gross-2026-contextual-partitions-v2"]
  if(!known.includes(policy))throw new Error("INCOMPATIBLE_DOCUMENT_POLICY")
  const projected=report.operation==="gross-to-net"?direct(report):inverse(report,date)
  if(serializeStorageValue(projected)!==serializeStorageValue(outcome.presentation))throw new Error("INCONSISTENT_DOCUMENT_PRESENTATION")
}

const ordinary: Readonly<Record<string,string>> = {
  ESTIMATED_MONTHLY_REFERENCE:"El ingreso mensual es una referencia estimada a partir del periodo elegido, no un ingreso real comprobado.",
  MONTHLY_SUBSIDY_RECONCILIATION_NOT_SIMULATED:"No se concilian otros pagos ni subsidios previos del mismo mes.",
  EMPLOYER_ELECTION_NOT_EVALUATED:"No se comprueba la elección del empleador para aplicar subsidio ni la existencia de otros empleadores.",
  SUBSIDY_EXCESS_NOT_PAID_OR_CARRIED:"El excedente de subsidio no se entrega en efectivo ni se suma al neto.",
  STANDARD_RESULT_NOT_CERTIFIED:"Esta simulación no certifica percepciones, retenciones practicadas ni una liquidación mensual real.",
}
export const readableWarning=(warning:FiscalPresentation["warnings"][number])=>ordinary[warning.code]??warning.message
export const importantWarnings=(p:FiscalPresentation)=>p.warnings.filter(w=>!Object.hasOwn(ordinary,w.code))
export function matchingForwardReport(p:FiscalPresentation, report:FiscalOutcome["report"]) {
  const forward=report.operation==="gross-to-net"?report:report.recommendedForwardResult
  if(!forward)return undefined
  if(forward.gross.amount!==p.values.grossSalary||forward.net.amount!==p.values.netSalary||forward.isr.withheld.amount!==p.values.isr||forward.imss.deducted.amount!==p.values.workerImss)throw new Error("INCONSISTENT_DOCUMENT_FORWARD")
  return forward
}
export function inverseStatus(i:NonNullable<FiscalPresentation["inverse"]>,status:FiscalPresentation["fiscalStatus"]):string {
  if(status==="not-supported")return"Resultado no determinable. Escenario no soportado; no hay bruto determinado."
  const limited=i.coverage==="limited"?"Búsqueda limitada. ":"",conditional=i.coverage==="fiscally-incomplete"?" Condición fiscal pendiente; la búsqueda no está cerrada.":""
  if(i.match==="none")return i.noExactMatchProven?`${limited}Resultado no determinable: ausencia de coincidencia exacta demostrada solo en el dominio analizado.${conditional}`:`${limited}Resultado no determinable: sin candidato verificado; no se ha demostrado ausencia de solución.${conditional}`
  if(i.match==="approximate")return`${limited}Aproximado: el neto obtenido difiere del solicitado. No se garantiza la mejor aproximación global.${conditional}`
  return`${limited}Exacto · ${i.minimumProven?"Bruto mínimo demostrado en el dominio analizado.":"Bruto encontrado: mínimo no demostrado; puede existir un bruto menor."}${conditional}`
}
