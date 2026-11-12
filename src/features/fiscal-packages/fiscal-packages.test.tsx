import {describe,it,expect,vi} from 'vitest'
import {renderToStaticMarkup} from 'react-dom/server'
import {createNativeFiscalApi,FiscalImportFailure,type FiscalApi,type ImportState,type Preview} from './fiscal-package-api'
import {createFiscalPackageController,type Model} from './fiscal-package-controller'
import {FiscalPackageView} from './fiscal-package-section'
import {FiscalActivationSection} from './fiscal-activation-section'
import {createFiscalExecutionApi} from '../calculator/fiscal-execution-api'
import {createFiscalActivationController} from './fiscal-activation-controller'
import type {FiscalActivationApi,ActivationState} from './fiscal-activation-api'
import type {Installed} from './fiscal-package-api'
import {ExternalExecutionNotice} from '../calculator/components/external-execution-notice'
const p:Preview={kind:'package',repositoryId:'r',generation:1,head:'0',channel:'qa',verifiedAt:'2026-10-26T12:00:00Z',packageId:'<img src=x onerror=alert(1)>',version:'QA',exercise:2026,stream:'qa',epoch:1,revision:1,from:'2026-01-01',through:'2026-12-31',contentSha256:'a',payloadSha256:'b',envelopeSha256:'c',authentication:'authenticated',approval:'approved',consistency:'coherent',compatibility:'compatible',direct:true,inverse:false,inverseReason:'not-authorized',rootVersion:1,trustEpoch:1,alreadyInstalled:false,comparison:null,execution:'not-authorized-for-execution'}
const ready:ImportState={sessionId:'session',operationId:'operation',phase:'ready',error:null,previewNonce:'nonce',summary:p,receipt:null}
type Mutable<T>={-readonly [K in keyof T]:T[K]}
function fake():Mutable<FiscalApi>{return {info:vi.fn().mockResolvedValue({qa:true,canImport:true,message:'QA',repository:null}),begin:vi.fn().mockResolvedValue({...ready,phase:'selecting'}),get:vi.fn().mockResolvedValue(ready),cancel:vi.fn().mockResolvedValue({...ready,phase:'cancelled'}),refresh:vi.fn().mockResolvedValue({...ready,phase:'verifying'}),confirm:vi.fn().mockResolvedValue({...ready,phase:'committed',receipt:{operation_id:'operation',sequence:2,generation:2,installation_id:'installed',execution:'not-authorized-for-execution'}}),details:vi.fn().mockResolvedValue({items:[],next:null}),list:vi.fn().mockResolvedValue({generation:2,items:[],next:null}),operation:vi.fn().mockResolvedValue(null)}}
describe('5D.3b.2: frontera y gestión independiente',()=>{
it('envía solo DTOs estrechos y ningún archivo/reloj/estado de autorización',async()=>{const invoke=vi.fn().mockResolvedValue(ready);const api=createNativeFiscalApi(invoke);await api.begin('package');await api.confirm('session','nonce');expect(invoke.mock.calls).toEqual([['fiscal_import_begin',{request:{kind:'package'}}],['fiscal_import_confirm',{request:{sessionId:'session',previewNonce:'nonce'}}]])})
it('no instala al crear el controlador ni al consultar configuración',async()=>{const api=fake(),c=createFiscalPackageController(api);expect(api.begin).not.toHaveBeenCalled();await c.initialize();expect(api.confirm).not.toHaveBeenCalled();c.dispose()})
it('requiere preview nativa y conserva mismo token/nonce al confirmar',async()=>{const api=fake(),c=createFiscalPackageController(api);await c.begin('package');await c.confirm();expect(api.confirm).not.toHaveBeenCalled();await c.poll();await c.confirm();expect(api.confirm).toHaveBeenCalledWith('session','nonce');expect(c.getState().session?.phase).toBe('committed')})
it('doble clic no crea una segunda intención',async()=>{const api=fake();let done!:(s:ImportState)=>void;api.confirm=vi.fn(()=>new Promise<ImportState>(r=>{done=r}));const c=createFiscalPackageController(api);await c.begin('package');await c.poll();const first=c.confirm();await c.confirm();expect(api.confirm).toHaveBeenCalledTimes(1);done({...ready,phase:'committed'});await first})
it('descartar y callback tardío no reinstalan una preview vieja',async()=>{const api=fake();let resolve!:(s:ImportState)=>void;api.begin=vi.fn(()=>new Promise<ImportState>(r=>{resolve=r}));const c=createFiscalPackageController(api);const first=c.begin('package');c.leave();resolve(ready);await first;expect(api.cancel).toHaveBeenCalledWith('session');expect(c.getState().session).toBeNull()})
it('respuesta perdida conserva operationId y no repite instalación',async()=>{const api=fake();api.confirm=vi.fn().mockRejectedValue(new FiscalImportFailure('COMMIT_OUTCOME_UNKNOWN'));const c=createFiscalPackageController(api);await c.begin('package');await c.poll();await c.confirm();expect(c.getState().session?.phase).toBe('unknown');await c.reconcile();expect(api.operation).toHaveBeenCalledWith('operation');expect(api.begin).toHaveBeenCalledTimes(1)})
it('rechazo nativo no se convierte en aprobación editorial por React',async()=>{const api=fake();api.get=vi.fn().mockResolvedValue({...ready,summary:null,phase:'rejected',error:'INVALID_SIGNATURE'});const c=createFiscalPackageController(api);await c.begin('package');await c.poll();await c.confirm();expect(c.getState().error).toContain('Firma inválida');expect(api.confirm).not.toHaveBeenCalled()})
it('preview INLINE escapa metadatos y distingue instalación de uso',()=>{const model:Model={info:{qa:true,canImport:true,message:'QA',repository:null},session:ready,items:[],next:null,generation:1,details:null,detailSection:'sources',error:null,busy:false};const noop=()=>{};const html=renderToStaticMarkup(<FiscalPackageView model={model} actions={{begin:noop,confirm:noop,discard:noop,refresh:noop,details:noop,list:noop,reconcile:noop}}/>);expect(html).toContain('&lt;img');expect(html).not.toContain('<img src=x');expect(html).toContain('Instalar sin activar');expect(html).not.toContain('role="dialog"');expect(html).toContain('Inverso: no autorizado')})
it('producción no configurada deshabilita importación sin simular QA',()=>{const model:Model={info:{qa:false,canImport:false,message:'Sin bootstrap',repository:null},session:null,items:[],next:null,generation:null,details:null,detailSection:'sources',error:null,busy:false};const noop=()=>{};const html=renderToStaticMarkup(<FiscalPackageView model={model} actions={{begin:noop,confirm:noop,discard:noop,refresh:noop,details:noop,list:noop,reconcile:noop}}/>);expect(html).toContain('disabled');expect(html).toContain('Sin bootstrap');expect(html).not.toContain('Entorno QA')})
})

