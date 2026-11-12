// Solo el ejecutable integrado existente, perfiles/bases QA y reloj real por defecto.
import assert from "node:assert/strict"
import {createRequire} from "node:module"
import {randomUUID,createHash} from "node:crypto"
import {mkdirSync,readFileSync,writeFileSync} from "node:fs"
import {join} from "node:path"
import {tmpdir,cpus,freemem,totalmem,release} from "node:os"
import {fileURLToPath} from "node:url"
import {spawn,execFileSync} from "node:child_process"
const root=fileURLToPath(new URL('../',import.meta.url)),out=join(root,'docs/evidence/5b12'),tools=process.env.PLAYWRIGHT_TOOLS_PATH??join(tmpdir(),'opencode/calculadora-nomina-verification'),{chromium}=createRequire(join(tools,'package.json'))('playwright'),storageRoot=join(tmpdir(),'opencode',`5b7-integral-${randomUUID()}`),pdfRoot=join(tmpdir(),'opencode',`5b11-integral-${randomUUID()}`),exe=join(root,'src-tauri/target/debug/calculadora-nomina.exe'),sha=b=>createHash('sha256').update(b).digest('hex'),delay=ms=>new Promise(r=>setTimeout(r,ms))
mkdirSync(out,{recursive:true});mkdirSync(pdfRoot,{recursive:true});mkdirSync(join(out,'pdf'),{recursive:true})
const report={startedOn:new Date().toISOString(),mode:'native-debug-integrated-offline-no-vite-no-rebuild',binarySha256:sha(readFileSync(exe)),storageRoot,pdfRoot,environment:{windows:release(),cpu:cpus()[0].model,logicalCpus:cpus().length,totalMemory:totalmem(),availableMemory:freemem()},checks:[],fiscal:[],metrics:[],performance:[],pdf:[],requests:[],external:[],errors:[],consoleErrors:[],httpErrors:[],failures:[],lifecycle:[]}
const section=process.argv.find(a=>a.startsWith('--section='))?.split('=')[1]??'all';assert(['ui','history','history-pages','accessibility','layouts','monitors','pdf','performance','all'].includes(section));report.section=section
if(section==='all'){
 const parts=['ui','history','history-pages','accessibility','layouts','monitors','pdf','performance']
 if(!process.argv.includes('--aggregate'))for(const part of parts)execFileSync(process.execPath,[fileURLToPath(import.meta.url),`--section=${part}`],{cwd:root,stdio:'inherit',timeout:300000})
 const reports=parts.map(part=>JSON.parse(readFileSync(join(out,`native-${part}.json`),'utf8')));for(const r of reports){assert.deepEqual(r.failures,[]);assert.equal(r.binarySha256,report.binarySha256)}
 const aggregate={checkedOn:new Date().toISOString(),mode:report.mode,binarySha256:report.binarySha256,reports:parts.map(p=>`native-${p}.json`),checks:reports.flatMap(r=>r.checks),fiscalCases:reports.flatMap(r=>r.fiscal).length,pdf:reports.flatMap(r=>r.pdf),errors:reports.flatMap(r=>r.errors),externalRequests:reports.flatMap(r=>r.external),performance:reports.find(r=>r.section==='performance').performanceSummary,failures:[]};writeFileSync(join(out,'native-integral.json'),JSON.stringify(aggregate,null,2));console.log(JSON.stringify({status:'passed',reports:aggregate.reports,fiscalCases:aggregate.fiscalCases,pdfs:aggregate.pdf.length},null,2));process.exit(0)
}
let app,browser,page,pid=0,logs=''
function native(action='inspect',args=[]){return JSON.parse(execFileSync('pwsh',['-NoProfile','-File',join(root,'scripts/native-window.ps1'),'-Action',action,...(pid?['-ProcessId',String(pid)]:[]),...args],{encoding:'utf8',timeout:30000}))}
function dialog(action='inspect',args=[]){return JSON.parse(execFileSync('pwsh',['-NoProfile','-File',join(root,'scripts/native-pdf-dialog.ps1'),'-ProcessId',String(pid),'-Action',action,...args],{encoding:'utf8',timeout:30000}))}
async function waitDialog(predicate=d=>d.windows.length>0){for(let i=0;i<30;i++){const d=dialog();if(predicate(d))return d;await delay(100)}throw new Error('No apareció el diálogo propio esperado')}
async function screenshot(name){native('capture',['-OutputPath',join(out,`${name}.png`)])}
function probe(){
 window.__integralRun=null
 document.addEventListener('submit',()=>{const run={started:performance.now(),elapsedMs:null,frames:0,lastFrame:performance.now(),maxFrameGapMs:0};window.__integralRun=run;requestAnimationFrame(function frame(now){if(run.elapsedMs!==null)return;run.frames++;run.maxFrameGapMs=Math.max(run.maxFrameGapMs,now-run.lastFrame);run.lastFrame=now;requestAnimationFrame(frame)})},true)
 document.addEventListener('click',e=>{if(e.target.closest('button')?.textContent.trim()==='Cancelar'&&window.__integralRun)window.__integralRun.cancelClick=performance.now()},true)
 const observe=()=>new MutationObserver(()=>{const run=window.__integralRun,e=document.querySelector('#calculator-workspace .results-section');if(run&&run.elapsedMs===null&&e?.getAttribute('aria-busy')==='false'){run.elapsedMs=performance.now()-run.started;run.state=e.dataset.resultState;run.maxFrameGapMs=Math.max(run.maxFrameGapMs,performance.now()-run.lastFrame);if(run.cancelClick!==undefined)run.cancelEventToCommitMs=performance.now()-run.cancelClick}}).observe(document.documentElement,{subtree:true,childList:true,attributes:true})
 if(document.readyState==='loading')addEventListener('DOMContentLoaded',observe,{once:true});else observe()
}
async function launch(){
 const started=performance.now()
 app=spawn(exe,[],{cwd:root,env:{...process.env,NOMINA_STORAGE_TEST_ROOT:storageRoot,NOMINA_PDF_PROBE_DIRECTORY:pdfRoot,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9225 --remote-debugging-address=127.0.0.1',WEBVIEW2_USER_DATA_FOLDER:join(tools,`3b4-profile-5b12-${randomUUID()}`)},stdio:['ignore','pipe','pipe']});app.stdout.on('data',d=>logs+=d);app.stderr.on('data',d=>logs+=d)
 for(let i=0;i<150;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:9225');break}catch{assert.equal(app.exitCode,null);await delay(100)}}assert(browser)
 for(let i=0;i<100;i++){page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url()==='http://tauri.localhost/');if(page)break;await delay(100)}assert(page,'La prueba requiere el origen integrado, no Vite')
 await page.emulateMedia({colorScheme:null});await page.context().setOffline(true)
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',e=>{if(e.type()==='error')report.consoleErrors.push(e.text())});page.on('request',r=>{if(/^https?:/.test(r.url())){report.requests.push({url:r.url(),method:r.method()});if(!/^http:\/\/(tauri|ipc)\.localhost\//.test(r.url()))report.external.push(r.url())}});page.on('response',r=>{if(r.status()>=400)report.httpErrors.push({url:r.url(),status:r.status()})})
 await page.locator('#salary').waitFor();await page.waitForFunction(()=>!document.querySelector('button[type=submit]')?.disabled)
 const readyMs=performance.now()-started;pid=app.pid;const w=native();assert.equal(w.pid,pid);assert(w.visible&&w.responding&&!w.hung);report.lifecycle.push({phase:'launch',readyMs,window:w});report.webview=await browser.version()
 await page.addInitScript(probe);await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>!document.querySelector('button[type=submit]')?.disabled)
}
async function close(){if(pid)native('close');if(browser)await browser.close().catch(()=>{});browser=null;for(let i=0;i<100&&app?.exitCode===null;i++)await delay(50);assert.notEqual(app?.exitCode,null,'El proceso debe cerrar normalmente');report.lifecycle.push({phase:'close',exitCode:app?.exitCode});pid=0}
const nav=n=>page.getByRole('navigation',{name:'Navegación principal'}).getByRole('button',{name:n,exact:true})
async function calculator(){await nav('Calcular').click();const e=page.getByRole('button',{name:'Editar datos',exact:true});if(await e.isVisible())await e.click()}
async function fill({mode='gross-to-net',amount='15000.00',period='monthly',date='2026-02-01',imss=true,bonus='15',vacation='12',premium='25'}={}){await calculator();await page.getByRole('button',{name:mode==='gross-to-net'?/Bruto a neto/:/Neto a bruto/}).click();for(const[id,value]of[['salary',amount],['bonus-days',bonus],['vacation-days',vacation],['vacation-premium',premium]])await page.locator(`#${id}`).fill(value);await page.locator('#period').selectOption(period);await page.locator(imss?'#include-imss':'#exclude-imss').check();await page.locator('input[name=fiscal-date-mode][value=yes]').check();await page.locator('#effective-date').fill(date)}
async function calculate(wait=true){await page.locator('#salary').press('Enter');if(wait)await page.waitForFunction(()=>document.querySelector('#calculator-workspace .results-section')?.getAttribute('aria-busy')==='false')}
async function invoke(command,args={}){return page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args})}
async function rows(){return(await invoke('storage_list',{limit:100,cursor:null})).items}
async function history(){await nav('Historial').click();await page.waitForFunction(()=>document.querySelector('.history-list-card')?.getAttribute('aria-busy')!=='true')}
async function consent(value){await history();if(await page.locator('.history-consent input').isChecked()!==value)await page.locator('.history-consent input').click();await page.waitForFunction(async v=>(await window.__TAURI_INTERNALS__.invoke('storage_get_preferences')).historyAutoSave===v,value);await page.waitForFunction(v=>{const e=document.querySelector('.history-consent input');return!e.disabled&&e.checked===v},value)}
function sql(action,extra=[]){return execFileSync('python',[join(root,'scripts/5b12-sqlite-qa.py'),join(storageRoot,'payroll.sqlite3'),action,...extra],{encoding:'utf8',timeout:20000}).trim()}
async function measure(name){const m=await page.evaluate(name=>({name,width:innerWidth,height:innerHeight,dpr:devicePixelRatio,zoom:visualViewport.scale,scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,scrollHeight:document.documentElement.scrollHeight,clientHeight:document.documentElement.clientHeight}),name);assert(m.scrollWidth<=m.clientWidth,name);assert.equal(m.zoom,1);report.metrics.push(m);return m}
const h={root,out,storageRoot,pdfRoot,report,get page(){return page},nav,fill,calculate,calculator,history,consent,invoke,rows,sql,native,dialog,waitDialog,screenshot,measure,launch,close,delay,sha}
try{
 assert.equal(execFileSync('pwsh',['-NoProfile','-Command',"@(Get-Process -Name 'calculadora-nomina' -ErrorAction SilentlyContinue).Count"],{encoding:'utf8'}).trim(),'0','No se toca una sesión personal abierta')
 let occupied=false;try{await fetch('http://127.0.0.1:9225/json/version');occupied=true}catch{}assert(!occupied)
 await launch()
 if(section==='all'||section==='ui'){const {checkFiscalUi,checkExperience}=await import('./5b12-ui-cases.mjs');await checkFiscalUi(h);await checkExperience(h)}
 if(section==='all'||section==='history'){const {checkSqlite}=await import('./5b12-history-cases.mjs');await checkSqlite(h)}
 if(section==='all'||section==='pdf'){const {checkPdf}=await import('./5b12-pdf-cases.mjs');await checkPdf(h)}
 if(section==='all'||section==='performance'){const {checkPerformance}=await import('./5b12-performance.mjs');await checkPerformance(h)}
 if(section==='all'||section==='history-pages'){const {checkHistoryPages}=await import('./5b12-extra-cases.mjs');await checkHistoryPages(h)}
 if(section==='all'||section==='accessibility'){const {checkAccessibility}=await import('./5b12-extra-cases.mjs');await checkAccessibility(h)}
 if(section==='all'||section==='layouts'){const {checkLayouts}=await import('./5b12-extra-cases.mjs');await checkLayouts(h)}
 if(section==='all'||section==='monitors'){const {checkMonitors}=await import('./5b12-extra-cases.mjs');await checkMonitors(h)}
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.external,[]);assert.deepEqual(report.httpErrors,[]);assert(!/panicked at|thread .*panicked/i.test(logs))
 await close();report.databaseCheck=JSON.parse(sql('integrity'))
}catch(e){report.failures.push(e.stack??String(e));process.exitCode=1;if(page&&!page.isClosed())await screenshot('native-failure').catch(()=>{})}
finally{if(browser)await browser.close().catch(()=>{});if(app?.exitCode===null)try{execFileSync('taskkill',['/PID',String(app.pid),'/T','/F'],{stdio:'pipe'})}catch{}report.finishedOn=new Date().toISOString();writeFileSync(join(out,`native-${section}.json`),JSON.stringify(report,null,2));writeFileSync(join(out,`native-${section}.log`),logs);console.log(JSON.stringify({section,checks:report.checks,fiscalCases:report.fiscal.length,pdf:report.pdf.map(p=>p.id),performance:report.performanceSummary,failures:report.failures},null,2))}
