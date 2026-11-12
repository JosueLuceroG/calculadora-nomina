import type {PdfDocumentModel} from "./document-model"
import {documentAmount} from "./document-model"
import {matchingForwardReport,readableWarning,importantWarnings} from "../documents/presentation-v1"

export type ReportRow=Readonly<{label:string;raw:string|null;display:string;unit:string;note?:string}>
const civil=(value:string)=>value.split("-").reverse().join("/")
const pad=(value:number)=>String(value).padStart(2,"0")
export function reportUtcOffset(minutes:number|null){if(minutes===null)return"zona no registrada";const absolute=Math.abs(minutes);return`UTC${minutes<0?"−":"+"}${pad(Math.floor(absolute/60))}:${pad(absolute%60)}`}
// Títulos editoriales; la referencia completa y su URL verificadas se conservan.
const referenceTitles:Readonly<Record<string,string>>={
 "Ley del Seguro Social, texto vigente":"Ley del Seguro Social",
 "Ley Federal del Trabajo, texto vigente":"Ley Federal del Trabajo",
 "Ley del Impuesto sobre la Renta, texto vigente":"Ley del ISR (LISR)",
 "Comunicado de prensa 1/26, UMA 2026":"UMA 2026 · Comunicado 1/26",
 "Resolución que fija los salarios mínimos generales y profesionales para 2026":"Resolución de mínimos 2026",
 "Decreto de desindexación del salario mínimo":"Desindexación del salario mínimo",
 "Anexo 8 de la RMF para 2026":"Anexo 8, RMF 2026",
 "Anexos 4, 5, 6, 8, 15 y 25 de la RMF para 2026":"Anexos 4, 5, 6, 8, 15 y 25, RMF 2026",
 "Decreto por el que se modifica el diverso que otorga el subsidio para el empleo":"Subsidio al empleo · Reforma",
 "Decreto que otorga el subsidio para el empleo, disposiciones no reformadas":"Subsidio al empleo · Texto no reformado",
}
const referenceLocators:Readonly<Record<string,string>>={
 "Arts. 76 (primer derecho anual y antigüedad), 80 (prima mínima), 87 (aguinaldo anual mínimo)":"Arts. 76 (derecho anual y antigüedad), 80 (prima) y 87 (aguinaldo)",
 "Arts. 85 y 90; salario remunerador y mínimo laboral, distinto del piso de SBC":"Arts. 85 y 90 (salario y mínimo laboral, distinto del piso de SBC)",
 "Artículo Segundo, segundo párrafo: excedente no entregado ni aplicable posteriormente; párrafos sexto/séptimo: elección de empleador; Artículo Cuarto":"Art. Segundo, párrs. 2 (excedente), 6 y 7 (elección de empleador); Art. Cuarto",
 "Artículo 96, primer párrafo: no retención cuando en el mes únicamente se percibe salario mínimo general del área; segundo párrafo: ingresos del mes de calendario":"Art. 96, párrs. 1 (mínimo general exclusivo del mes) y 2 (ingresos del mes civil)",
}
export function exportCivilDate(now:Date){return`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`}
export const defaultReportFilename=(now:Date)=>`Simulacion-Nomina-${exportCivilDate(now)}.pdf`
export function createSalaryReport(document:PdfDocumentModel,{exportedAt=new Date(),reportId=crypto.randomUUID()}:{exportedAt?:Date;reportId?:string}={}){
 if(!Number.isFinite(exportedAt.getTime())||!/^[0-9a-f-]{32,36}$/i.test(reportId))throw new Error("INVALID_REPORT_METADATA")
 const p=document.original.outcome.presentation,forward=matchingForwardReport(p,document.original.outcome.report)
 const row=(label:string,raw:string|null,unit="MXN",note?:string):ReportRow=>Object.freeze({label,raw,display:documentAmount(raw).display,unit,note})
 const fiscal:ReportRow[]=[row("Salario bruto",forward?.gross.amount??null),row("ISR calculado por tarifa",forward?.isr.accordingToTariff.amount??null),row("Subsidio determinado",forward?.subsidy.determined.amount??null),row("Subsidio efectivamente aplicado",forward?.subsidy.applied.amount??null),row("ISR retenido",forward?.isr.withheld.amount??null),row("IMSS obrero calculado",forward?.imss.calculated.amount??null),row("IMSS efectivamente descontado",forward?.imss.deducted.amount??null)]
 if(forward?.modules.workerImss?.status==="estimated"&&forward.modules.workerImss.data.allocation==="absorbed-under-LSS-36")fiscal.push(row("Cuota obrera absorbida por el patrón",forward.imss.absorbedByEmployer.amount,"MXN","Absorción del reporte, artículo 36 LSS; no es descuento al trabajador."))
 if(!document.includeImss)fiscal.push(row("Cuota excluida por esta simulación",forward?.imss.excludedBySimulation.amount??null))
 fiscal.push(row("Salario neto estimado",forward?.net.amount??null))
 const basis=forward?.retention.assessment?.context.salaryBasis,dailyLabel=basis==='fixed-period'?'Diario de referencia del perfil':basis==='agreed-daily-reference'?'Salario diario pactado declarado':basis==='actual-calendar'?'Diario no determinado (calendario real)':'Salario diario contractual'
 const integration:ReportRow[]=[row(dailyLabel,p.values.dailySalary,"MXN/día"),Object.freeze({label:"Factor de integración",raw:p.integrationFactorRaw,display:p.values.integrationFactor??"—",unit:"factor"}),row("SDI teórico",p.values.integratedDailySalary,"MXN/día"),row("SBC estimado (no registrado)",p.values.contributionBaseSalary,"MXN/día")]
 const sbc=forward?.sbc?.status==="estimated"?forward.sbc.data:null
 if(sbc&&sbc.sbc.limitApplied!=="none"){integration.push(row("Límite inferior del SBC",sbc.limits.lower,"MXN/día"),row("Límite superior del SBC",sbc.limits.upper,"MXN/día"))}
 const imss=forward?.modules.workerImss,days=imss?.status==="estimated"?imss.data.referenceCotizedDays:null
 const assumptions=["Salario ordinario fijo totalmente gravado; prestaciones declaradas, sin acreditar antigüedad ni pagos.",days?`Periodo estándar: ${days} días de referencia, no días reales de cotización ni calendario de incidencias.`:"Los días de referencia no se determinaron; no se sustituyen por un calendario supuesto.","Sin conciliación de otros pagos, movimientos, retenciones previas ni subsidios previos/acumulados del mes.","Simulación no homologada con SUA/CONTPAQi: no certifica percepciones, retenciones practicadas ni liquidación mensual real; no es opinión oficial ni cálculo certificado por autoridades.","El subsidio aplicado ya está reflejado en el ISR retenido; no se suma de nuevo al neto."]
 if(!document.includeImss)assumptions.push("IMSS desactivado en esta simulación. No representa una exención legal; se conserva la absorción aplicable.")
 const assessment=forward?.retention.assessment
 if(assessment?.context.salaryBasis==='agreed-daily-reference')assumptions[0]='Salario diario pactado totalmente gravado; días estándar, no calendario real. Prestaciones declaradas, sin acreditar antigüedad ni pagos.'
 if(assessment?.context.salaryBasis==='actual-calendar')assumptions[0]='Base declarada: pago por días reales, fuera del perfil. No se infiere un diario pactado dividiendo este importe entre 30.'
 if(sbc&&sbc.sbc.limitApplied!=="none")assumptions.push(sbc.sbc.limitApplied==="upper"?`El reporte aplica el tope del SBC de ${sbc.limits.ceilingUmaDailyMultiple} UMA diarias. No cambia el salario bruto declarado.`:"El reporte aplica el límite inferior del SBC. Esto no regulariza ni modifica el salario contractual declarado.")
 const warnings=p.warnings.map(w=>Object.freeze({code:w.code,message:readableWarning(w),originalMessage:w.message}))
 // Solo se consolidan estos dos avisos ordinarios, con alcance explícito arriba.
 // Los códigos y mensajes originales siguen íntegros en warnings y document.original.
 const consolidatedCodes=["MONTHLY_SUBSIDY_RECONCILIATION_NOT_SIMULATED","STANDARD_RESULT_NOT_CERTIFIED"]
 const notices=[...assumptions.map((message,index)=>Object.freeze({message,codes:Object.freeze(warnings.filter(w=>w.code===(index===2?consolidatedCodes[0]:index===3?consolidatedCodes[1]:null)).map(w=>w.code))})),...warnings.filter(w=>!consolidatedCodes.includes(w.code)).map(w=>Object.freeze({message:w.code==="SUBSIDY_EXCESS_NOT_PAID_OR_CARRIED"?"El excedente de subsidio no se paga en efectivo, no se suma al neto ni se aplica posteriormente.":w.message,codes:Object.freeze([w.code])}))]
 const references=new Map<string,{authority:string;document:string;url:string;locators:string[];verifiedOn:string[]}>()
 for(const r of document.references){const key=r.url+"|"+r.document,group=references.get(key)??{authority:r.authority,document:r.document,url:r.url,locators:[],verifiedOn:[]};if(!group.locators.includes(r.locator))group.locators.push(r.locator);if(!group.verifiedOn.includes(r.verifiedOn))group.verifiedOn.push(r.verifiedOn);references.set(key,group)}
 const original=document.original.execution
 const otherAlternatives=document.inverse?.alternatives.filter(a=>a.gross.raw!==null&&a.gross.raw!==document.amounts.gross.raw)??[]
 const firstAlternative=otherAlternatives[0]
 const alternativePreview=firstAlternative?`Otra alternativa verificada${firstAlternative.original.scenario==="conditional-minimum"?" bajo hipótesis mensual":""}: ${firstAlternative.gross.display}${otherAlternatives.length>1?" · Hay más candidatos verificados en la tabla.":""}`:null
 return Object.freeze({schemaVersion:"nomina-salary-report-v1" as const,document,reportId,shortId:reportId.replaceAll("-","").slice(0,8).toUpperCase(),
  exportedAt:exportedAt.toISOString(),exportedLocal:`${civil(exportCivilDate(exportedAt))} ${pad(exportedAt.getHours())}:${pad(exportedAt.getMinutes())}:${pad(exportedAt.getSeconds())}`,
  originalDate:`${civil(original.completedLocalDate??original.consultationLocalDate)}${original.completedLocalTime?` ${original.completedLocalTime}`:""}`,originalInstant:original.completedAt,originalZone:reportUtcOffset(original.utcOffsetMinutes),exportZone:reportUtcOffset(-exportedAt.getTimezoneOffset()),consultationDate:civil(original.consultationLocalDate),year:document.referenceDate.raw.slice(0,4),alternativePreview,
  footer:"Simulación estimada — no es CFDI de nómina ni comprobante de pago",fiscalRows:Object.freeze(fiscal),integrationRows:Object.freeze(integration),referenceDays:days,retentionPolicyLabel:assessment?'Retención contextual v2':null,
  sbcLimitApplied:sbc?.sbc.limitApplied??null,assumptions:Object.freeze(assumptions),warnings:Object.freeze(warnings),notices:Object.freeze(notices),references:Object.freeze([...references.values()].map(r=>Object.freeze({...r,title:referenceTitles[r.document]??r.document,locators:Object.freeze(r.locators),displayLocators:Object.freeze(r.locators.map(l=>referenceLocators[l]??l)),verifiedOn:Object.freeze(r.verifiedOn)}))),
  attention:Boolean(p.confirmation||p.issues.length||importantWarnings(p).length||p.inverse&&(p.inverse.match!=="exact"||p.inverse.coverage!=="complete"||!p.inverse.minimumProven)),
 })
}
export type SalaryReport=ReturnType<typeof createSalaryReport>