describe('R2: gestión y ejecución sujetas a autoridad nativa',()=>{
 const item:Installed={installationId:'installed',envelopeSha256:'c',payloadSha256:'b',contentSha256:'a',packageId:'test-only',version:'2026-test',exercise:2026,channel:'production',stream:'test',epoch:1,revision:1,from:'2026-01-01',through:'2026-12-31',operations:['direct'],execution:'not-authorized-for-execution'}
 const noop=()=>{}
 it('el aviso de ejecución conserva el canal observado sin confundir producción con QA',()=>{
  const props={execution:{stage:'running',executionId:'test',context:null,fingerprint:null,persistenceAllowed:false as const,channel:'production' as const},document:null,consent:false,save:noop,reconcile:noop}
  const production=renderToStaticMarkup(<ExternalExecutionNotice {...props}/>);expect(production).toContain('Fuente productiva autenticada');expect(production).not.toContain('Parámetros sintéticos QA')
  const qa=renderToStaticMarkup(<ExternalExecutionNotice {...props} execution={{...props.execution,channel:'qa'}}/>);expect(qa).toContain('Parámetros sintéticos QA')
 })
 it('host productivo con gestión disponible se distingue de QA y del host sin configurar',()=>{
  const model:Model={info:{qa:false,canImport:true,message:'Gestión productiva; ejecución bloqueada',repository:null},session:null,items:[],next:null,generation:null,details:null,detailSection:'sources',error:null,busy:false}
  const html=renderToStaticMarkup(<FiscalPackageView model={model} actions={{begin:noop,confirm:noop,discard:noop,refresh:noop,details:noop,list:noop,reconcile:noop}}/>)
  expect(html).toContain('Producción · autorización nativa');expect(html).not.toContain('Entorno QA');expect(html).not.toContain('Externos sin configurar');expect(html).not.toMatch(/<button[^>]*\sdisabled(?:=|\s|>)/)
  const activation=renderToStaticMarkup(<FiscalActivationSection items={[item]} active={false} enabled qa={false} revision={2}/>)
  expect(activation).toContain('Cada ejecución y guardado revalidan autoridad nativa');expect(activation).toContain('Solicitar selección');expect(activation).not.toContain('Parámetros sintéticos QA');expect(activation).not.toContain('QA sintético')
 })
 it('instalar desde el controlador de importación no solicita admisión ni selección',async()=>{
  const api=fake();api.info=vi.fn().mockResolvedValue({qa:false,canImport:true,message:'Gestión',repository:null});api.get=vi.fn().mockResolvedValue({...ready,summary:{...p,channel:'production'}})
  const c=createFiscalPackageController(api);await c.initialize();await c.begin('package');await c.poll();await c.confirm()
  expect(c.getState().info).toMatchObject({qa:false,canImport:true});expect(api.confirm).toHaveBeenCalledWith('session','nonce');expect(api.begin).toHaveBeenCalledTimes(1);expect(c.getState().session?.receipt?.execution).toBe('not-authorized-for-execution');c.dispose()
 })
 it('admisión y selección requieren revisiones y confirmaciones distintas',async()=>{
  let admitted=false,selected=false,intent:'admit'|'select'|'deactivate'='admit',counter=0
  const selection=()=>({id:selected?'selection':null,generation:selected?1:0,kind:selected?'external' as const:'embedded' as const,installationId:selected?item.installationId:null,admissionId:selected?'admission':null})
  const eligibility=()=>({installationId:item.installationId,eligible:true,reason:null,operations:['direct'],verifiedAt:p.verifiedAt,continuity:false,admissionRefs:admitted?[{admissionId:'admission',operationId:'admit-op',version:1}]:[],moreAdmissions:false})
  const state=():ActivationState=>({sessionId:`review-${counter}`,operationId:`operation-${counter}`,phase:'ready',error:null,previewNonce:`nonce-${counter}`,receipt:null,summary:{intent,repositoryGeneration:2,previous:selection(),eligibility:eligibility(),admissionId:intent==='admit'?'admission':admitted?'admission':null,selectionId:intent==='select'?'selection':null}})
  const api:FiscalActivationApi={info:vi.fn(),selection:vi.fn(async()=>({repositoryGeneration:2,selection:selection(),eligibility:selected?eligibility():null})),eligibility:vi.fn(async()=>eligibility()),prepare:vi.fn(async(next)=>{intent=next;counter++;return state()}),deactivate:vi.fn(),get:vi.fn(),confirm:vi.fn(async()=>{const s=state();if(intent==='admit')admitted=true;if(intent==='select')selected=true;return {...s,phase:'committed'}}),cancel:vi.fn(),operation:vi.fn()}
  const c=createFiscalActivationController(api);await c.refresh([item]);await c.prepare('admit',item);expect(api.confirm).not.toHaveBeenCalled();await c.confirm();expect(selected).toBe(false);expect(api.prepare).toHaveBeenCalledTimes(1)
  await c.refresh([item]);await c.prepare('select',item);expect(api.prepare).toHaveBeenLastCalledWith('select','installed','admission');expect(selected).toBe(false);await c.confirm();expect(selected).toBe(true);c.dispose()
 })
 it('STALE_GENERATION requiere verificar de nuevo y confirmar con el nonce renovado',async()=>{
  const api=fake();api.confirm=vi.fn().mockResolvedValueOnce({...ready,phase:'stale',error:'STALE_GENERATION'}).mockResolvedValue({...ready,phase:'committed'});const c=createFiscalPackageController(api)
  await c.begin('package');await c.poll();await c.confirm();await c.confirm();expect(api.confirm).toHaveBeenCalledTimes(1)
  api.get=vi.fn().mockResolvedValue({...ready,previewNonce:'fresh-nonce'});await c.refresh();await c.poll();await c.confirm();expect(api.confirm).toHaveBeenLastCalledWith('session','fresh-nonce');c.dispose()
 })
 it('selección productiva usa elegibilidad nativa y conserva bloqueos sin fallback',async()=>{
  const selected={id:'selection',generation:1,kind:'external',installationId:'installed',admissionId:'admission'}
  const invoke=vi.fn().mockResolvedValueOnce({qa:false,canImport:true}).mockResolvedValueOnce({selection:selected,eligibility:{eligible:true,reason:null}})
  expect(await createFiscalExecutionApi(invoke).source()).toEqual(selected)
  for(const code of ['KEY_REVOKED','TRUST_EXPIRED_OR_NOT_YET_VALID','OPERATION_NOT_ADMITTED']){
   const denied=vi.fn().mockResolvedValueOnce({qa:false,canImport:true}).mockResolvedValueOnce({selection:selected,eligibility:{eligible:false,reason:code}})
   await expect(createFiscalExecutionApi(denied).source()).rejects.toMatchObject({code});expect(denied.mock.calls.map(c=>c[0])).toEqual(['fiscal_import_info','fiscal_selection_get'])
  }
  const missing=vi.fn().mockResolvedValueOnce({qa:false,canImport:true}).mockResolvedValueOnce({selection:selected});await expect(createFiscalExecutionApi(missing).source()).rejects.toMatchObject({code:'EXTERNAL_SOURCE_NOT_AUTHORIZED'})
 })
 it('sin aprovisionar conserva integrado; QA conserva su selección nativa',async()=>{
  const ordinary=vi.fn().mockResolvedValue({qa:false,canImport:false});expect((await createFiscalExecutionApi(ordinary).source()).kind).toBe('embedded');expect(ordinary).toHaveBeenCalledTimes(1)
  const selected={id:'qa',generation:1,kind:'external',installationId:'qa-package',admissionId:'qa-admission'}
  const qa=vi.fn().mockResolvedValueOnce({qa:true,canImport:true}).mockResolvedValueOnce({selection:selected});expect(await createFiscalExecutionApi(qa).source()).toEqual(selected)
 })
})
