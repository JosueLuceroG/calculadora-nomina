import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdirSync,writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { execFileSync,spawn } from "node:child_process"
import { checkHistoryCases,checkHistoryRestart } from "./check-history-cases.mjs"
const root=fileURLToPath(new URL("../",import.meta.url)),tools=process.env.PLAYWRIGHT_TOOLS_PATH??join(tmpdir(),"opencode","calculadora-nomina-verification")
const{chromium}=createRequire(join(tools,"package.json"))("playwright"),isNative=process.argv.includes("--native"),mode=isNative?"native":"edge",port=isNative?1420:1432,base=`http://127.0.0.1:${port}/`
const out=join(root,"docs/evidence/5b8"),isolatedRoot=join(tmpdir(),"opencode",`5b7-history-${randomUUID()}`)
mkdirSync(out,{recursive:true})
const report={mode,nativeTauri:isNative,isolatedRoot:isNative?isolatedRoot:null,checks:[],metrics:[],errors:[],consoleErrors:[],failures:[]}
let occupied=false;try{await fetch(base);occupied=true}catch{}assert(!occupied)
if(isNative)assert.equal(execFileSync("pwsh",["-NoProfile","-Command","@(Get-Process -Name 'calculadora-nomina' -ErrorAction SilentlyContinue).Count"],{encoding:"utf8"}).trim(),"0")
if(isNative){let debugOccupied=false;try{await fetch("http://127.0.0.1:9225/json/version");debugOccupied=true}catch{}assert(!debugOccupied,"El puerto CDP 9225 debe estar libre")}
const server=spawn(process.execPath,[join(root,"node_modules/vite/bin/vite.js"),"--host","127.0.0.1","--port",String(port),"--strictPort"],{cwd:root,stdio:"ignore"})
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let browser,page,app,pid=0
function native(action,more=[]){return JSON.parse(execFileSync("pwsh",["-NoProfile","-File",join(root,"scripts/native-window.ps1"),"-Action",action,...(pid?["-ProcessId",String(pid)]:[]),...more],{encoding:"utf8",timeout:30000}))}
async function launch(){
  if(isNative){
    app=spawn(join(root,"src-tauri/target/debug/calculadora-nomina.exe"),[],{cwd:root,env:{...process.env,NOMINA_STORAGE_TEST_ROOT:isolatedRoot,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:"--remote-debugging-port=9225 --remote-debugging-address=127.0.0.1",WEBVIEW2_USER_DATA_FOLDER:join(tools,`3b4-profile-5b8-${randomUUID()}`)},stdio:"ignore"})
    for(let i=0;i<150;i++){try{browser=await chromium.connectOverCDP("http://127.0.0.1:9225");break}catch{await sleep(200)}}assert(browser)
    for(let i=0;i<100;i++){page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith(base));if(page)break;await sleep(100)}assert(page)
    const data=native("inspect");pid=data.pid;report.nativeWindow=data
  }else{browser=await chromium.launch({channel:"msedge",headless:true});page=await browser.newPage({viewport:{width:1180,height:760},timezoneId:"America/Mexico_City"})}
  page.on("pageerror",e=>report.errors.push(e.message));page.on("console",e=>{if(e.type()==="error")report.consoleErrors.push(e.text())})
  await page.goto(`${base}dev/history.html`,{waitUntil:"networkidle"});await page.waitForFunction(()=>window.__historyVerification?.history?.getState().preferenceStatus!=="loading")
  report.browserVersion=await browser.version();assert.equal(await page.evaluate(()=>window.__historyVerification.native),isNative)
}
async function close(){if(isNative&&pid)native("close");if(browser)await browser.close().catch(()=>{});browser=null;if(app){for(let i=0;i<100&&app.exitCode===null;i++)await sleep(50);assert(app.exitCode!==null)}pid=0}
async function screenshot(name){if(isNative)native("capture",["-OutputPath",join(out,`${mode}-${name}.png`)]);else await page.screenshot({path:join(out,`${mode}-${name}.png`),fullPage:true})}
try{
  let ready=false;for(let i=0;i<150;i++){try{if((await fetch(base)).ok){ready=true;break}}catch{}await sleep(100)}assert(ready)
  await launch()
  const original=await checkHistoryCases({page,base,isNative,isolatedRoot,native,screenshot,report})
  if(isNative){await close();await launch();await checkHistoryRestart({page,original,report});report.normalProcessRestart=true}
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.consoleErrors,[])
  await close()
}catch(e){report.failures.push(e.stack??String(e));process.exitCode=1}
finally{if(browser)await browser.close().catch(()=>{});if(app?.exitCode===null){try{execFileSync("taskkill",["/PID",String(app.pid),"/T","/F"],{stdio:"pipe"})}catch{}}server.kill();writeFileSync(join(out,`${mode}-history-ui.json`),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))}
