// Real 0.1.0 -> 0.1.1-rc.1 NSIS upgrade, isolated from the owner's installation
// and data. Requires the previously authorized temporary isolation/restoration.
import assert from 'node:assert/strict'
import {spawn,execFileSync} from 'node:child_process'
import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {createHash,randomUUID} from 'node:crypto'
const root=fileURLToPath(new URL('../',import.meta.url)),candidate=resolve(process.argv[2]??'')
const reference=join(root,'src-tauri/target/release/bundle/nsis/Calculadora de Nómina_0.1.0_x64-setup.exe')
const sha=b=>createHash('sha256').update(b).digest('hex'),referenceHash='146cb6bdf9ae121846c15d692e5a5594b5b89433d2e4aeadb0809ea3bfde7f2a'
assert.equal(sha(readFileSync(reference)),referenceHash);assert(candidate.endsWith('0.1.1-rc.1_x64-setup.exe'))
const session=join(tmpdir(),'opencode','simple3-upgrade-'+randomUUID());mkdirSync(session)
const appDir=join(session,'application'),exe=join(appDir,'calculadora-nomina.exe'),ownerRoot=join(process.env.LOCALAPPDATA,'mx.calculadoranomina.desktop')
const report={session,referenceSha256:referenceHash,candidate,candidateSha256:sha(readFileSync(candidate)),checks:[],failures:[],traffic:[],pdfs:[]}
const checkpoint=()=>writeFileSync(join(session,'result.json'),JSON.stringify(report,null,2))
function pass(name,details={}){report.checks.push({name,status:'PASS',...details});checkpoint();console.log('PASS '+name)}
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),ps=s=>execFileSync('pwsh.exe',['-NoProfile','-Command',s],{encoding:'utf8',timeout:30000}).trim()
async function run(path,args){await new Promise((r,j)=>{const p=spawn(path,args,{cwd:session,stdio:'ignore'}),t=setTimeout(()=>j(Error('Process timed out: '+path)),120000);p.on('error',j);p.on('exit',code=>{clearTimeout(t);code===0?r():j(Error(path+': '+code))})})}
let app,ws,id=0,installed=false;const pending=new Map()
function call(method,params={}){return new Promise((r,j)=>{const n=++id;pending.set(n,{r,j});ws.send(JSON.stringify({id:n,method,params}))})}
async function evaluate(expression){const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value}
const invoke=(command,args={})=>evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)},${JSON.stringify(args)})`)
async function wait(expression,message,timeout=20000){const until=Date.now()+timeout;while(Date.now()<until){try{if(await evaluate(expression))return}catch{}await sleep(100)}throw Error(message)}
async function click(s){await evaluate(`document.querySelector(${JSON.stringify(s)}).click()`);await sleep(100)}
async function button(text,scope='button'){await evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(scope)})].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)throw Error('Missing button');e.click()})()`);await sleep(120)}
async function nav(text){await button(text,'.sidebar-nav button')}
async function value(s,v,select=false){await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(s)});Object.getOwnPropertyDescriptor(${select?'HTMLSelectElement':'HTMLInputElement'}.prototype,'value').set.call(e,${JSON.stringify(v)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`);await sleep(100)}
async function screenshot(name){const x=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(join(session,name+'.png'),Buffer.from(x.data,'base64'))}
function registrationVersion(){return ps(`(Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Calculadora de Nómina').DisplayVersion`)}
async function launch(version){
 const env={...process.env,PATH:`${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9228 --remote-debugging-address=127.0.0.1'}
 delete env.WEBVIEW2_USER_DATA_FOLDER;delete env.NOMINA_STORAGE_TEST_ROOT;delete env.NOMINA_FISCAL_QA_BUILD_ACK
 app=spawn(exe,[],{cwd:appDir,env,stdio:'ignore'});let target
 for(let n=0;n<160;n++){try{target=(await(await fetch('http://127.0.0.1:9228/json/list')).json()).find(p=>p.type==='page'&&p.url.includes('tauri.localhost'));if(target)break}catch{}if(app.exitCode!==null)throw Error('Application exited');await sleep(200)}
 assert(target,'No installed WebView');ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j})
 ws.onmessage=e=>{const x=JSON.parse(e.data);if(x.id){const p=pending.get(x.id);pending.delete(x.id);if(p)x.error?p.j(x.error):p.r(x.result)}else if(x.method==='Network.requestWillBeSent'){
  const request=x.params.request,u=new URL(request.url),local=['tauri.localhost','ipc.localhost','localhost'].includes(u.hostname)||['data:','blob:','ipc:','tauri:'].includes(u.protocol)
  report.traffic.push({url:u.protocol==='data:'?'data:local-asset':request.url,method:request.method,local,postBytes:request.postData?.length??0})
 }}
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable')
 // Observe without blocking traffic or interrupting the first native navigation.
 try{await wait(`!!document.querySelector('#salary')&&!document.querySelector('.theme-indicator')?.disabled`,'Installed UI unavailable')}
 catch(e){report.startFailure=await evaluate(`({url:location.href,ready:document.readyState,body:document.body?.innerText.slice(0,2000),native:!!window.__TAURI_INTERNALS__})`);await screenshot('start-failure');checkpoint();throw e}
 assert.equal(registrationVersion(),version)
 assert((await invoke('storage_info')).databasePath===join(ownerRoot,'payroll.sqlite3'))
 return await invoke('storage_get_preferences')
}
async function close(){if(ws){ws.close();ws=null}if(app&&app.exitCode===null){ps(`$p=Get-Process -Id ${app.pid} -ErrorAction SilentlyContinue;if($p){[void]$p.CloseMainWindow()}`);for(let n=0;n<80&&app.exitCode===null;n++)await sleep(100);if(app.exitCode===null){app.kill();await sleep(1000)}}app=null;await sleep(1000)}
const list=()=>invoke('storage_list',{limit:100,cursor:null})
async function wires(){const records={};for(const item of (await list()).items)records[item.executionId]=await invoke('storage_get',{executionId:item.executionId});return records}
async function calculate(mode,amount){
 await nav('Calcular');if(await evaluate(`!!document.querySelector('.capture-summary')`))await button('Editar datos','.capture-summary-actions button')
 await evaluate(`[...document.querySelectorAll('.mode-grid button')].find(e=>e.querySelector('strong').textContent===${JSON.stringify(mode==='gross-to-net'?'Bruto a neto':'Neto a bruto')}).click()`);await sleep(80)
 await value('#salary',amount);await value('#period','monthly',true)
 if(!(await evaluate(`!!document.querySelector('#capture-options')`)))await click('.imss-expand-toggle')
 await click('input[name="fiscal-date-mode"][value="yes"]');await value('#effective-date','2026-02-01');await click('.imss-expand-toggle');await click('.calculate-button')
 await wait(`document.querySelector('#calculator-workspace .results-section')?.getAttribute('aria-busy')==='false'`,'Calculation failed',30000)
 const result=await evaluate(`Object.fromEntries([...document.querySelector('#calculator-workspace .detail-panel').querySelectorAll('.detail-row')].map(e=>[e.querySelector('dt').textContent,e.querySelector('dd').textContent]))`)
 assert.equal(result['Salario bruto'],'$ 15,000.00');assert.equal(result['Salario neto estimado'],'$ 13,202.64')
 return result
}
async function historical(id){await nav('Historial');await wait(`!!document.querySelector('[data-history-id="${id}"]')`,'No history entry');await click(`[data-history-id="${id}"]`);await wait(`!!document.querySelector('[data-history-execution="${id}"]')`,'Original not recovered')}
async function exportGolden(file){
 await evaluate(`(()=>{window.__pdfTestRestore={Date:window.Date,uuid:crypto.randomUUID};const RealDate=window.Date;class FixedDate extends RealDate{constructor(...args){super(...(args.length?args:['2026-12-01T12:00:00.000Z']))}static now(){return RealDate.parse('2026-12-01T12:00:00.000Z')}}window.Date=FixedDate;Object.defineProperty(crypto,'randomUUID',{configurable:true,value:()=> '9011aa00-0000-4000-8000-000000000001'})})()`)
 try{
  await button('Exportar PDF','.history-export-actions button');let saved=false
  for(let n=0;n<15&&!saved;n++){await sleep(250);try{execFileSync('pwsh.exe',['-NoProfile','-File',join(root,'scripts/native-pdf-dialog.ps1'),'-ProcessId',String(app.pid),'-Action','save','-FilePath',file],{encoding:'utf8',timeout:15000});saved=true}catch{}}
  assert(saved,'No native PDF dialog');for(let n=0;n<100&&!existsSync(file);n++)await sleep(100);assert(existsSync(file));await wait(`document.querySelector('.pdf-export-notice')?.textContent.includes('guardado en')`,'PDF not saved')
  const bytes=readFileSync(file);assert(bytes.subarray(0,8).toString().startsWith('%PDF-1.'));report.pdfs.push({file,bytes:bytes.length,sha256:sha(bytes)});checkpoint();return sha(bytes)
 }finally{await evaluate(`window.Date=window.__pdfTestRestore.Date;Object.defineProperty(crypto,'randomUUID',{configurable:true,value:window.__pdfTestRestore.uuid});delete window.__pdfTestRestore`)}
}
try{
 checkpoint()
 ps(`Get-Process -Name 'calculadora-nomina' -ErrorAction SilentlyContinue | ForEach-Object {[void]$_.CloseMainWindow()};Start-Sleep -Seconds 2`)
 execFileSync(process.execPath,[join(root,'scripts/local-installation-state.mjs'),'begin',session],{stdio:'pipe'})
 execFileSync(process.execPath,[join(root,'scripts/simple3-profile.mjs'),'begin',session],{stdio:'pipe'})
 await run(reference,['/S','/D='+appDir]);installed=true
 assert.deepEqual(await launch('0.1.0'),{theme:'light',historyAutoSave:false});assert.equal((await list()).items.length,0)
 await nav('Historial');await wait(`!document.querySelector('.history-consent input')?.disabled`,'Consent unavailable');await click('.history-consent input');await wait(`!document.querySelector('.history-consent input').disabled&&document.querySelector('.history-consent input').checked`,'Consent not saved')
 await calculate('gross-to-net','15000.00');for(let n=0;n<60&&(await list()).items.length<1;n++)await sleep(100)
 await calculate('net-to-gross','13202.64');for(let n=0;n<60&&(await list()).items.length<2;n++)await sleep(100)
 const before=await wires();assert.equal(Object.keys(before).length,2)
 for(const text of Object.values(before)){const s=JSON.parse(text).value;assert.equal(s.versions.application,'0.1.0');assert.equal(s.executionProvenance.producerId,'nomina-contextual-2026-5d2b-v1')}
 await click('.theme-indicator');for(let n=0;n<40&&(await invoke('storage_get_preferences')).theme!=='dark';n++)await sleep(100)
 const preferences=await invoke('storage_get_preferences'),generation=(await invoke('storage_begin_write')).generation
 assert.deepEqual(preferences,{theme:'dark',historyAutoSave:true})
 const historicalId=Object.keys(before)[0];await historical(historicalId);const pdfBefore=await exportGolden(join(session,'historical-before.pdf'));await screenshot('reference-history')
 const wireHashes=Object.fromEntries(Object.entries(before).map(([id,wire])=>[id,sha(wire)]));pass('Installed reference 0.1.0 created direct/inverse originals and historical PDF',{wireHashes,pdfBefore})
 await close();await run(candidate,['/S','/D='+appDir]);assert.equal(registrationVersion(),'0.1.1-rc.1')
 assert.deepEqual(await launch('0.1.1-rc.1'),preferences);assert.deepEqual(await wires(),before);assert.equal((await invoke('storage_begin_write')).generation,generation)
 assert((await evaluate(`document.querySelector('.version').textContent`)).includes('0.1.1-rc.1'))
 pass('Real NSIS upgrade 0.1.0 -> 0.1.1-rc.1 preserves original bytes, preferences and generation')
 await historical(historicalId);const pdfAfter=await exportGolden(join(session,'historical-after.pdf'));assert.equal(pdfAfter,pdfBefore);assert.deepEqual(readFileSync(join(session,'historical-before.pdf')),readFileSync(join(session,'historical-after.pdf')))
 pass('Historical PDF is byte-identical with controlled export timestamp/report ID',{pdfBefore,pdfAfter});await screenshot('candidate-history')
 await calculate('gross-to-net','15000.00');for(let n=0;n<60&&(await list()).items.length<3;n++)await sleep(100)
 const after=await wires();assert.equal(Object.keys(after).length,3);for(const [id,wire]of Object.entries(before))assert.equal(after[id],wire)
 const current=JSON.parse(Object.entries(after).find(([id])=>!Object.hasOwn(before,id))[1]).value
 assert.equal(current.versions.application,'0.1.1-rc.1');assert.equal(current.executionProvenance.producerId,'nomina-contextual-2026-app-0.1.1-rc.1-v1');assert.equal(current.schemaVersion,2)
 assert.equal(current.fiscalPackage.version,'mx-fiscal-2026-source-v3');assert.equal(current.fiscalPackage.sha256,'7e9f13084e64633b29959d79eec5f9c02333fe2695809c662d71fa7fc8393ab0')
 pass('New calculation works after upgrade and emits new producer without changing old identities',{application:current.versions.application,producer:current.executionProvenance.producerId})
 const external=await invoke('fiscal_import_info',{request:{repository:false}});assert.equal(external.qa,false);assert.equal(external.canImport,false)
 const blocked=await evaluate(`window.__TAURI_INTERNALS__.invoke('fiscal_import_info',{request:{repository:true}}).then(()=>({unexpected:true}),e=>e)`);assert.equal(blocked.code,'PRODUCTION_BOOTSTRAP_MISSING')
 pass('External fiscal sources remain closed')
 await close();await launch('0.1.1-rc.1');assert.deepEqual(await wires(),after);assert.deepEqual(await invoke('storage_get_preferences'),preferences);pass('Post-upgrade restart preserves old and new documents')
 const externalTraffic=report.traffic.filter(e=>!e.local);assert.deepEqual(externalTraffic,[]);pass('No external salary transmission observed in installed app flows',{observedRequests:report.traffic.length,externalRequests:0})
 await close();const db=join(ownerRoot,'payroll.sqlite3'),dbHash=sha(readFileSync(db));await run(join(appDir,'uninstall.exe'),['/S'])
 for(let n=0;n<200&&existsSync(exe);n++)await sleep(100);installed=existsSync(exe);assert(!installed);assert.equal(sha(readFileSync(db)),dbHash);pass('Candidate uninstall preserves salary database by default')
 assert.equal(sha(readFileSync(reference)),referenceHash);pass('Approved reference installer 0.1.0 unchanged')
}catch(e){report.failures.push(e.stack??String(e));checkpoint();console.error(e)}
finally{
 try{await close()}catch(e){report.failures.push('Close: '+e.message)}
 if(installed&&existsSync(join(appDir,'uninstall.exe'))){try{await run(join(appDir,'uninstall.exe'),['/S']);for(let n=0;n<200&&existsSync(exe);n++)await sleep(100)}catch(e){report.failures.push('Test uninstall: '+e.message)}}
 if(existsSync(join(session,'owner-original-preserved'))){try{report.ownerData=JSON.parse(execFileSync(process.execPath,[join(root,'scripts/simple3-profile.mjs'),'restore',session],{encoding:'utf8'}));assert(report.ownerData.identical)}catch(e){report.failures.push('OWNER DATA RESTORE: '+e.message)}}
 if(existsSync(join(session,'installation-state.json'))){try{report.ownerInstallation=JSON.parse(execFileSync(process.execPath,[join(root,'scripts/local-installation-state.mjs'),'restore',session],{encoding:'utf8'}));assert(report.ownerInstallation.programUnchanged)}catch(e){report.failures.push('OWNER INSTALLATION RESTORE: '+e.message)}}
 checkpoint();console.log(JSON.stringify({session,checks:report.checks.length,failures:report.failures,ownerData:report.ownerData,ownerInstallation:report.ownerInstallation},null,2));process.exitCode=report.failures.length?1:0
}
