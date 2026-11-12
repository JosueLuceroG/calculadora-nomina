import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { createHash,randomUUID } from "node:crypto"
import { existsSync,mkdirSync,readFileSync,writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { execFileSync,spawn } from "node:child_process"
const root=fileURLToPath(new URL("../",import.meta.url)),out=join(root,"docs/evidence/5d2b"),tools=process.env.PLAYWRIGHT_TOOLS_PATH??join(tmpdir(),"opencode/calculadora-nomina-verification")
const {chromium}=createRequire(join(tools,"package.json"))("playwright"),exe=join(root,"src-tauri/target/debug/calculadora-nomina.exe")
const storage=join(tmpdir(),"opencode",`5b7-5d2b-${randomUUID()}`),pdfRoot=join(tmpdir(),"opencode",`5b11-5d2b-${randomUUID()}`),originals=JSON.parse(readFileSync(join(out,"originals-v1.json"),"utf8"))
mkdirSync(pdfRoot,{recursive:true});mkdirSync(join(out,"native-pdf"),{recursive:true})
const report={mode:"native-integrated-offline",binarySha256:createHash("sha256").update(readFileSync(exe)).digest("hex"),storageRoot:storage,pdfRoot,checks:[],pdf:[],errors:[],external:[],failures:[]},sessions=[]
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),db=(action,path=storage)=>JSON.parse(execFileSync("python",[join(root,"scripts/5d2b-qa-database.py"),action,path],{encoding:"utf8"}))
function native(s,action,args=[]){return execFileSync("pwsh",["-NoProfile","-File",join(root,"scripts/native-window.ps1"),"-Action",action,"-ProcessId",String(s.app.pid),...args],{encoding:"utf8",timeout:30000})}
async function launch(path=storage,port=9225){
  try{await fetch(`http://127.0.0.1:${port}/json/version`);throw new Error(`Occupied port ${port}`)}catch(e){if(e.message.startsWith("Occupied"))throw e}
  const s={app:spawn(exe,[],{cwd:root,env:{...process.env,NOMINA_STORAGE_TEST_ROOT:path,NOMINA_PDF_PROBE_DIRECTORY:pdfRoot,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`,WEBVIEW2_USER_DATA_FOLDER:join(tools,`3b4-profile-5d2b-${randomUUID()}`)},stdio:"ignore"}),browser:null,page:null};sessions.push(s)
  for(let i=0;i<150;i++){try{s.browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);break}catch{await delay(100)}}assert(s.browser)
  for(let i=0;i<100;i++){s.page=s.browser.contexts().flatMap(c=>c.pages()).find(p=>p.url()==="http://tauri.localhost/");if(s.page)break;await delay(100)}assert(s.page)
  await s.page.emulateMedia({colorScheme:null});s.page.on("pageerror",e=>report.errors.push(e.message));s.page.on("console",e=>{if(e.type()==="error")report.errors.push(e.text())});s.page.on("request",r=>{if(/^https?:/.test(r.url())&&!/^http:\/\/(tauri|ipc)\.localhost\//.test(r.url()))report.external.push(r.url())})
  await s.page.context().setOffline(true);await s.page.reload({waitUntil:"networkidle"});await s.page.waitForFunction(()=>document.querySelector("#salary"));return s
}
async function close(s){native(s,"close");for(let i=0;i<300&&s.app.exitCode===null;i++){await delay(50);if(i===149){try{native(s,"close")}catch{/* window may already be closing */}}}assert.notEqual(s.app.exitCode,null,"Own native process did not finish graceful close");await s.browser.close().catch(()=>{});s.browser=null}
const invoke=(s,command,args={})=>s.page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args})
async function expectNativeError(s,command,args,expected){const code=await s.page.evaluate(async({command,args})=>{try{await window.__TAURI_INTERNALS__.invoke(command,args);return null}catch(error){return error?.code??String(error)}},{command,args});assert.equal(code,expected)}
const nav=(s,name)=>s.page.getByRole("navigation",{name:"Navegación principal"}).getByRole("button",{name,exact:true})
async function fill(s,{amount="15000.00",mode="gross-to-net",date="2026-02-01",bonus="15"}={}){const p=s.page;await nav(s,"Calcular").click();await p.getByRole("button",{name:"Limpiar",exact:true}).click();await p.getByRole("button",{name:mode==="gross-to-net"?/Bruto a neto/:/Neto a bruto/}).click();await p.locator("#salary").fill(amount);await p.locator("#period").selectOption("monthly");await p.locator("#bonus-days").fill(bonus);await p.locator("#include-imss").check();await p.locator("input[name=fiscal-date-mode][value=yes]").check();await p.locator("#effective-date").fill(date)}
async function calculate(s){await s.page.locator("#salary").press("Enter");await s.page.waitForFunction(()=>document.querySelector("#calculator-workspace .results-section")?.getAttribute("aria-busy")==="false")}
async function open(s,id){await nav(s,"Historial").click();const back=s.page.getByRole("button",{name:"Volver al listado",exact:true});if(await back.isVisible())await back.click();await s.page.locator(`[data-history-id="${id}"]`).click();await s.page.locator(".history-detail").waitFor()}
async function pdf(s,id,source,snapshot){const p=s.page,button=source==="history"?p.locator(".history-export-actions").getByRole("button",{name:"Exportar PDF",exact:true}):p.locator("#calculator-workspace").getByRole("button",{name:"Exportar PDF",exact:true});await button.click();let found=false;for(let i=0;i<60;i++){const dialog=JSON.parse(execFileSync("pwsh",["-NoProfile","-File",join(root,"scripts/native-pdf-dialog.ps1"),"-ProcessId",String(s.app.pid),"-Action","inspect"],{encoding:"utf8"}));if(dialog.windows.length){found=true;break}await delay(100)}assert(found,"Expected own PDF dialog");const path=join(pdfRoot,`${id}.pdf`);execFileSync("pwsh",["-NoProfile","-File",join(root,"scripts/native-pdf-dialog.ps1"),"-ProcessId",String(s.app.pid),"-Action","save","-FilePath",path],{encoding:"utf8"});await p.waitForFunction(path=>document.querySelector(".pdf-export-notice p")?.textContent.includes(path),path);const bytes=readFileSync(path),target=join(out,"native-pdf",`${id}.pdf`);writeFileSync(target,bytes);report.pdf.push({id,path:target,sha256:createHash("sha256").update(bytes).digest("hex"),snapshotVersion:snapshot.schemaVersion,engine:snapshot.versions.engine,uris:[...new Map(snapshot.outcome.report.provenance.sources.map(r=>[r.url+"|"+r.document,r.url])).values()]});const dismiss=p.getByRole("button",{name:"Cerrar aviso de exportación PDF",exact:true});if(await dismiss.isVisible())await dismiss.click()}
try{
  assert.equal(execFileSync("pwsh",["-NoProfile","-Command","@(Get-Process -Name 'calculadora-nomina' -ErrorAction SilentlyContinue).Count"],{encoding:"utf8"}).trim(),"0")
  report.before=db("seed");let s=await launch();const after=db("inspect");report.afterMigration=after
  assert.equal(after.schema,3);assert.deepEqual(after.records,report.before.records);assert.deepEqual(after.preferences,report.before.preferences);assert.equal(after.generation,report.before.generation);assert.deepEqual(after.tombstones,report.before.tombstones);assert(!after.temporaryBackupsExist)
  for(const item of originals){const snap=JSON.parse(item.payload).value;assert.equal(await invoke(s,"storage_get",{executionId:snap.executionId}),item.payload)}
  report.checks.push("Real QA schema2 copy migrated to3; seven v1 originals of both policies, UUID/checksum/preferences/generation/tombstones unchanged; temporary backup removed after independent reopen")
  const legacy=originals.find(f=>f.name==="direct-conditioned"),old=JSON.parse(legacy.payload).value;await open(s,old.executionId);await pdf(s,"legacy-v1","history",old)
  const contextual=originals.find(f=>f.name.startsWith("contextual-schema1")),prior=JSON.parse(contextual.payload).value;await open(s,prior.executionId);await pdf(s,"contextual-schema1","history",prior)
  assert.equal(await invoke(s,"storage_get",{executionId:old.executionId}),legacy.payload);assert.equal(await invoke(s,"storage_get",{executionId:prior.executionId}),contextual.payload)
  await nav(s,"Calcular").click();await nav(s,"Historial").click();if(await s.page.getByRole("button",{name:"Volver al listado",exact:true}).isVisible())await s.page.getByRole("button",{name:"Volver al listado",exact:true}).click()
  const toggle=s.page.locator(".history-consent input");if(await toggle.isChecked())await toggle.click();await s.page.waitForFunction(async()=>!(await window.__TAURI_INTERNALS__.invoke("storage_get_preferences")).historyAutoSave)
  await s.page.waitForFunction(()=>{const cb=document.querySelector('.history-consent input');return cb&&!cb.checked&&!cb.disabled})
  await fill(s);await calculate(s);assert.equal((await invoke(s,"storage_list",{limit:100,cursor:null})).items.length,originals.length)
  const fixture=JSON.parse(readFileSync(join(out,"originals-v2.json"),"utf8"))[0].payload,generation=(await invoke(s,"storage_begin_write")).generation
  await expectNativeError(s,"storage_insert",{generation,payload:fixture},"AUTO_SAVE_DISABLED")
  await nav(s,"Historial").click();if(!await toggle.isChecked())await toggle.click();await s.page.waitForFunction(async()=>(await window.__TAURI_INTERNALS__.invoke("storage_get_preferences")).historyAutoSave)
  await s.page.waitForFunction(()=>{const cb=document.querySelector('.history-consent input');return cb&&cb.checked&&!cb.disabled})
  await fill(s);await calculate(s);await s.page.locator(".history-save-saved").waitFor();assert.equal(await s.page.locator("#calculator-workspace .primary-amount").innerText(),"$ 13,202.64")
  const rows=(await invoke(s,"storage_list",{limit:100,cursor:null})).items,newRow=rows.find(r=>!originals.some(f=>JSON.parse(f.payload).value.executionId===r.executionId));assert(newRow)
  const raw=await invoke(s,"storage_get",{executionId:newRow.executionId}),fresh=JSON.parse(raw).value;assert.equal(fresh.schemaVersion,2);assert.equal(fresh.fiscalPackage.containerIdentity,null);assert.equal(fresh.executionProvenance.effectiveParameterSets.length,7)
  await pdf(s,"current-v2","current",fresh);await open(s,newRow.executionId);await pdf(s,"history-v2","history",fresh);assert.equal(await invoke(s,"storage_get",{executionId:newRow.executionId}),raw)
  await s.page.locator('.history-original-versions > summary').click();native(s,"capture",["-OutputPath",join(out,"native-v2-history.png")]);await close(s);s=await launch();assert.equal(await invoke(s,"storage_get",{executionId:newRow.executionId}),raw)
  report.checks.push("v1 legacy/contextual detail and PDFs preserved; opt-out blocks both native insertion paths; opt-in creates v2 with real provenance; current/history PDF and byte-exact restart")
  await fill(s,{amount:"9451.20",mode:"net-to-gross"});await calculate(s);assert.equal(await s.page.locator("#calculator-workspace .primary-amount").innerText(),"$ 9,877.38");await pdf(s,"inverse-current-v2","current",fresh)
  await fill(s,{date:"2027-01-01"});assert(await s.page.locator("button[type=submit]").isDisabled());report.checks.push("Inverse productive pending-region result and2027 blocking preserved")
  const second=await launch(storage,9226);assert((await invoke(second,"storage_list",{limit:100,cursor:null})).items.length>=originals.length)
  await open(s,old.executionId);await s.page.getByRole("button",{name:"Eliminar registro",exact:true}).click();await s.page.locator('.history-detail').waitFor({state:"hidden"});assert.equal(await invoke(second,"storage_get",{executionId:old.executionId}),null)
  const stale=(await invoke(second,"storage_begin_write")).generation
  await s.page.getByRole("button",{name:"Borrar todo",exact:true}).click();await s.page.getByRole("button",{name:"Sí, borrar historial",exact:true}).click();await s.page.waitForFunction(()=>document.querySelector(".history-empty"))
  assert.equal((await invoke(second,"storage_list",{limit:100,cursor:null})).items.length,0)
  await expectNativeError(second,"storage_insert",{generation:stale,payload:raw},"STALE_GENERATION")
  await close(second);await close(s);report.afterClear=db("inspect");assert.equal(report.afterClear.records.length,0);assert(!report.afterClear.temporaryBackupsExist)
  report.checks.push("Two native processes share migration/storage fences; individual deletion, full deletion and stale insertion cannot resurrect originals")
  // Real ACL failure in a second QA copy; never touch personal data or ACLs.
  const deniedRoot=join(tmpdir(),"opencode",`5b7-5d2b-${randomUUID()}`);db("seed",deniedRoot);const denied=join(deniedRoot,"migration-backups");mkdirSync(denied);const who=execFileSync("whoami",[],{encoding:"utf8"}).trim();let bad
  try{execFileSync("icacls",[denied,"/deny",`${who}:(OI)(CI)(W)`],{stdio:"pipe"});bad=await launch(deniedRoot);await nav(bad,"Historial").click();await bad.page.locator(".history-error").first().waitFor();assert((await bad.page.locator(".history-error").first().innerText()).includes("respaldo"));assert.equal(db("inspect",deniedRoot).schema,2);await close(bad);bad=null}
  finally{if(bad&&bad.app.exitCode===null)await close(bad).catch(()=>{});execFileSync("icacls",[denied,"/remove:d",who],{stdio:"pipe"})}
  const repaired=await launch(deniedRoot);assert.equal((await invoke(repaired,"storage_info")).schemaVersion,3);await close(repaired);report.checks.push("Actual Windows ACL denied backup creation: visible error and unchanged schema2; permissions restored and migration retried successfully")
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.external,[])
}catch(e){report.failures.push(e.stack??String(e));process.exitCode=1}
finally{for(const s of sessions){if(s.browser)await s.browser.close().catch(()=>{});if(s.app.exitCode===null)try{execFileSync("taskkill",["/PID",String(s.app.pid),"/T","/F"],{stdio:"pipe"})}catch{}}
  writeFileSync(join(out,"native-verification.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify({checks:report.checks,pdf:report.pdf,failures:report.failures,errors:report.errors,external:report.external},null,2))}
