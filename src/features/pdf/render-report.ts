import {jsPDF} from "jspdf"
import {autoTable,type UserOptions} from "jspdf-autotable"
import type {PdfFonts} from "./render-pdf"
import type {SalaryReport} from "./report-model"
import {documentAmount} from "./document-model"
import {PDF_EVIDENCE_PREVIEW,documentaryLabels,dispositionLabels} from '../documents/compat-outcome-view'

const L=42,R=570,W=528,TOP=78,BOTTOM=730
const ink:[number,number,number]=[22,43,37],green:[number,number,number]=[8,99,89],muted:[number,number,number]=[71,91,82],amber:[number,number,number]=[121,79,23]
function base64(bytes:Uint8Array){let value="";for(let i=0;i<bytes.length;i+=32768)value+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(value)}
export type ReportBox={page:number;x:number;y:number;width:number;height:number;section:string;text:string}
export function renderSalaryReport(report:SalaryReport,fonts:PdfFonts){
 const m=report.document,doc=new jsPDF({unit:"pt",format:"letter",orientation:"portrait",compress:true,putOnlyUsedFonts:true,floatPrecision:16})
 doc.addFileToVFS("DejaVuSans.ttf",base64(fonts.regular));doc.addFont("DejaVuSans.ttf","DejaVuSans","normal");doc.addFileToVFS("DejaVuSans-Bold.ttf",base64(fonts.bold));doc.addFont("DejaVuSans-Bold.ttf","DejaVuSans","bold")
 doc.setCreationDate(new Date(report.exportedAt));doc.setFileId(report.reportId.replaceAll("-",""));doc.setProperties({title:"Reporte de simulación salarial — Calculadora de Nómina",author:"Calculadora de Nómina",creator:"Calculadora de Nómina",subject:report.footer,keywords:"simulación salarial, estimación, reporte"})
  const allText=[m.state,report.footer,report.alternativePreview??"",...report.fiscalRows.map(r=>r.display),...report.integrationRows.flatMap(r=>[r.label,r.display,r.note??""]),...report.notices.map(w=>w.message),...m.issues.map(i=>i.message),...report.references.flatMap(r=>[r.title,r.document,r.authority,...r.locators]),...(m.original.externalDocument?[JSON.stringify(m.original.externalDocument)]:[]),...(m.original.compatDetails?[JSON.stringify(m.original.compatDetails)]:[])].join("\n")
 for(const style of["normal","bold"]){doc.setFont("DejaVuSans",style);const meta=doc.getFont().metadata as {characterToGlyph?:(code:number)=>number};if(!meta.characterToGlyph)throw new Error("La fuente del PDF no se pudo preparar.");for(const c of allText){if(/\s/.test(c))continue;if(!meta.characterToGlyph(c.codePointAt(0)!))throw new Error(`La fuente local no incluye el carácter U+${c.codePointAt(0)!.toString(16).toUpperCase()}.`)}}
 let y=TOP,section="resumen";const boxes:ReportBox[]=[]
 const page=()=>doc.getNumberOfPages()
 function ensure(height:number){if(y+height>BOTTOM){doc.addPage("letter","portrait");y=TOP}}
 function text(value:string,size=10,bold=false,color=ink,spacing=5){doc.setFont("DejaVuSans",bold?"bold":"normal");doc.setFontSize(size);doc.setTextColor(...color);const lines=doc.splitTextToSize(value,W) as string[];for(const line of lines){ensure(size*1.4);doc.text(line,L,y,{baseline:"top"});boxes.push({page:page(),x:L,y,width:doc.getTextWidth(line),height:size*1.4,section,text:line});y+=size*1.4}y+=spacing}
 const headingHeight=4+12*1.4+4
 function heading(label:string,minFollowing=45){ensure(headingHeight+minFollowing);y+=4;text(label,12,true,green,4)}
 function drawRows(head:string[][],body:string[][],extra:Partial<UserOptions>={}){
  ensure(46)
  autoTable(doc,{startY:y,head,body,theme:"plain",showHead:"everyPage",rowPageBreak:"avoid",tableWidth:W,margin:{top:TOP,bottom:62,left:L,right:42},
   styles:{font:"DejaVuSans",fontStyle:"normal",fontSize:10,cellPadding:{top:4,right:9,bottom:4,left:9},textColor:ink,overflow:"linebreak",lineWidth:0,lineColor:[215,226,219]},
   headStyles:{fontStyle:"bold",fillColor:[233,243,237],textColor:green,lineWidth:{bottom:0.6}},bodyStyles:{lineWidth:{bottom:0.35}},alternateRowStyles:{fillColor:[248,250,248]},
   didDrawCell:d=>{boxes.push({page:page(),x:d.cell.x,y:d.cell.y,width:d.cell.width,height:d.cell.height,section,text:d.cell.text.join("\n")})},...extra})
   y=(doc as jsPDF&{lastAutoTable:{finalY:number}}).lastAutoTable.finalY+6
 }
 function facts(items:[string,string][],columns=3){const width=W/columns,rows=Math.ceil(items.length/columns);doc.setFont("DejaVuSans","bold");doc.setFontSize(10);const values=items.map(i=>doc.splitTextToSize(i[1],width-12) as string[]),step=Math.max(32,...values.map(lines=>13+lines.length*11.5+3));if(values.some(lines=>lines.length>2))throw new Error("El dato de identificación excede el espacio del reporte.");ensure(rows*step+6);for(let i=0;i<items.length;i++){const x=L+(i%columns)*width,top=y+Math.floor(i/columns)*step;doc.setFont("DejaVuSans","normal");doc.setFontSize(8);doc.setTextColor(...muted);doc.text(items[i][0],x,top,{baseline:"top"});doc.setFont("DejaVuSans","bold");doc.setFontSize(10);doc.setTextColor(...ink);doc.text(values[i],x,top+13,{baseline:"top",lineHeightFactor:1.15});boxes.push({page:page(),x,y:top,width:width-12,height:step-1,section,text:items[i][0]+": "+items[i][1]})}y+=rows*step+6}
 function wrapped(value:string,width:number,size:number,bold=false){doc.setFont("DejaVuSans",bold?"bold":"normal");doc.setFontSize(size);return doc.splitTextToSize(value,width) as string[]}
 function rowHeight(values:string[],widths:number[],bold=false){return Math.max(...values.map((value,i)=>wrapped(value,widths[i]-18,10,bold).length*11.5+8))}
 text("Reporte de simulación salarial",20,true,ink,4)
  text(m.direction,11,true,green,6)
  if(m.original.externalDocument?.fixtureNotice)text(m.original.externalDocument.fixtureNotice,10,true,amber,8)
 facts([["Cálculo realizado (hora local)",report.originalDate],["Fecha de referencia fiscal",m.referenceDate.display],["Periodicidad / ejercicio",`${m.period.display} · ${report.year}`],["Documento exportado (hora local)",report.exportedLocal],["Zona salarial",m.area.display],["Origen del reporte",m.original.origin==="history"?"Historial original":m.original.origin==="current"?"Resultado de Calcular":"Datos ficticios verificados"]])
 ensure(70)
 for(const[index,label,value]of[[0,m.inverse?"Bruto recomendado / encontrado":"Salario bruto",m.amounts.gross.display],[1,m.inverse?"Neto efectivamente obtenido":"Salario neto estimado",m.amounts.net.display]] as const){const x=L+index*270;doc.setFillColor(235,245,239);doc.roundedRect(x,y,258,65,7,7,"F");doc.setFont("DejaVuSans","normal");doc.setTextColor(...green);doc.setFontSize(10);doc.text(label,x+12,y+9,{baseline:"top"});doc.setFont("DejaVuSans","bold");let size=24;doc.setFontSize(size);while(doc.getTextWidth(value)>234&&size>12)doc.setFontSize(--size);if(doc.getTextWidth(value)>234)throw new Error("El importe no cabe sin perder legibilidad.");doc.text(value,x+12,y+28,{baseline:"top"});boxes.push({page:page(),x,y,width:258,height:65,section,text:value})}y+=70
 text(m.state,9.5,true,report.attention?amber:green,6)
 if(report.alternativePreview)text(report.alternativePreview,10,true,green,5)
  if(m.inverse){facts([["Neto solicitado",m.inverse.target.display],["Neto obtenido",m.inverse.obtained.display],["Diferencia",m.inverse.difference.display]]);if(m.inverse.original.match==="approximate")text("Aproximación: el neto obtenido no coincide con el solicitado. La diferencia se conserva con su signo original.",9.5,true,amber)}
  const originalDocument=m.original.originalDocument,compat=m.original.compatDetails
  if(originalDocument){
   section='documento-original';heading('Identidad del documento original',50)
   text(`Documento original: ${m.original.executionId??'Sin ID documental'}`,8.5)
   text(`SHA-256 del documento original (wire UTF-8): ${originalDocument.sha256}`,8.5)
   text(`Tamaño original: ${originalDocument.byteLength} bytes. ${originalDocument.source==='storage-read'?'Original leído del almacenamiento local.':'Vista de un documento en RAM / QA; no acredita persistencia.'}`,9)
   text('Este PDF es un resumen documental: no contiene toda la evidencia del JSON original. Consulte el original identificado por su ID y checksum.',9,true,amber)
  }
  if(compat){
   section='estado-documental';heading('Estado global y resultado encontrado',45)
   text(`Estado global: ${compat.globalLabel} (${compat.globalStatus}). ${compat.candidateLabel}.`,9.5,true)
   if(m.original.documentClassification)text(`Clasificación documental: ${documentaryLabels[m.original.documentClassification]}.`,9.5)
   const i=compat.inverse
   if(i){
    text(`Motivo de terminación: ${i.stopLabel} (${i.metrics.stopReason}). Evaluaciones: ${i.metrics.directEvaluations}/${i.metrics.maxEvaluations}. Tiempo: ${i.metrics.elapsedMs} ms / ${i.metrics.maxDurationMs} ms.`,9.5)
    text(`Certificado técnico disponible: ${i.certificateAvailable?'Sí':'No'}. Cierres certificados: ${i.metrics.certifiedClosures}. Certificación fiscal: no certificada. Motivo original: ${i.certificateReason}.`,9.5)
    text('La cobertura, el candidato, las garantías locales y el certificado son dimensiones distintas. No se acredita honestidad matemática de JavaScript ni optimalidad global de una aproximación.',9,false,muted)
   }
  }
 if(m.confirmation){text(m.confirmation.contextual?m.confirmation.contextual.message:m.confirmation.basis==="direct-retention"?`Hipótesis mensual pendiente (${m.confirmation.referenceMonth}): ISR retenido y neto no determinables sin confirmarla.`:`Punto fiscal pendiente: bruto ${documentAmount(m.confirmation.candidateGross).display} (${m.confirmation.referenceMonth}). La hipótesis afecta solo a ese punto; los demás candidatos conservan su verificación.`,9.5,true,amber)}
 section="desglose";heading("Desglose fiscal",130)
 drawRows([["Concepto","Importe del periodo (MXN)"]],report.fiscalRows.map(r=>[r.label,r.display]),{columnStyles:{0:{cellWidth:360},1:{cellWidth:168,halign:"right"}},didParseCell:d=>{if(d.section==="body"&&d.row.index===report.fiscalRows.length-1){d.cell.styles.fontStyle="bold";d.cell.styles.fillColor=[235,245,239];d.cell.styles.textColor=green}}})
 text("Neto estimado = bruto − ISR retenido − IMSS efectivamente descontado.",9,false,muted,5)
 section="prestaciones";ensure(35);text("Prestaciones declaradas",10,true,green,2);text(`Aguinaldo: ${m.benefits.bonusDays} días · Vacaciones: ${m.benefits.vacationDays} días · Prima vacacional: ${m.benefits.vacationPremium}%`,10,false,ink,3)
 if(m.inverse){section="inverso";heading("Garantías y alternativas del inverso",70);const i=m.inverse.original;text(i.domain?`Dominio de bruto analizado: ${documentAmount(i.domain.from).display} a ${documentAmount(i.domain.to).display}.`:"Dominio analizado: no determinado.",9.5)
  text(i.coverage==="complete"?"Cobertura completa exclusivamente dentro del dominio indicado.":i.coverage==="limited"?"Cobertura limitada: quedan intervalos pendientes; pueden existir otras alternativas.":"Cobertura fiscal incompleta: hay puntos con condiciones pendientes; no equivale a ausencia de solución.",9.5,false,report.attention?amber:muted)
  text(i.minimumProven?"Mínimo demostrado solo dentro del dominio analizado, no un mínimo global fuera de él.":"No se ha demostrado que el bruto encontrado sea el mínimo; puede existir uno menor.",9.5,true,report.attention?amber:green)
  text(i.uniquenessProven?"Unicidad demostrada únicamente dentro de ese dominio.":"No se afirma unicidad de la solución.",9.5)
  if(!i.exactSetComplete)text(compat?"El conjunto de coincidencias exactas no está demostrado completo.":"La lista de coincidencias exactas no está certificada como completa.",9.5)
  if(i.noExactMatchProven)text("Ausencia de coincidencia exacta demostrada únicamente dentro del dominio indicado.",9.5)
   if(m.inverse.alternatives.length)drawRows([["Bruto verificado","Neto obtenido","Diferencia"]],m.inverse.alternatives.map(a=>[a.gross.display+(report.retentionPolicyLabel&&a.original.scenario==='conditional-minimum'?' · Hipótesis mensual':''),a.net.display,a.difference.display]),{columnStyles:{0:{halign:"right"},1:{halign:"right"},2:{halign:"right"}}})
  else text("No hay alternativas exactas verificadas para mostrar.",9.5)
  }
  if(compat?.inverse){
   const i=compat.inverse
   section='evidencia-documental';heading('Intervalos y evidencia del original',50)
   text('Resumen fiel de las listas originales, en su orden. Las filas omitidas continúan en el JSON original identificado por checksum; no se descartan del documento.',9,false,muted)
   const tables:readonly (readonly [string,readonly {from:string;to:string;disposition?:keyof typeof dispositionLabels;reason?:string}[]])[]=[['Intervalos pendientes por presupuesto',i.pending],['Intervalos fiscales pendientes',i.fiscalPending],['Evidencia de cobertura',i.evidence]]
   for(const [label,rows] of tables){
    const shown=rows.slice(0,PDF_EVIDENCE_PREVIEW)
    heading(`${label}: ${rows.length} filas originales`,35)
    text(`Se muestran ${shown.length} de ${rows.length}${rows.length>shown.length?` (primeras ${shown.length}); ${rows.length-shown.length} omitidas en este resumen`:''}.`,9)
    if(shown.length)drawRows([['Desde (bruto MXN)','Hasta (bruto MXN)','Estado / motivo original']],shown.map(r=>[documentAmount(r.from).display,documentAmount(r.to).display,r.disposition?`${dispositionLabels[r.disposition]} · ${r.reason}`:'Intervalo pendiente']),{columnStyles:{0:{cellWidth:125},1:{cellWidth:125},2:{cellWidth:278}},styles:{font:'DejaVuSans',fontStyle:'normal',fontSize:8.5,cellPadding:5,overflow:'linebreak',textColor:ink}})
    else text('Sin filas reportadas en esta lista; no equivale a ausencia de solución.',9)
   }
  }
 section="integracion"
 const integrationHead=["Dato del reporte original","Valor","Unidad"],integrationBody=report.integrationRows.map(r=>[r.label,r.display,r.unit]),integrationWidths=[290,145,93]
 const integrationNote="SDI: salario diario integrado teórico. IMSS y SBC son estimados, no registrados oficialmente. Los límites del SBC solo se muestran si se aplica piso o tope."
 const integrationHeight=26+rowHeight(integrationHead,integrationWidths,true)+integrationBody.reduce((height,row)=>height+rowHeight(row,integrationWidths),0)+6+wrapped(integrationNote,W,9).length*12.6+5
 ensure(Math.min(integrationHeight,BOTTOM-TOP));heading("Integración y cotización estimadas",0)
 drawRows([integrationHead],integrationBody,{columnStyles:{0:{cellWidth:290},1:{cellWidth:145,halign:"right"},2:{cellWidth:93}}})
 text(integrationNote,9,false,muted)
 section="supuestos";heading("Supuestos y advertencias",45)
 for(const notice of report.notices){const message=compat&&m.amounts.subsidy.raw===null&&notice.message==='El subsidio aplicado ya está reflejado en el ISR retenido; no se suma de nuevo al neto.'?'El subsidio aplicado y el ISR retenido no están determinados; no se presumen importes ni se suman al neto.':notice.message;text(`• ${message}`,9.5,false,muted,3)}
 if(m.issues.length){heading("Condiciones que afectan el resultado",35);for(const issue of m.issues)text(`• ${issue.message}`,9.5,false,amber)}
 text("— significa no determinado; no se sustituye por cero.",9.5,false,muted,4)
 section="fuentes"
 const packageLabel=m.original.fiscalPackage.id===m.original.fiscalPackage.version?m.original.fiscalPackage.version:`${m.original.fiscalPackage.id} · ${m.original.fiscalPackage.version}`
  const versions:[string,number][]=[[`Paquete fiscal: ${packageLabel} · Aplicación ${m.original.versions.application}${report.retentionPolicyLabel?` · ${report.retentionPolicyLabel}`:''}`,8.5],[`SHA-256 del paquete: ${m.original.fiscalPackage.sha256}`,8],[`Motor ${m.original.versions.engine}`,8],[`${report.originalInstant?`Original UTC: ${report.originalInstant} · `:""}Exportación UTC: ${report.exportedAt}`,8],[`Hora local del cálculo: ${report.originalZone} · Exportación: ${report.exportZone}`,8.5]]
  const provenance=m.original.executionProvenance
  const external=m.original.externalDocument
  if(compat)versions.push(['Las siete referencias del contexto son seleccionadas; no prueban que todos los módulos fueran evaluados. Las métricas son reportadas, no atestadas.',9])
  if(external){versions.push([`Origen externo firmado · Canal ${external.channel} · Stream ${external.stream} · epoch ${external.epoch} · revisión ${external.revision}`,9.5],[`Productor documental: ${external.producerId}`,9.5],[`SHA-256 payload firmado: ${external.payloadSha256}`,9.5],[`SHA-256 contenedor: ${external.envelopeSha256}`,9.5],[`SHA-256 cabeza de confianza: ${external.trustEnvelopeSha256}`,9.5],[`Verificación observada UTC: ${external.verifiedAt} · Raíz ${external.rootVersion} · trustEpoch ${external.trustEpoch}`,9.5],[`Autorización observada: ${external.authority}`,9.5],[external.trustLimit,9.5],[`Historia referenciada: ${external.historyDocumentCount} documentos · manifiesto ${external.historyManifestSha256}`,9.5],[external.currentTrust,9.5],[`Reglas: ${external.ruleProfile} · Política: ${external.contextualPolicy}`,9.5],[`La firma de parámetros no es firma del resultado salarial ni certificación normativa.`,9.5]);for(const set of external.sets)versions.push([`${set.role}: ${set.id} · ${set.version}`,9.5]);}
  if(provenance){versions.push([`Origen: paquete integrado · confianza del build; sin firma digital externa. Esquema: ${provenance.fiscalPackage.parameterSchemaId}`,8.5],[`Reglas: ${provenance.resolution.ruleProfileId} · Capacidades: ${provenance.resolution.capabilityRegistryVersion}`,8],[`Autorización: ${provenance.authorization.capabilityId} · Productor: ${provenance.producerId}`,8]);for(const set of provenance.effectiveParameterSets)versions.push([`${set.role}: ${set.id} · ${set.version}`,8]);}
 doc.setFont("DejaVuSans","normal");const versionHeight=headingHeight+versions.reduce((height,[value,size])=>{doc.setFontSize(size);return height+(doc.splitTextToSize(value,W) as string[]).length*size*1.4+1},0)
 const referenceWidth=(W-18)/2
 function referenceLayout(r:SalaryReport["references"][number],width:number){const title=wrapped(`${r.authority} · ${r.title}`,width,9.5,true),locators=wrapped(r.displayLocators.join("; "),width,9),dates=wrapped(`Verif. ${r.verifiedOn.map(d=>d.split("-").reverse().join("/")).join(", ")}`,width-135,8.5);return{r,width,title,locators,dates,height:title.length*12+2+locators.length*11.5+3+Math.max(1,dates.length)*11+6}}
 function drawReference(layout:ReturnType<typeof referenceLayout>,x:number,top:number){
  let lineY=top
  const put=(lines:string[],size:number,bold:boolean,color:typeof ink,step:number)=>{doc.setFont("DejaVuSans",bold?"bold":"normal");doc.setFontSize(size);doc.setTextColor(...color);for(const line of lines){doc.text(line,x,lineY,{baseline:"top"});lineY+=step}}
  put(layout.title,9.5,true,green,12);lineY+=2;put(layout.locators,9,false,muted,11.5);lineY+=3
  doc.setFontSize(8.5);doc.setTextColor(...green);const label="Consultar documento oficial",linkWidth=doc.getTextWidth(label)
  doc.text(label,x,lineY,{baseline:"top"});doc.link(x,lineY,linkWidth,11,{url:layout.r.url});doc.setDrawColor(...green);doc.setLineWidth(0.25);doc.line(x,lineY+10,x+linkWidth,lineY+10)
  doc.setTextColor(...muted);doc.text(layout.dates,x+135,lineY,{baseline:"top",lineHeightFactor:11/8.5});doc.setDrawColor(215,226,219);doc.line(x,top+layout.height-4,x+layout.width,top+layout.height-4)
  boxes.push({page:page(),x,y:top,width:layout.width,height:layout.height,section,text:[...layout.title,...layout.locators,label,...layout.dates].join("\n")})
 }
 const firstReferenceHeight=Math.max(0,...report.references.slice(0,2).map(r=>referenceLayout(r,referenceWidth).height))
 let referenceHeight=headingHeight+9*1.4+5+versionHeight
 for(let index=0;index<report.references.length;index+=2)referenceHeight+=Math.max(...report.references.slice(index,index+2).map(r=>referenceLayout(r,referenceWidth).height))+4
 // Mantener fuentes y trazabilidad juntas cuando caben en una página completa.
 if(referenceHeight<=BOTTOM-TOP)ensure(referenceHeight)
 heading("Fuentes oficiales y trazabilidad",Math.min(firstReferenceHeight,100)+19)
 text("Fuentes del reporte original; no se actualizan al exportar. Consulta digital disponible en cada enlace.",9,false,muted,5)
 if(report.references.length){
  for(let index=0;index<report.references.length;index+=2){
   const pair=report.references.slice(index,index+2).map(r=>referenceLayout(r,referenceWidth)),height=Math.max(...pair.map(r=>r.height))
   if(height>BOTTOM-TOP){
    for(const layout of pair){text(`${layout.r.authority} · ${layout.r.title}`,9.5,true,green);text(layout.r.locators.join("; "),9,false,muted);ensure(35);doc.setFontSize(9);doc.setTextColor(...green);doc.textWithLink("Consultar documento oficial",L,y,{url:layout.r.url});y+=15;text(`Verificado: ${layout.r.verifiedOn.join(", ")}`,8.5,false,muted)}
   }else{ensure(height);pair.forEach((r,column)=>drawReference(r,L+column*(referenceWidth+18),y));y+=height+4}
  }
 }else text("El reporte original no contiene fuentes disponibles; no se inventan referencias.",9.5,false,amber)
 section="version"
 ensure(versionHeight);heading("Versión utilizada",0)
 for(const[value,size]of versions)text(value,size,false,ink,1)
 const count=doc.getNumberOfPages()
 for(let n=1;n<=count;n++){doc.setPage(n);doc.setFont("DejaVuSans","bold");doc.setFontSize(11.5);doc.setTextColor(...green);doc.text("Calculadora de Nómina",L,35);doc.setFont("DejaVuSans","normal");doc.setFontSize(8.3);doc.setTextColor(...muted);doc.text(`Reporte salarial · ${m.period.display} · Ejercicio ${report.year}`,R,35,{align:"right"});doc.setDrawColor(208,224,215);doc.line(L,48,R,48);doc.line(L,746,R,746);doc.setFontSize(8);doc.text(report.footer,L,759);doc.text(`Página ${n} de ${count}`,R,759,{align:"right"});doc.setFontSize(7.5);doc.text(`Ref. ${report.shortId} · Cálculo ${report.originalDate} · Fiscal ${m.referenceDate.display}`,L,772)}
 for(const b of boxes)if(b.x<L-0.05||b.x+b.width>R+0.05||b.y<TOP-0.05||b.y+b.height>BOTTOM+0.05)throw new Error(`Contenido fuera de márgenes (${b.section}).`)
 return{bytes:new Uint8Array(doc.output("arraybuffer")),audit:{pages:count,pageSize:[612,792],body:{left:L,right:R,top:TOP,bottom:BOTTOM},boxes},report}
}
