import regularData from "./assets/DejaVuSans.ttf?inline"
import boldData from "./assets/DejaVuSans-Bold.ttf?inline"
import type {PdfFonts} from "./render-pdf"
function decode(data:string){if(!data.startsWith("data:")||!data.includes(";base64,"))throw new Error("No se pudo cargar la fuente local del PDF.");return Uint8Array.from(atob(data.slice(data.indexOf(",")+1)),c=>c.charCodeAt(0))}
let cached:PdfFonts|null=null
export async function loadLocalPdfFonts():Promise<PdfFonts>{return cached??=Object.freeze({regular:decode(regularData),bold:decode(boldData)})}
