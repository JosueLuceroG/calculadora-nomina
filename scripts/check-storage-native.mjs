// Frontera Tauri real, en directorio temporal exclusivo. Nunca abre la base real.
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { randomUUID, createHash } from "node:crypto"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { execFileSync, spawn } from "node:child_process"
const root=fileURLToPath(new URL("../",import.meta.url)),tools=process.env.PLAYWRIGHT_TOOLS_PATH??join(tmpdir(),"opencode","calculadora-nomina-verification")
const {chromium}=createRequire(join(tools,"package.json"))("playwright")
const base="http://127.0.0.1:1420/",out=join(root,"docs/evidence/5b7"),isolatedRoot=join(tmpdir(),"opencode",`5b7-native-${randomUUID()}`),db=join(isolatedRoot,"payroll.sqlite3")
mkdirSync(out,{recursive:true});assert(!existsSync(isolatedRoot))
let occupied=false;try{await fetch(base);occupied=true}catch{}assert(!occupied,"No reutilizar servidor ajeno")
assert.equal(execFileSync("pwsh",["-NoProfile","-Command","@(Get-Process -Name 'calculadora-nomina' -ErrorAction SilentlyContinue).Count"],{encoding:"utf8"}).trim(),"0")
const report={nativeTauri:true,isolatedRoot,checks:[],errors:[],failures:[]};let app,browser,page,pid=0
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const server=spawn(process.execPath,[join(root,"node_modules/vite/bin/vite.js"),"--host","127.0.0.1","--port","1420","--strictPort"],{cwd:root,stdio:"ignore"})
function native(action){return JSON.parse(execFileSync("pwsh",["-NoProfile","-File",join(root,"scripts/native-window.ps1"),"-Action",action,...(pid?["-ProcessId",String(pid)]:[])],{encoding:"utf8",timeout:30000}))}
async function launch(){
  app=spawn(join(root,"src-tauri/target/debug/calculadora-nomina.exe"),[],{cwd:root,env:{...process.env,NOMINA_STORAGE_TEST_ROOT:isolatedRoot,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:"--remote-debugging-port=9225 --remote-debugging-address=127.0.0.1",WEBVIEW2_USER_DATA_FOLDER:join(tools,`3b4-profile-5b7-${randomUUID()}`)},stdio:"ignore"})
  for(let i=0;i<150;i++){try{browser=await chromium.connectOverCDP("http://127.0.0.1:9225");break}catch{await sleep(200)}}assert(browser)
  for(let i=0;i<100;i++){page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith(base));if(page)break;await sleep(100)}assert(page)
  page.on("pageerror",e=>report.errors.push(e.message));const window=native("inspect");pid=window.pid;report.nativeWindow=window;report.browserVersion=await browser.version()
}
async function close(){if(pid)native("close");if(browser)await browser.close().catch(()=>{});browser=null;for(let i=0;i<100&&app?.exitCode===null;i++)await sleep(50);assert(app?.exitCode!==null,"Cierre normal del proceso");pid=0}
async function dev(){await page.goto(`${base}dev/storage.html`,{waitUntil:"networkidle"});await page.waitForFunction(()=>Boolean(window.__storageVerification))}
async function calculate(){
  await page.getByRole("button",{name:/Bruto a neto/}).click();await page.locator("#salary").fill("15000.00");await page.locator("#period").selectOption("monthly")
  await page.locator('input[name="fiscal-date-mode"][value="yes"]').check();await page.locator("input#effective-date").fill("2026-02-01");await page.locator("#salary").press("Enter")
  await page.locator(".results-section").waitFor();await page.waitForFunction(()=>document.querySelector(".results-section")?.getAttribute("aria-busy")==="false")
  assert.equal(await page.locator(".primary-amount").innerText(),"$ 13,202.64")
}
try{
  let ready=false;for(let i=0;i<150;i++){try{if((await fetch(base)).ok){ready=true;break}}catch{}await sleep(100)}assert(ready)
  await launch();assert(await page.evaluate(()=>typeof window.__TAURI_INTERNALS__==="object"));assert(!existsSync(db));await calculate();assert(!existsSync(db))
  assert.equal(await page.getByRole("button",{name:"Historial",exact:true}).isDisabled(),true)
  report.checks.push("Arranque normal y cálculo real no crean base ni simulaciones; Historial sigue deshabilitado")
  await dev()
  const info=await page.evaluate(()=>window.__storageVerification.api.info());assert(info.databasePath.startsWith(isolatedRoot));assert.equal(info.schemaVersion,2);assert.equal(info.encrypted,false);assert(existsSync(db));report.storageInfo=info
  const generation=(await page.evaluate(()=>window.__storageVerification.api.beginWrite())).generation
  assert.deepEqual(await page.evaluate(()=>window.__storageVerification.api.getPreferences()),{theme:"light",historyAutoSave:false})
  const results=await page.evaluate(async generation=>{const v=window.__storageVerification;const a=await Promise.all([v.save(0,generation),v.save(0,generation)]);for(let i=1;i<v.fixtures.length;i++)await v.save(i,generation);return{duplicate:a.map(r=>r.inserted),matches:await Promise.all(v.fixtures.map((_,i)=>v.matches(i))) }},generation)
  assert.equal(results.duplicate.filter(Boolean).length,1);assert(results.matches.every(Boolean))
  const first=await page.evaluate(()=>window.__storageVerification.api.list(2));assert.equal(first.items.length,2);assert(first.nextCursor)
  const second=await page.evaluate(cursor=>window.__storageVerification.api.list(2,cursor),first.nextCursor);assert.equal(second.items.length,2);assert(!first.items.some(a=>second.items.some(b=>b.executionId===a.executionId)))
  await page.evaluate(()=>window.__storageVerification.api.setPreferences({theme:"dark",historyAutoSave:true}))
  const beforeCount=(await page.evaluate(()=>window.__storageVerification.api.list(100))).items.length;await calculate();assert.equal((await page.evaluate(()=>window.__storageVerification.api.list(100))).items.length,beforeCount)
  assert((await page.locator(".theme-indicator").innerText()).includes("Tema claro"))
  report.checks.push("Comandos reales: SQLite v2, seis snapshots exactos, inserción doble idempotente, páginas ordenadas y preferencias; sin auto-guardado ni tema aplicado")
  await close();await launch();await dev()
  assert.equal((await page.evaluate(()=>window.__storageVerification.api.beginWrite())).generation,generation)
  assert.deepEqual(await page.evaluate(()=>window.__storageVerification.api.getPreferences()),{theme:"dark",historyAutoSave:true})
  assert((await page.evaluate(()=>Promise.all(window.__storageVerification.fixtures.map((_,i)=>window.__storageVerification.matches(i))))).every(Boolean))
  report.checks.push("Cierre/reinicio reales de Tauri preservan escrituras confirmadas, generación, seis reportes y preferencias")
  const id=await page.evaluate(()=>JSON.parse(window.__storageVerification.fixtures[0].payload).value.executionId)
  assert.equal((await page.evaluate(id=>window.__storageVerification.api.delete(id),id)).deleted,true);assert.equal(await page.evaluate(id=>window.__storageVerification.api.get(id),id),null)
  const deleted=await page.evaluate(async generation=>{try{await window.__storageVerification.save(0,generation);return "unexpected"}catch(e){return e.code}},generation);assert.equal(deleted,"DELETED_EXECUTION")
  const newGeneration=await page.evaluate(()=>window.__storageVerification.api.clear());assert.notEqual(newGeneration.generation,generation)
  const stale=await page.evaluate(async generation=>{try{await window.__storageVerification.save(1,generation);return "unexpected"}catch(e){return e.code}},generation);assert.equal(stale,"STALE_GENERATION");assert.equal((await page.evaluate(()=>window.__storageVerification.api.list(100))).items.length,0)
  report.checks.push("Borrado individual impide reinserción y borrado completo rechaza un guardado de generación anterior; preferencias conservadas")
  await close();writeFileSync(db,"synthetic corrupt sqlite for isolated QA")
  const corruptHash=createHash("sha256").update(readFileSync(db)).digest("hex")
  await launch();await dev()
  const failure=await page.evaluate(async()=>{try{await window.__storageVerification.api.info();return "unexpected"}catch(e){return e.code}});assert.equal(failure,"CORRUPT_DATABASE")
  await calculate();const recovered=await page.evaluate(()=>window.__storageVerification.api.recoverCorrupt())
  assert.equal(createHash("sha256").update(readFileSync(join(recovered.quarantinePath,"payroll.sqlite3"))).digest("hex"),corruptHash)
  assert.equal((await page.evaluate(()=>window.__storageVerification.api.list(100))).items.length,0)
  assert.deepEqual(await page.evaluate(()=>window.__storageVerification.api.getPreferences()),{theme:"light",historyAutoSave:false})
  report.checks.push("Base corrupta aislada devuelve error tipado sin invalidar cálculo correcto; recuperación explícita conserva original en cuarentena")
  assert.deepEqual(report.errors,[]);await close();report.normalProcessRestarts=2
}catch(error){report.failures.push(error.stack??String(error));process.exitCode=1}
finally{if(browser)await browser.close().catch(()=>{});if(app?.exitCode===null){try{execFileSync("taskkill",["/PID",String(app.pid),"/T","/F"],{stdio:"pipe"})}catch{}}server.kill();writeFileSync(join(out,"native-storage.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))}
