import {jsPDF} from "jspdf"
import {autoTable,type UserOptions} from "jspdf-autotable"
import {documentAmount,type PdfDocumentModel} from "./document-model"

export type PdfFonts=Readonly<{regular:Uint8Array;bold:Uint8Array}>
export const PDF_GLYPH_PROBE="Acentos: áéíóú ÁÉÍÓÚ · ñ Ñ · $ 25% · 1,234,567,890.01 · — – − ≤ ≥ ≈ → •"
export const PDF_STRESS_ROWS=112
const LEFT=42,RIGHT=570,TOP=80,BOTTOM=738,WIDTH=RIGHT-LEFT
function base64(bytes:Uint8Array){let binary="";for(let p=0;p<bytes.length;p+=32768)binary+=String.fromCharCode(...bytes.subarray(p,p+32768));return btoa(binary)}
export function renderPdf(model:PdfDocumentModel,fonts:PdfFonts,options:{long?:boolean;createdAt?:Date;fileId?:string}={}){
 const doc=new jsPDF({orientation:"portrait",unit:"pt",format:"letter",compress:true,putOnlyUsedFonts:true,floatPrecision:16})
 doc.addFileToVFS("DejaVuSans.ttf",base64(fonts.regular));doc.addFont("DejaVuSans.ttf","DejaVuSans","normal")
 doc.addFileToVFS("DejaVuSans-Bold.ttf",base64(fonts.bold));doc.addFont("DejaVuSans-Bold.ttf","DejaVuSans","bold")
 doc.setFont("DejaVuSans","normal");doc.setLineHeightFactor(1.3)
 doc.setProperties({title:"Calculadora de Nómina — Prueba técnica 5B.10",subject:"Simulación estimada con datos ficticios. No es CFDI de nómina.",author:"Calculadora de Nómina",creator:"Calculadora de Nómina · jsPDF + AutoTable",keywords:"5B.10, prueba técnica, simulación, no CFDI"})
 doc.setCreationDate(options.createdAt??new Date());doc.setFileId(options.fileId??crypto.randomUUID().replaceAll("-",""))
 const corpus=[PDF_GLYPH_PROBE,model.title,model.state,model.direction,...model.warnings.map(w=>w.message),...model.issues.map(i=>i.message),...model.references.flatMap(r=>[r.authority,r.document,r.locator,r.url])].join("\n")
 for(const style of["normal","bold"]){doc.setFont("DejaVuSans",style);const metadata=doc.getFont().metadata as {characterToGlyph?:(code:number)=>number};if(!metadata.characterToGlyph)throw new Error("INVALID_LOCAL_FONT");for(const char of corpus){if(char==="\n"||char==="\r"||char==="\t")continue;if(!metadata.characterToGlyph(char.codePointAt(0)!))throw new Error(`UNSUPPORTED_PDF_GLYPH_U+${char.codePointAt(0)!.toString(16).toUpperCase()}`)}}
 type Box={page:number;x:number;y:number;width:number;height:number;kind:string;text:string}
 const boxes:Box[]=[],stressPages=new Set<number>();let y=TOP
 const page=()=>doc.getNumberOfPages()
 function ensure(height:number){if(y+height>BOTTOM){doc.addPage("letter","portrait");y=TOP}}
 function paragraph(text:string,size=9,bold=false,color:[number,number,number]=[35,52,67]){
  doc.setFont("DejaVuSans",bold?"bold":"normal");doc.setFontSize(size);doc.setTextColor(...color)
  const lines=doc.splitTextToSize(text,WIDTH) as string[]
  for(const line of lines){ensure(size*1.35);doc.text(line,LEFT,y,{baseline:"top"});boxes.push({page:page(),x:LEFT,y,width:doc.getTextWidth(line),height:size*1.35,kind:"text",text:line});y+=size*1.35}y+=5
 }
 function drawPdfTable(head:string[][],body:string[][],kind:string,extra:Partial<UserOptions>={}){
  ensure(42)
  // Escape léxico: el escáner Tailwind no debe convertir el tema de AutoTable en una utilidad de la aplicación.
  autoTable(doc,{startY:y,head,body,theme:"gr\u0069d",showHead:"everyPage",rowPageBreak:"avoid",margin:{left:LEFT,right:42,top:TOP,bottom:54},tableWidth:WIDTH,
   styles:{font:"DejaVuSans",fontStyle:"normal",fontSize:9,cellPadding:5,overflow:"linebreak",lineColor:[215,224,220],lineWidth:0.35,textColor:[25,43,37]},headStyles:{font:"DejaVuSans",fontStyle:"bold",fillColor:[8,99,89],textColor:[255,255,255]},alternateRowStyles:{fillColor:[245,248,246]},
   didDrawCell:data=>{boxes.push({page:page(),x:data.cell.x,y:data.cell.y,width:data.cell.width,height:data.cell.height,kind,text:data.cell.text.join("\n")});if(kind==="stress")stressPages.add(page())},...extra})
  y=(doc as jsPDF&{lastAutoTable:{finalY:number}}).lastAutoTable.finalY+12
 }
 paragraph(`${model.direction} · ${model.state}`,10,true,[8,99,89])
 drawPdfTable([],[["Fecha fiscal",model.referenceDate.display,"Periodicidad",model.period.display],["Zona",model.area.display,"Descontar IMSS",model.includeImss?"Sí":"No"],["Aguinaldo",`${model.benefits.bonusDays} días`,"Vacaciones",`${model.benefits.vacationDays} días`],["Prima vacacional",`${model.benefits.vacationPremium}%`,"Origen",model.original.origin==="history"?"Snapshot original":model.original.origin==="current"?"Resultado actual":"Fixture verificado"]],"facts",{theme:"plain",columnStyles:{0:{cellWidth:85,fontStyle:"bold"},1:{cellWidth:179},2:{cellWidth:90,fontStyle:"bold"},3:{cellWidth:174}}})
 ensure(82)
 for(const[index,label,amount]of[[0,"Salario bruto",model.amounts.gross.display],[1,"Neto estimado",model.amounts.net.display]] as const){const x=LEFT+index*270;doc.setFillColor(234,245,241);doc.roundedRect(x,y,258,68,7,7,"F");doc.setTextColor(8,99,89);doc.setFont("DejaVuSans","normal");doc.setFontSize(10);doc.text(label,x+12,y+10,{baseline:"top"});doc.setFont("DejaVuSans","bold");let size=22;doc.setFontSize(size);while(doc.getTextWidth(amount)>234&&size>10){doc.setFontSize(--size)}if(doc.getTextWidth(amount)>234)throw new Error("PDF_AMOUNT_DOES_NOT_FIT");doc.text(amount,x+12,y+29,{baseline:"top"});boxes.push({page:page(),x,y,width:258,height:68,kind:"highlight",text:amount})}
 y+=82
 drawPdfTable([["Concepto del reporte original","Importe (MXN)"]],[["ISR retenido",model.amounts.isr.display],["IMSS descontado",model.amounts.imss.display]],"deductions",{columnStyles:{0:{cellWidth:370},1:{cellWidth:158,halign:"right"}}})
 if(model.inverse){drawPdfTable([["Comparación del inverso","Importe (MXN)"]],[["Neto objetivo",model.inverse.target.display],["Neto obtenido",model.inverse.obtained.display],["Diferencia original",model.inverse.difference.display]],"comparison",{columnStyles:{1:{halign:"right"}}});if(model.inverse.alternatives.length)drawPdfTable([["Alternativa verificada: bruto","Neto obtenido","Diferencia"]],model.inverse.alternatives.map(a=>[a.gross.display,a.net.display,a.difference.display]),"alternatives")}
 if(model.confirmation){const note=model.confirmation.basis==="direct-retention"?`Condición fiscal pendiente (${model.confirmation.referenceMonth}). Sin confirmación no se presume retención ni neto conocidos.`:`Hipótesis mensual pendiente para el punto bruto ${documentAmount(model.confirmation.candidateGross).display} (${model.confirmation.referenceMonth}). ${model.inverse&&model.inverse.original.recommendedGross!==null?"El candidato mostrado conserva su verificación.":"No hay un candidato verificado que presentar."}`;paragraph(note,10,true,[125,78,20])}
 for(const issue of model.issues)paragraph(issue.message,9,false,[125,48,50])
 paragraph("Las cifras se copian del reporte fiscal original. — indica un valor desconocido, no cero. Esta prueba no certifica pagos ni retenciones reales.")
 paragraph("Prueba de caracteres y cifra grande (no son importes adicionales de nómina):",8,true)
 paragraph(PDF_GLYPH_PROBE,8)
 paragraph("Referencias del reporte original",9,true)
 for(const r of model.references.slice(0,2))paragraph(`${r.authority} · ${r.document} · ${r.locator}`,8)
 paragraph(`Paquete: ${model.original.fiscalPackage.version}. Modelo documental: ${model.schemaVersion}.`,7.5)
 if(options.long){
  doc.addPage("letter","portrait");y=TOP
  paragraph("Anexo técnico de paginación — contenido ficticio",12,true)
  paragraph("Las filas siguientes prueban texto largo y continuidad de tablas; no representan percepciones, deducciones ni empleados adicionales.",9)
  drawPdfTable([["Fila de prueba","Texto largo de verificación"]],Array.from({length:PDF_STRESS_ROWS},(_,i)=>[`PRUEBA-${String(i+1).padStart(3,"0")}`,`Párrafo ficticio ${i+1}: revisión de nómina, retención, integración y prestaciones. La letra ñ y los acentos deben permanecer legibles; cada fila completa conserva sus márgenes, sin recortar líneas ni invadir el pie de página.`]),"stress",{columnStyles:{0:{cellWidth:92},1:{cellWidth:436}}})
  paragraph("Advertencias originales conservadas",11,true)
  for(const warning of model.warnings)paragraph(`${warning.code}: ${warning.message}`,8.5)
  paragraph("Fuentes originales completas (consulta no requerida para generar o leer el PDF)",10,true)
  drawPdfTable([["Fuente / documento / ubicación","URL de referencia"]],model.references.map(r=>[`${r.authority} · ${r.document} · ${r.locator}`,r.url]),"sources",{columnStyles:{0:{cellWidth:280},1:{cellWidth:248}},styles:{font:"DejaVuSans",fontSize:8,cellPadding:5,overflow:"linebreak",lineColor:[215,224,220],lineWidth:0.35}})
 }
 const count=doc.getNumberOfPages()
 for(let n=1;n<=count;n++){doc.setPage(n);doc.setTextColor(11,28,61);doc.setFont("DejaVuSans","bold");doc.setFontSize(17);doc.text(model.title,LEFT,38);doc.setFont("DejaVuSans","normal");doc.setFontSize(8);doc.text("PRUEBA TÉCNICA 5B.10",RIGHT,34,{align:"right"});doc.setFontSize(9);doc.setTextColor(8,99,89);doc.text(`${model.nature} · Datos exclusivamente ficticios`,LEFT,55);doc.setDrawColor(205,220,212);doc.line(LEFT,65,RIGHT,65);doc.line(LEFT,750,RIGHT,750);doc.setFontSize(8.5);doc.setTextColor(65,80,72);doc.text(model.disclaimer,LEFT,766);doc.text(`Página ${n} de ${count}`,RIGHT,766,{align:"right"})}
 for(const box of boxes)if(box.x<LEFT-0.01||box.x+box.width>RIGHT+0.02||box.y<TOP-0.01||box.y+box.height>BOTTOM+0.02)throw new Error(`PDF_LAYOUT_OUTSIDE_BODY_${box.kind}`)
 return{bytes:new Uint8Array(doc.output("arraybuffer")),audit:{pages:count,pageSize:[612,792],body:{left:LEFT,right:RIGHT,top:TOP,bottom:BOTTOM},stressRows:options.long?PDF_STRESS_ROWS:0,stressPages:[...stressPages],boxes}}
}
