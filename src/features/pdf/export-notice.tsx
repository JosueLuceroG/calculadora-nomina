import {X} from "lucide-react"
import type {PdfExportState} from "./export-controller"
export function PdfExportNotice({state,onDismiss}:{state:PdfExportState|null;onDismiss:()=>void}){if(!state||state.phase==="idle")return null;return <aside className={`pdf-export-notice${state.phase==="error"?" pdf-export-notice-error":""}`} aria-label="Exportación PDF"><p role={state.phase==="error"?"alert":"status"}>{state.message}</p>{!state.busy&&<button type="button" onClick={onDismiss} aria-label="Cerrar aviso de exportación PDF"><X size={16} aria-hidden="true"/></button>}</aside>}
