import assert from "node:assert/strict"
import {createHash,randomUUID} from "node:crypto"
import {createRequire} from "node:module"
import {spawn,execFileSync} from "node:child_process"
import {readFileSync,writeFileSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {fileURLToPath} from "node:url"
const root=fileURLToPath(new URL("../",import.meta.url)),out=join(root,"docs/evidence/5d2b"),tools=process.env.PLAYWRIGHT_TOOLS_PATH??join(tmpdir(),"opencode/calculadora-nomina-verification"),{chromium}=createRequire(join(tools,"package.json"))("playwright")
const exe=join(tmpdir(),"opencode/5d2b-native-backup/before-5d2b.exe"),sha=bytes=>createHash("sha256").update(bytes).digest("hex")
assert.equal(sha(readFileSync(exe)),"d5a9e01137145721fb98e34449f5bb86aabf6a5918f18f6c468f31adacb17de5")
let occupied=false;try{await fetch("http://127.0.0.1:9235/json/version");occupied=true}catch{}assert(!occupied)
const app=spawn(exe,[],{cwd:root,env:{...process.env,NOMINA_STORAGE_TEST_ROOT:join(tmpdir(),"opencode",`5b7-5d2b-css-${randomUUID()}`),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:"--remote-debugging-port=9235 --remote-debugging-address=127.0.0.1",WEBVIEW2_USER_DATA_FOLDER:join(tools,`3b4-profile-5d2b-css-${randomUUID()}`)},stdio:"ignore"})
let browser;const delay=ms=>new Promise(r=>setTimeout(r,ms))
try{
  for(let i=0;i<150;i++){try{browser=await chromium.connectOverCDP("http://127.0.0.1:9235");break}catch{await delay(100)}}assert(browser)
  let page;for(let i=0;i<100;i++){page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url()==="http://tauri.localhost/");if(page)break;await delay(100)}assert(page)
  await page.context().setOffline(true);await page.waitForFunction(()=>document.querySelector('link[rel="stylesheet"]'))
  const href=await page.evaluate(()=>document.querySelector('link[rel="stylesheet"]').href)
  const session=await page.context().newCDPSession(page);await session.send("Page.enable");const tree=await session.send("Page.getFrameTree"),resource=await session.send("Page.getResourceContent",{frameId:tree.frameTree.frame.id,url:href})
  const bytes=Buffer.from(resource.content,resource.base64Encoded?"base64":"utf8");writeFileSync(join(out,"baseline-5d2a.css"),bytes)
  const report={origin:"CDP resource from immutable approved5D2a executable backup; not regenerated from current source",binarySha256:sha(readFileSync(exe)),asset:href,cssSha256:sha(bytes)}
  writeFileSync(join(out,"css-baseline.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report))
  execFileSync("pwsh",["-NoProfile","-File",join(root,"scripts/native-window.ps1"),"-Action","close","-ProcessId",String(app.pid)],{stdio:"pipe"});for(let i=0;i<300&&app.exitCode===null;i++)await delay(50);assert.notEqual(app.exitCode,null)
}finally{if(browser)await browser.close().catch(()=>{});if(app.exitCode===null)try{execFileSync("taskkill",["/PID",String(app.pid),"/T","/F"],{stdio:"pipe"})}catch{}}
