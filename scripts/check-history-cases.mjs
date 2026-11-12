import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { join } from "node:path"

const nav=(page,name)=>page.getByRole("navigation",{name:"Navegación principal"}).getByRole("button",{name,exact:true})
async function history(page){await nav(page,"Historial").click();await page.locator("#history-title").waitFor({state:"visible"});await page.waitForFunction(()=>!window.__historyVerification.history.getState().listLoading)}
async function calculator(page){await nav(page,"Calcular").click();await page.locator("#calculator-workspace").waitFor({state:"visible"})}
async function consent(page,value){await history(page);const input=page.locator(".history-consent input");if(await input.isChecked()!==value)await input.click();await page.waitForFunction(v=>{const s=window.__historyVerification.history.getState();return !s.preferenceBusy&&s.autoSave===v},value);assert.equal(await input.isChecked(),value)}
async function fill(page,{amount="15000.00",direction="gross-to-net",period="monthly",imss=true}={}){await calculator(page);const edit=page.getByRole("button",{name:"Editar datos",exact:true});if(await edit.isVisible())await edit.click();await page.getByRole("button",{name:direction==="gross-to-net"?/Bruto a neto/:/Neto a bruto/}).click();await page.locator("#salary").fill(amount);await page.locator("#period").selectOption(period);await page.locator(imss?"#include-imss":"#exclude-imss").check();await page.locator('input[name="fiscal-date-mode"][value="yes"]').check();await page.locator("input#effective-date").fill("2026-02-01")}
async function calculate(page){await page.locator("#salary").press("Enter");await page.locator("#calculator-workspace .results-section").waitFor();await page.waitForFunction(()=>document.querySelector("#calculator-workspace .results-section")?.getAttribute("aria-busy")==="false")}
async function saved(page){await page.waitForFunction(()=>{const h=window.__historyVerification;return h.history.getState().notices[h.fiscal.getState().requestId]?.status==="saved"})}
async function rows(page){return page.evaluate(async()=>(await window.__historyVerification.api.list(100)).items)}
async function fresh(page,base,scenario){await page.goto(`${base}dev/history.html${scenario?`?case=${scenario}`:""}`,{waitUntil:"networkidle"});await page.waitForFunction(()=>window.__historyVerification?.history?.getState().preferenceStatus==="ready")}
async function clearUi(page){await history(page);if(await page.locator(".history-entry").count()){await page.getByRole("button",{name:"Borrar todo",exact:true}).click();assert.equal(await page.getByRole("alertdialog").isVisible(),true);await page.getByRole("button",{name:"Sí, borrar historial",exact:true}).click();await page.waitForFunction(()=>window.__historyVerification.history.getState().items.length===0&&!window.__historyVerification.history.getState().mutationBusy)}}
async function measure(page,report,name){const m=await page.evaluate(name=>({name,viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,scrollHeight:document.documentElement.scrollHeight,clientHeight:document.documentElement.clientHeight,scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth}),name);assert(m.scrollWidth<=m.clientWidth,name);report.metrics.push(m);return m}
async function holdTransport(page,phase="before"){
  await page.evaluate(phase=>{
    const original=window.fetch;let release;const gate=new Promise(r=>{release=r});window.__releaseHistoryWrite=()=>{release();window.fetch=original};window.__historyWriteHeld=false
    window.fetch=async function(input,options){if(String(input).includes("/storage_insert_automatic")){window.__historyWriteHeld=true;if(phase==="before")await gate;const response=await original.call(this,input,options);if(phase==="after")await gate;return response}return original.call(this,input,options)}
  },phase)
}
async function releaseTransport(page){await page.evaluate(()=>window.__releaseHistoryWrite())}
function modifyDb(root,action){
  const code=`import sqlite3,sys,json,hashlib\nc=sqlite3.connect(sys.argv[1])\na=sys.argv[2]\nif a=='fail': c.execute("CREATE TRIGGER history_qa_failure BEFORE INSERT ON simulations BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END")\nif a=='repair': c.execute('DROP TRIGGER history_qa_failure')\nif a=='corrupt':\n row=c.execute('SELECT execution_id,payload FROM simulations ORDER BY completed_at DESC LIMIT 1').fetchone()\n v=json.loads(row[1]);v['value']['outcome']['presentation']['warnings']=[]\n p=json.dumps(v,ensure_ascii=False,separators=(',',':'),sort_keys=True)\n c.execute('UPDATE simulations SET payload=?,payload_sha256=? WHERE execution_id=?',(p,hashlib.sha256(p.encode()).hexdigest(),row[0]))\nc.commit();c.close()`
  execFileSync("python",["-c",code,join(root,"payroll.sqlite3"),action],{stdio:"pipe"})
}

