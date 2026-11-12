import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {randomUUID,createHash} from 'node:crypto'
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath,pathToFileURL} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url)),out=join(root,'docs/evidence/5b12'),tools=process.env.PLAYWRIGHT_TOOLS_PATH??join(tmpdir(),'opencode/calculadora-nomina-verification'),{chromium}=createRequire(join(tools,'package.json'))('playwright'),report={reader:'Microsoft Edge PDF reader headed with sandbox',offline:true,documents:[],external:[],failures:[]};let context
try{
 context=await chromium.launchPersistentContext(join(tmpdir(),'opencode',`5b12-reader-${randomUUID()}`),{channel:'msedge',headless:false,chromiumSandbox:true,viewport:{width:1200,height:900},ignoreDefaultArgs:['--disable-extensions'],args:['--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-features=msPdfOOUI']});await context.setOffline(true);const p=context.pages()[0]??await context.newPage();p.on('request',r=>{if(/^https?:/.test(r.url()))report.external.push(r.url())})
 for(const id of ['actual','historial','alternativas','aproximado-historico','limitado-historico']){const path=join(out,'pdf',`${id}.pdf`),sha=()=>createHash('sha256').update(readFileSync(path)).digest('hex'),before=sha();await p.goto(pathToFileURL(path).href,{waitUntil:'load'});await p.waitForTimeout(1800);const viewer=await p.evaluate(()=>({type:document.contentType,embeds:[...document.querySelectorAll('embed')].map(e=>e.type),pdfViewer:Boolean(document.querySelector('pdf-viewer'))}));assert(viewer.type==='application/pdf'||viewer.embeds.includes('application/pdf')||viewer.pdfViewer);await p.screenshot({path:join(out,`reader-${id}.png`)});assert.equal(sha(),before);report.documents.push({id,path,sha256:before,viewer,status:'opened-offline'})}assert.deepEqual(report.external,[])
}catch(e){report.failures.push(e.stack??String(e));process.exitCode=1}finally{if(context)await context.close();writeFileSync(join(out,'pdf-reader.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))}
