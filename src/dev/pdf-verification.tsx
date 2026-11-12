import {useEffect,useState} from "react"
import {createRoot} from "react-dom/client"
import {loadPdfProbeCases,getPdfPreparationCalls,type PdfProbeCase} from "./pdf-probe-data"
import {loadLocalPdfFonts} from "../features/pdf/font-loader"
import {renderPdf,type PdfFonts} from "../features/pdf/render-pdf"
import {savePdfProbe,type PdfSaveResult} from "../features/pdf/native-save"
import "./pdf-probe.css"
if(!import.meta.env.DEV)throw new Error("PDF probe is development-only")
let fonts:PdfFonts,cases:PdfProbeCase[]
const verification={ready:false,generated:null as ReturnType<typeof renderPdf>|null,lastSave:null as PdfSaveResult|null,error:null as string|null,
 get cases(){return cases},get preparationCalls(){return getPdfPreparationCalls()},
 generate(id="directo",long=false){const found=cases.find(c=>c.id===id);if(!found)throw new Error("Missing PDF fixture");const before=getPdfPreparationCalls();const result=renderPdf(found.model,fonts,{long,createdAt:new Date("2026-10-20T12:00:00.000Z"),fileId:("5b10"+String(cases.indexOf(found)+1).padStart(26,"0")+(long?"02":"01"))});if(getPdfPreparationCalls()!==before)throw new Error("Generator executed a fiscal operation");this.generated=result;return result},
 get bytes(){return this.generated?Array.from(this.generated.bytes):null},
}
declare global{interface Window{__pdfProbe:typeof verification}}
window.__pdfProbe=verification
function Probe(){
 const[ready,setReady]=useState(false),[id,setId]=useState("directo"),[long,setLong]=useState(false),[generated,setGenerated]=useState<ReturnType<typeof renderPdf>|null>(null),[saving,setSaving]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState("")
 useEffect(()=>{let active=true;void Promise.all([loadLocalPdfFonts(),loadPdfProbeCases()]).then(([f,c])=>{if(!active)return;fonts=f;cases=c;verification.ready=true;setReady(true)}).catch(e=>{setError(String(e));verification.error=String(e)});return()=>{active=false}},[])
 function generate(){try{setError("");verification.error=null;const result=verification.generate(id,long);setGenerated(result);setMessage(`PDF vectorial preparado: ${result.audit.pages} página(s), ${result.bytes.length} bytes.`)}catch(e){const text=e instanceof Error?e.message:String(e);setError(text);verification.error=text}}
 async function save(){if(!generated)return;setSaving(true);setError("");setMessage("");verification.lastSave=null;verification.error=null;try{const result=await savePdfProbe(generated.bytes,long?"nomina-larga.pdf":"nomina-corta.pdf");verification.lastSave=result;setMessage(result.status==="cancelled"?"Guardado cancelado. No se creó un PDF.":`PDF guardado: ${result.path} · SHA-256 ${result.sha256}`)}catch(e){const text=e instanceof Error?e.message:String(e);verification.error=text;setError(text)}finally{setSaving(false)}}
 const selected=ready?cases.find(c=>c.id===id)!.model:null
 return <main><p className="probe-label">PRUEBA TÉCNICA 5B.10 · DATOS EXCLUSIVAMENTE FICTICIOS</p><h1>Calculadora de Nómina — prueba PDF</h1><p>Entrada aislada de desarrollo. Generación vectorial local; no es la exportación de producción ni un CFDI de nómina.</p>
 {!ready&&<p role="status">Preparando fuentes locales y reportes de prueba…</p>}
 <label htmlFor="pdf-case">Reporte original de prueba</label><select id="pdf-case" value={id} disabled={!ready||saving} onChange={e=>{setId(e.target.value);setGenerated(null);verification.generated=null}}>{ready?cases.map(c=><option key={c.id} value={c.id}>{c.label}</option>):<option>Cargando…</option>}</select>
 <label><input id="pdf-long" type="checkbox" checked={long} disabled={!ready||saving} onChange={e=>{setLong(e.target.checked);setGenerated(null);verification.generated=null}}/> Añadir anexo multipágina de paginación</label>
 {selected&&<><p id="pdf-source-state">{selected.state}</p><div className="probe-grid">{[["Bruto",selected.amounts.gross],["ISR retenido",selected.amounts.isr],["IMSS descontado",selected.amounts.imss],["Neto",selected.amounts.net]].map(([label,amount])=><div key={label as string}>{label as string}<strong>{(amount as typeof selected.amounts.gross).display}</strong></div>)}</div><small>Fecha fiscal: {selected.referenceDate.display} · {selected.period.display} · Zona {selected.area.display}. Los importes se copian de los reportes, no se recalculan en el generador.</small></>}
 <button id="generate-pdf" type="button" disabled={!ready||saving} onClick={generate}>Generar PDF de prueba</button><button id="save-pdf" type="button" disabled={!generated||saving} onClick={()=>void save()}>{saving?"Diálogo de guardado abierto…":"Guardar con diálogo Windows"}</button>
 <p id="pdf-operation" role="status">{message}</p>{error&&<p id="pdf-error" role="alert">{error}</p>}<small>PDF con DejaVu Sans local y licencia redistribuible, texto seleccionable y tablas vectoriales. No se utiliza captura de pantalla ni generación remota.</small></main>
}
createRoot(document.getElementById("root")!).render(<Probe/>)