export async function checkHistoryCases({page,base,isNative,isolatedRoot,native,screenshot,report}){
  const external=[];const observe=r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(base)&&!r.url().startsWith("http://ipc.localhost/"))external.push(r.url())};page.context().on("request",observe)
  await history(page)
  assert.equal(await page.locator(".history-consent input").isChecked(),false);assert((await page.locator(".history-empty").innerText()).includes("Todavía no tienes cálculos guardados."));assert((await page.locator("#history-privacy").innerText()).includes("no está cifrada"))
  await page.evaluate(()=>scrollTo(0,0));await screenshot("history-empty")
  await fill(page,{amount:"15000.50",imss:false})
  for(const[id,value]of[["bonus-days","18.50"],["vacation-days","20.25"],["vacation-premium","30.50"],["effective-date","2026-01-31"]])await page.locator(`#${id}`).fill(value)
  await page.locator("#salary").focus();await page.keyboard.press("End");await page.keyboard.type("0");await page.keyboard.press("Home");await page.keyboard.press("ArrowRight");await page.keyboard.press("Shift+ArrowRight")
  await page.evaluate(()=>{const e=document.querySelector("#salary");window.__historyCaptureNode=e;window.__historyCaptureSelection=[e.selectionStart,e.selectionEnd];window.__historyFiscalBefore=JSON.stringify(window.__historyVerification.fiscal.getState());window.__historyCallsBefore=window.__historyVerification.calls})
  await history(page);await nav(page,"Parámetros").click();await nav(page,"Ayuda").click();await calculator(page)
  assert.equal(await page.evaluate(()=>{const e=document.querySelector("#salary");return e===window.__historyCaptureNode&&JSON.stringify([e.selectionStart,e.selectionEnd])===JSON.stringify(window.__historyCaptureSelection)&&JSON.stringify(window.__historyVerification.fiscal.getState())===window.__historyFiscalBefore&&window.__historyVerification.calls===window.__historyCallsBefore}),true)
  await page.locator("#salary").focus();await page.keyboard.press("Control+Z");assert.equal(await page.locator("#salary").inputValue(),"15,000.50");await history(page);await calculator(page);await page.locator("#salary").focus();await page.keyboard.press("Control+Y");assert.equal(await page.locator("#salary").inputValue(),"15,000.500")
  for(const[id,value]of[["bonus-days","18.50"],["vacation-days","20.25"],["vacation-premium","30.50"],["effective-date","2026-01-31"]])assert.equal(await page.locator(`#${id}`).inputValue(),value)
  assert.equal(await page.locator("#exclude-imss").isChecked(),true)
  await page.locator("#salary").press("Enter");const invalid=await page.locator("#salary-error").innerText();await history(page);await calculator(page);assert.equal(await page.locator("#salary-error").innerText(),invalid)
  for(const[id,value]of[["bonus-days","15"],["vacation-days","12"],["vacation-premium","25"]])await page.locator(`#${id}`).fill(value)
  report.checks.push("Cuatro secciones conservan captura, nodo/selección, undo/redo, prestaciones, IMSS, fecha y error de validación sin ejecutar motores")
  await fill(page);await calculate(page);assert.equal((await rows(page)).length,0)
  report.checks.push("Historial vacío agradable; consentimiento inicial desactivado y cálculo no guardado")
  await consent(page,true)
  const cases=[{amount:"15000.00",direction:"gross-to-net",period:"monthly",imss:true,expected:"$ 13,202.64"},{amount:"15000.00",direction:"gross-to-net",period:"monthly",imss:false,expected:"$ 13,597.18"},{amount:"3500.00",direction:"gross-to-net",period:"weekly",imss:true,expected:"$ 3,076.67"},{amount:"13202.64",direction:"net-to-gross",period:"monthly",imss:true,expected:"$ 15,000.00"}]
  for(const c of cases){await fresh(page,base);await consent(page,true);await fill(page,c);await calculate(page);await saved(page);assert.equal(await page.locator("#calculator-workspace .primary-amount").innerText(),c.expected);const before=await page.evaluate(()=>JSON.stringify(window.__historyVerification.fiscal.getState()));const count=(await rows(page)).length;await history(page);await calculator(page);assert.equal(await page.evaluate(()=>JSON.stringify(window.__historyVerification.fiscal.getState())),before);assert.equal((await rows(page)).length,count);report.metrics.push({regression:c.expected,obtained:await page.locator("#calculator-workspace .primary-amount").innerText()})}
  report.checks.push("Consentimiento explícito: cuatro regresiones se guardan sin diferencias ni duplicación por navegación/StrictMode")
  await history(page);await measure(page,report,"listado 1180");await screenshot("history-list-1180")
  const list=await rows(page),selected=list[0];await page.locator(`[data-history-id="${selected.executionId}"]`).focus();await page.keyboard.press("Enter");await page.locator(".history-detail").waitFor()
  const root=page.locator(".historical-results-host")
  await root.locator(".primary-amount").waitFor();assert.equal(await root.locator(".primary-amount").innerText(),"$ 15,000.00")
  assert((await page.locator(".history-original-facts").innerText()).includes("01/02/2026 · Manual"))
  assert.equal(await root.getByRole("button",{name:"Exportar PDF",exact:true}).isDisabled(),true)
  assert.equal(await page.evaluate(()=>document.querySelectorAll("#results-title").length),1,"IDs del resultado original aislados de la calculadora montada")
  await root.locator(".fiscal-insights > summary").focus();await page.keyboard.press("Enter")
  await root.locator(".technical-result-details > summary").focus();await page.keyboard.press("Space")
  assert((await root.locator(".technical-result-body").innerText()).includes("mx-fiscal-2026-source-v3"))
  await root.locator(".fiscal-insights > summary").focus();await page.keyboard.press("Space")
  await page.evaluate(()=>scrollTo(0,0));await measure(page,report,"detalle 1180");await screenshot("history-detail-1180")
  const snapshot=await page.evaluate(()=>JSON.stringify(window.__historyVerification.history.getSelectedOriginalForExport()))
  await calculator(page);assert.equal(await page.locator("#calculator-workspace .primary-amount").innerText(),"$ 15,000.00");await history(page);assert.equal(await page.evaluate(()=>JSON.stringify(window.__historyVerification.history.getSelectedOriginalForExport())),snapshot)
  report.checks.push("Detalle por ID usa reporte original, fecha/versión, componentes aprobados y teclado; sin recalcular y con IDs ARIA aislados")

  for(const c of [{scenario:"approximate",amount:"5557.04",period:"fortnightly",label:"Aproximado",value:"$ 6,216.15"},{scenario:"limited",amount:"13202.64",period:"monthly",label:"Limitado",value:"$ 15,000.00"}]){
    await fresh(page,base,c.scenario);await consent(page,true);await fill(page,{amount:c.amount,direction:"net-to-gross",period:c.period});await calculate(page);await saved(page);await history(page);const items=await rows(page),item=items[0];assert(item.classification===c.scenario.replace("approximate","approximate")||item.classification==="limited");await page.locator(`[data-history-id="${item.executionId}"]`).click();await page.locator(".historical-results-host .primary-amount").waitFor();assert.equal(await page.locator(".historical-results-host .primary-amount").innerText(),c.value);assert.equal(await page.locator(".historical-results-host .result-check .lucide-check").count(),0);if(c.scenario==="approximate")assert.equal(await page.locator('.historical-results-host [data-inverse="difference"]').innerText(),"−$ 0.01")
  }
  report.checks.push("Aproximados y limitados históricos conservan diferencias y advertencias, sin distintivos de éxito contradictorios")

  await fresh(page,base);await consent(page,true);const beforeInvalid=(await rows(page)).length
  await fill(page,{amount:"9451.19"});await calculate(page);await history(page);assert.equal((await rows(page)).length,beforeInvalid)
  await fill(page,{amount:"9451.20"});await calculate(page);await history(page);assert.equal((await rows(page)).length,beforeInvalid)
  await calculator(page);await page.locator("#minimum-month-ack").check();await nav(page,"Parámetros").click();await nav(page,"Ayuda").click();await history(page);await calculator(page);assert.equal(await page.locator("#minimum-month-ack").isChecked(),true)
  await page.getByRole("button",{name:"Recalcular con hipótesis",exact:true}).click();await saved(page);await history(page);assert.equal((await rows(page)).length,beforeInvalid+1);assert.equal((await rows(page))[0].classification,"conditioned")
  report.checks.push("Bloqueados/confirmación pendiente no se guardan; confirmación válida se conserva y el nuevo resultado queda condicionado")

  await fresh(page,base,"deferred");await consent(page,true);const beforePending=(await rows(page)).length;await fill(page,{amount:"13202.64",direction:"net-to-gross"});await page.locator("#salary").press("Enter");await page.getByRole("button",{name:"Cancelar",exact:true}).waitFor();await history(page);assert.equal(await page.evaluate(()=>window.__historyVerification.pending[0].aborted),false);await page.evaluate(()=>window.__historyVerification.resolve(0));await page.waitForFunction(()=>window.__historyVerification.history.getState().notices[window.__historyVerification.fiscal.getState().requestId]?.status==="saved");assert.equal(await page.locator("#history-workspace").isVisible(),true);assert.equal((await rows(page)).length,beforePending+1)
  await calculator(page);assert.equal(await page.locator("#calculator-workspace .primary-amount").innerText(),"$ 15,000.00")
  await fresh(page,base,"deferred");await consent(page,true);const count=(await rows(page)).length;await fill(page,{amount:"13202.64",direction:"net-to-gross"});await page.locator("#salary").press("Enter");await page.getByRole("button",{name:"Cancelar",exact:true}).click();await history(page);await page.evaluate(()=>window.__historyVerification.resolve(0));assert.equal((await rows(page)).length,count)
  report.checks.push("Inverso termina con Historial abierto y se guarda una vez; cancelación/respuesta obsoleta no crea un registro")

  await fresh(page,base);await consent(page,true);await clearUi(page)
  if(isNative){await holdTransport(page,"before")}else{await page.evaluate(()=>{window.__releaseFakeWrite=window.__historyVerification.holdWrites()})}
  await fill(page);await calculate(page);await page.waitForFunction(()=>window.__historyVerification.history.getState().notices[window.__historyVerification.fiscal.getState().requestId]?.status==="saving")
  await consent(page,false)
  if(isNative)await releaseTransport(page);else await page.evaluate(()=>window.__releaseFakeWrite())
  await page.waitForFunction(()=>window.__historyVerification.history.getState().notices[window.__historyVerification.fiscal.getState().requestId]?.status==="not-saved")
  assert.equal((await rows(page)).length,0);await consent(page,true);assert.equal((await rows(page)).length,0)
   report.checks.push(`Desactivar mientras un envío espera transporte confirma corte ${isNative?"SQLite nativo":"controlado en memoria"}; liberar el envío no guarda ni reactivar lo resucita`)

  await fill(page);await calculate(page);await saved(page);await history(page)
  await page.getByRole("button",{name:"Borrar todo",exact:true}).click();await page.getByRole("button",{name:"Cancelar borrado",exact:true}).press("Enter");assert.equal((await rows(page)).length,1)
  if(isNative)await holdTransport(page,"before");else await page.evaluate(()=>{window.__releaseFakeWrite=window.__historyVerification.holdWrites()})
  await fill(page,{amount:"16000.00"});await calculate(page);await page.waitForFunction(()=>window.__historyVerification.history.getState().notices[window.__historyVerification.fiscal.getState().requestId]?.status==="saving");await clearUi(page)
  if(isNative)await releaseTransport(page);else await page.evaluate(()=>window.__releaseFakeWrite())
  await page.waitForFunction(()=>window.__historyVerification.history.getState().notices[window.__historyVerification.fiscal.getState().requestId]?.status!=="saving");assert.equal((await rows(page)).length,0)
  report.checks.push("Borrado completo pide confirmación; cancelarlo conserva datos y confirmarlo cerca escrituras pendientes sin repoblar lista")

  if(isNative){
    await holdTransport(page,"after");await fill(page);await calculate(page)
    await page.waitForFunction(async()=>(await window.__historyVerification.api.list(100)).items.length===1)
    await consent(page,false);await releaseTransport(page);await saved(page)
    assert.equal((await rows(page)).length,1);await consent(page,true);await clearUi(page)
    await holdTransport(page,"after");await fill(page);await calculate(page)
    await page.waitForFunction(async()=>(await window.__historyVerification.api.list(100)).items.length===1)
    await history(page);await page.locator(".history-entry").first().click();await page.locator(".history-detail").waitFor()
    await page.getByRole("button",{name:"Eliminar registro",exact:true}).click();await page.waitForFunction(()=>!window.__historyVerification.history.getState().mutationBusy)
    await releaseTransport(page);await page.waitForFunction(()=>window.__historyVerification.history.getState().notices[window.__historyVerification.fiscal.getState().requestId]?.status==="not-saved")
    assert.equal((await rows(page)).length,0)
    report.checks.push("Commit anterior a desactivar se conserva; eliminar antes de recibir su respuesta tardía no restaura registro ni aviso Guardado")
  }

  await fill(page);await calculate(page);await saved(page);await history(page);const toDelete=(await rows(page))[0];await page.locator(`[data-history-id="${toDelete.executionId}"]`).click();await page.locator(".history-detail").waitFor();await page.getByRole("button",{name:"Eliminar registro",exact:true}).click();await page.waitForFunction(()=>!window.__historyVerification.history.getState().mutationBusy);assert.equal((await rows(page)).length,0)
  await page.evaluate(()=>window.__historyVerification.seed(25));await history(page);await page.waitForFunction(()=>window.__historyVerification.history.getState().items.length===20);await page.getByRole("button",{name:"Ver más cálculos",exact:true}).click();await page.waitForFunction(()=>window.__historyVerification.history.getState().items.length===25)
  assert.equal(await page.locator(".history-entry").count(),25);assert.equal(await page.locator(".history-list table").count(),0)
  if(isNative)native("resize",["-Width","900","-Height","600"]);else await page.setViewportSize({width:900,height:600})
  await page.waitForFunction(()=>innerWidth===900);await page.evaluate(()=>scrollTo(0,0));await measure(page,report,"lista 900");await screenshot("history-list-900")
  await page.locator(".history-entry").first().click();await page.locator(".historical-results-host .primary-amount").waitFor();await measure(page,report,"detalle 900");await screenshot("history-detail-900")
  if(isNative)native("resize",["-Width","1180","-Height","760"]);else await page.setViewportSize({width:1180,height:760})
  report.checks.push("Eliminar individual, orden y paginación de 25 registros; lista y detalle utilizables en 1180×760/900×600 sin horizontal")

  await fresh(page,base);await consent(page,true);await clearUi(page);await fill(page);await calculate(page);await saved(page)
  if(isNative){modifyDb(isolatedRoot,"corrupt");await history(page);await page.locator(".history-entry").first().click();await page.locator(".history-detail-actions").waitFor();await page.waitForFunction(()=>Boolean(window.__historyVerification.history.getState().detailError));assert.equal(await page.locator(".historical-results-host").count(),0);assert.equal((await rows(page)).length,1)}
  else{await page.evaluate(()=>window.__historyVerification.corruptView());await history(page);await page.locator(".history-entry").first().click();await page.waitForFunction(()=>Boolean(window.__historyVerification.history.getState().detailError))}
  assert((await page.locator("#history-workspace [role=alert]").innerText()).includes("fielmente"))
  report.checks.push("Snapshot con presentación incompatible muestra error específico, conserva registro y no inventa/recalcula importes")
  await clearUi(page)
  if(isNative){modifyDb(isolatedRoot,"fail");await fill(page);await calculate(page);await page.waitForFunction(()=>window.__historyVerification.history.getState().notices[window.__historyVerification.fiscal.getState().requestId]?.status==="error");assert.equal(await page.locator("#calculator-workspace .primary-amount").innerText(),"$ 13,202.64");assert.equal(await page.locator(".history-save-error[role=alert]").isVisible(),true);modifyDb(isolatedRoot,"repair");report.checks.push("Fallo SQLite real de escritura es visible y no cambia el resultado fiscal correcto")}
  await fill(page);await calculate(page);await saved(page);const final=(await rows(page))[0]
  assert.deepEqual(external,[]);report.externalRequests=external;page.context().off("request",observe)
  return final
}
export async function checkHistoryRestart({page,original,report}){
  await history(page);assert.equal(await page.locator(".history-consent input").isChecked(),true)
  const records=await rows(page);assert(records.some(r=>r.executionId===original.executionId));await page.locator(`[data-history-id="${original.executionId}"]`).click();await page.locator(".historical-results-host .primary-amount").waitFor();assert.equal(await page.locator(".historical-results-host .primary-amount").innerText(),"$ 13,202.64")
  const count=records.length;await fill(page,{amount:"3500.00",period:"weekly"});await calculate(page);await saved(page);assert.equal((await rows(page)).length,count+1)
  await consent(page,false);await fill(page);await calculate(page);assert.equal((await rows(page)).length,count+1)
  report.checks.push("Reinicio real de la aplicación en Windows conserva consentimiento y detalle; nuevas simulaciones se guardan y desactivar conserva datos sin nuevas escrituras")
}
