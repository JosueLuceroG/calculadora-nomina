import assert from "node:assert/strict"
import {createRequire} from "node:module"
import {randomUUID,createHash} from "node:crypto"
import {mkdirSync,readFileSync,writeFileSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {fileURLToPath,pathToFileURL} from "node:url"
import {execFileSync} from "node:child_process"
const root=fileURLToPath(new URL("../",import.meta.url)),refinement=process.argv.includes("--refinement"),out=join(root,refinement?"docs/evidence/5b11-1":"docs/evidence/5b11"),tools=process.env.PLAYWRIGHT_TOOLS_PATH??join(tmpdir(),"opencode","calculadora-nomina-verification"),{chromium}=createRequire(join(tools,"package.json"))("playwright")
const profile=join(tmpdir(),"opencode",`5b11-reader-${randomUUID()}`);mkdirSync(profile,{recursive:true})
const report={reader:"Microsoft Edge headed / built-in PDF reader",profile,offline:true,documents:[],errors:[],externalRequests:[],failures:[]};let context
try{
 context=await chromium.launchPersistentContext(profile,{channel:"msedge",headless:false,chromiumSandbox:true,viewport:{width:1200,height:900},ignoreDefaultArgs:["--disable-extensions"],args:["--no-first-run","--no-default-browser-check","--disable-background-networking","--disable-component-update","--disable-features=msPdfOOUI"]})
 const page=context.pages()[0]??await context.newPage();await page.goto("about:blank");await context.setOffline(true)
 page.on("pageerror",e=>report.errors.push(e.message));page.on("request",r=>{if(/^https?:/.test(r.url()))report.externalRequests.push(r.url())})
 const cdp=await context.browser().newBrowserCDPSession(),processes=await cdp.send("SystemInfo.getProcessInfo"),pid=Number(processes.processInfo.find(p=>p.type==="browser").id)
 report.version=await context.browser().version()
 for(const name of(refinement?["embedded-calcular.pdf","embedded-historial.pdf","embedded-alternativas.pdf"]:["embedded-calcular.pdf","native-historial-original.pdf","native-alternativas.pdf"])){
  const path=join(out,name),before=createHash("sha256").update(readFileSync(path)).digest("hex")
  await page.goto(pathToFileURL(path).href,{waitUntil:"load",timeout:45000});await page.waitForTimeout(2500)
  const viewer=await page.evaluate(()=>({url:location.href,contentType:document.contentType,title:document.title,embeds:[...document.querySelectorAll("embed")].map(e=>({type:e.type,src:e.src})),hasPdfViewer:Boolean(document.querySelector("pdf-viewer"))}))
  assert(viewer.contentType==="application/pdf"||viewer.embeds.some(e=>e.type==="application/pdf")||viewer.hasPdfViewer)
  const screenshot=join(out,`reader-${name.replace(".pdf","")}.png`);await page.screenshot({path:screenshot})
  const native=JSON.parse(execFileSync("pwsh",["-NoProfile","-File",join(root,"scripts/native-window.ps1"),"-Action","capture","-ProcessId",String(pid),"-OutputPath",join(out,`reader-window-${name.replace(".pdf","")}.png`)],{encoding:"utf8",timeout:30000}));assert(native.visible&&native.responding)
  assert.equal(createHash("sha256").update(readFileSync(path)).digest("hex"),before)
  report.documents.push({file:path,sha256:before,viewer,screenshot,nativeWindow:native,status:"opened-offline"})
 }
 assert.deepEqual(report.externalRequests,[]);assert.deepEqual(report.errors,[])
}catch(e){report.failures.push(e.stack??String(e));process.exitCode=1}
finally{if(context)await context.close();writeFileSync(join(out,"pdf-reader.json"),JSON.stringify(report,null,2));console.log(JSON.stringify({reader:report.reader,offline:report.offline,documents:report.documents.map(d=>({file:d.file,status:d.status,sha256:d.sha256})),failures:report.failures},null,2))}
