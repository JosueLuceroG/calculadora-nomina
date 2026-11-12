import {Button} from '@/components/ui/button'
import type {TransientExecution} from '../external-calculation-controller'
import type {ExternalDocumentState} from '../external-document-controller'
export function ExternalExecutionNotice({execution,document,consent,save,reconcile}:{execution:TransientExecution;document:ExternalDocumentState|null;consent:boolean;save:()=>void;reconcile:()=>void}){const c=execution.context;return <section className="surface fiscal-execution-notice" data-transient-execution={execution.executionId??''} data-context-fingerprint={execution.fingerprint??''} data-external-document-phase={document?.phase??'idle'} aria-labelledby="external-execution-title">
 <h3 id="external-execution-title">Fuente utilizada por esta ejecución</h3>
  <p><strong>{execution.channel==='production'?'Fuente productiva autenticada · La aprobación editorial no certifica el cálculo salarial.':execution.channel==='qa'?'Parámetros sintéticos QA · No representan valores oficiales de México.':'Verificando el canal de la fuente externa…'}</strong></p>
 <p>{c?`${c.packageId} · ${c.parameterVersion} · revisión ${c.revision}`:'Preparando el contexto fiscal autorizado…'}</p>
 {c&&<p>Fecha fiscal {c.fiscalDate} · {c.periodicity==='monthly'?'Mensual':c.periodicity==='weekly'?'Semanal':'Quincenal'} · {c.operation==='gross-to-net'?'Bruto a neto':'Neto a bruto'}. La selección actual puede ser distinta; este resultado conserva su fuente original.</p>}
 <p role="status">{document?.message??'Resultado en RAM; sin guardado confirmado.'}</p>
 <p>La firma autentica parámetros, no firma el resultado ni atesta la honestidad del cálculo JavaScript.</p>
 <div className="fiscal-packages-actions"><Button variant="outline" disabled={!consent||!document?.initialConsent||!document.document||document.busy||['stored','deleted','unknown'].includes(document.phase)} onClick={save}>Guardar en Historial</Button><Button variant="outline" disabled={!document?.document||document.busy} onClick={reconcile}>Consultar guardado</Button></div>
 {!consent&&<p>Historial deshabilitado: también impide el guardado manual. Habilitarlo en Historial solo autoriza ejecuciones futuras.</p>}
 </section>}
