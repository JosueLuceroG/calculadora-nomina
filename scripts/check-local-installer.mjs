// Focused installed-release verification. Requires the owner's explicit approval
// for simple3-profile.mjs begin/restore; never run against an occupied profile.
import assert from 'node:assert/strict'
import {spawn,execFileSync} from 'node:child_process'
import {existsSync,mkdirSync,readFileSync,writeFileSync,cpSync} from 'node:fs'
import {createHash,randomUUID} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'

const root=fileURLToPath(new URL('../',import.meta.url)),installer=resolve(process.argv[2]??'')
assert(existsSync(installer)&&installer.endsWith('x64-setup.exe'))
const maintenanceSource=process.argv[3]==='--maintenance-only'?resolve(process.argv[4]??''):null
if(maintenanceSource)assert(maintenanceSource.startsWith(join(tmpdir(),'opencode','simple3-installed-'))&&existsSync(join(maintenanceSource,'synthetic-user-data','payroll.sqlite3')))
const session=join(tmpdir(),'opencode',`simple3-installed-${randomUUID()}`)
mkdirSync(session);const appDir=join(session,'application'),exe=join(appDir,'calculadora-nomina.exe')
const ownerRoot=join(process.env.LOCALAPPDATA,'mx.calculadoranomina.desktop')
const sha=x=>createHash('sha256').update(x).digest('hex')
const report={session,installer,installerSha256:sha(readFileSync(installer)),maintenanceSource,checks:[],failures:[],requests:[],pdfs:[]}
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const ps=(script,timeout=30000)=>execFileSync('pwsh.exe',['-NoProfile','-Command',script],{encoding:'utf8',timeout}).trim()
const quote=s=>"'"+s.replaceAll("'","''")+"'"
const checkpoint=()=>writeFileSync(join(session,'result.json'),JSON.stringify(report,null,2))
function pass(name,details={}){report.checks.push({name,status:'PASS',...details});checkpoint();console.log('PASS '+name)}
async function run(file,args=[],env=process.env){await new Promise((resolve,reject)=>{const p=spawn(file,args,{cwd:session,env,stdio:'ignore'}),timer=setTimeout(()=>reject(Error(`Timed out: ${file}`)),120000);p.once('error',reject);p.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error(`${file}: exit ${code}`))})})}
let app,ws,seq=0,isolated=false,installed=false,registryWasAbsent=false;const pending=new Map()
function call(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))})}
async function evaluate(expression){const v=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(v.exceptionDetails)throw Error(JSON.stringify(v.exceptionDetails));return v.result.value}
const invoke=(command,args={})=>evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)},${JSON.stringify(args)})`)
async function wait(expression,message,ms=15000){const until=Date.now()+ms;while(Date.now()<until){try{if(await evaluate(expression))return}catch{}await sleep(100)}throw Error(message)}
async function click(selector){await wait(`!!document.querySelector(${JSON.stringify(selector)})`,selector);await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await sleep(100)}
async function button(text,scope=''){await evaluate(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(scope+'button')})].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Button missing: '+${JSON.stringify(text)});b.click()})()`);await sleep(150)}
async function nav(text){await evaluate(`(()=>{const b=[...document.querySelectorAll('.sidebar-nav button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Nav missing');b.click()})()`);await sleep(150)}
async function value(selector,next,select=false){await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing input');Object.getOwnPropertyDescriptor(${select?'HTMLSelectElement':'HTMLInputElement'}.prototype,'value').set.call(e,${JSON.stringify(next)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`);await sleep(80)}
async function screenshot(name){const p=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(join(session,name+'.png'),Buffer.from(p.data,'base64'))}
async function launch(){
 const env={...process.env,PATH:`${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9227 --remote-debugging-address=127.0.0.1',NOMINA_STORAGE_TEST_ROOT:join(session,'must-be-ignored-in-release')}
 delete env.WEBVIEW2_USER_DATA_FOLDER;delete env.NOMINA_FISCAL_QA_BUILD_ACK
 app=spawn(exe,[],{cwd:appDir,env,stdio:'ignore'})
 let target
 for(let i=0;i<150;i++){try{target=(await(await fetch('http://127.0.0.1:9227/json/list')).json()).find(p=>p.type==='page'&&/tauri\.localhost/.test(p.url));if(target)break}catch{}if(app.exitCode!==null)throw Error('Installed application exited');await sleep(200)}
 assert(target,'No installed custom-protocol WebView')
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j})
 ws.onmessage=e=>{const x=JSON.parse(e.data);if(x.id){const p=pending.get(x.id);pending.delete(x.id);if(p)x.error?p.reject(x.error):p.resolve(x.result)}else if(x.method==='Network.requestWillBeSent')report.requests.push(x.params.request.url)}
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable')
 await call('Network.setBlockedURLs',{urls:['http://127.0.0.1:1420/*','http://localhost:1420/*','https://*']})
 await wait(`!!document.querySelector('#salary')&&!document.querySelector('.theme-indicator')?.disabled`,'Installed UI not ready')
 const storage=await invoke('storage_info');assert.equal(storage.databasePath,join(ownerRoot,'payroll.sqlite3'));assert.equal(storage.schemaVersion,4)
 assert(!existsSync(join(session,'must-be-ignored-in-release')))
 return storage
}
async function close(){
 if(ws){ws.close();ws=null}
 if(app&&app.exitCode===null){ps(`$p=Get-Process -Id ${app.pid} -ErrorAction SilentlyContinue;if($p){[void]$p.CloseMainWindow()}`);for(let i=0;i<80&&app.exitCode===null;i++)await sleep(100);if(app.exitCode===null){app.kill();await sleep(1000)}}
 app=null;await sleep(800)
}
const list=()=>invoke('storage_list',{limit:100,cursor:null})
async function consent(enabled){await nav('Historial');await wait(`!document.querySelector('.history-consent input')?.disabled`,'Consent unavailable');if(await evaluate(`document.querySelector('.history-consent input').checked`)!==enabled)await click('.history-consent input');await wait(`!document.querySelector('.history-consent input').disabled&&document.querySelector('.history-consent input').checked===${enabled}`,'Consent not committed');assert.equal((await invoke('storage_get_preferences')).historyAutoSave,enabled)}
async function calculate(period,mode,amount,includeImss=true){
 await nav('Calcular');if(await evaluate(`!!document.querySelector('.capture-summary')`))await button('Editar datos','.capture-summary-actions ')
 await evaluate(`(()=>{const b=[...document.querySelectorAll('.mode-grid button')].find(e=>e.querySelector('strong').textContent===${JSON.stringify(mode==='gross-to-net'?'Bruto a neto':'Neto a bruto')});b.click()})()`);await sleep(80)
 await value('#salary',amount);await value('#period',period,true);await click(includeImss?'#include-imss':'#exclude-imss')
 assert(!(await evaluate(`!!document.querySelector('#capture-options')`)))
 await click(includeImss?'.imss-expand-toggle':'.capture-dates-toggle')
 assert.equal(await evaluate(`!!document.querySelector('#imss-method')`),includeImss)
 if(includeImss)assert(await evaluate(`document.querySelector('#imss-method').value==='automatic'&&document.querySelector('#imss-method option[value="manual"]').disabled`))
 await click('input[name="fiscal-date-mode"][value="yes"]');await value('#effective-date','2026-02-01');await value('#payment-date','2026-02-15')
 await click(includeImss?'.imss-expand-toggle':'.capture-dates-toggle');assert(!(await evaluate(`!!document.querySelector('#effective-date')`)))
 await click('.calculate-button');await wait(`!!document.querySelector('#calculator-workspace .results-section')&&document.querySelector('#calculator-workspace .results-section').getAttribute('aria-busy')==='false'`,'Calculation did not finish',30000)
 const rows=await evaluate(`Object.fromEntries([...document.querySelector('#calculator-workspace .detail-panel').querySelectorAll('.detail-row')].map(e=>[e.querySelector('dt').textContent,e.querySelector('dd').textContent]))`)
 const raw=text=>text.replace(/[^0-9.]/g,'')
 assert(rows['Salario bruto']&&!rows['Salario bruto'].includes('—'),JSON.stringify(rows));const gross=raw(rows['Salario bruto']),net=raw(rows['Salario neto estimado'])
 const days=BigInt({weekly:7,fortnightly:15,monthly:30}[period]),daily=a=>{const c=BigInt(a.replace('.','')),s=((2n*c+days)/(2n*days)).toString().padStart(3,'0');return s.slice(0,-2)+'.'+s.slice(-2)}
 assert.equal(raw(rows['Salario diario bruto']),daily(gross));assert.equal(raw(rows['Salario diario neto']),daily(net))
 assert(await evaluate(`!!document.querySelector('#calculator-workspace .daily-net-amount')`))
 return {period,mode,includeImss,gross,net,dailyGross:daily(gross),dailyNet:daily(net)}
}
async function savePdf(file,historical=false){
 await button('Exportar PDF',historical?'.history-export-actions ':'#calculator-workspace .result-actions ')
 let saved=false,last
 for(let i=0;i<15&&!saved;i++){
  await sleep(300)
  try{execFileSync('pwsh.exe',['-NoProfile','-File',join(root,'scripts/native-pdf-dialog.ps1'),'-ProcessId',String(app.pid),'-Action','save','-FilePath',file],{encoding:'utf8',timeout:15000});saved=true}catch(e){last=e.message}
 }
 assert(saved,last);for(let i=0;i<100&&!existsSync(file);i++)await sleep(100);assert(existsSync(file),'No PDF file')
 const bytes=readFileSync(file);assert(bytes.subarray(0,8).toString().startsWith('%PDF-1.'));assert(bytes.subarray(-1024).toString().includes('%%EOF'))
 report.pdfs.push({file,bytes:bytes.length,sha256:sha(bytes)});checkpoint()
 await wait(`document.querySelector('.pdf-export-notice')?.textContent.includes('guardado en')`,'PDF save not acknowledged')
}
async function originals(){const page=await list(),result={};for(const item of page.items)result[item.executionId]=await invoke('storage_get',{executionId:item.executionId});return result}
const regKeys=['HKCU\\Software\\calculadoranomina\\Calculadora de Nómina','HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Calculadora de Nómina']
function absentRegistry(){for(const key of regKeys){let found=false;try{execFileSync('reg.exe',['query',key],{stdio:'ignore'});found=true}catch{}assert(!found,'Existing installer registration: '+key)}}
try{
 checkpoint();absentRegistry();registryWasAbsent=true
 // Close only calculator windows and its project-owned Vite server.
 ps(`Get-Process -Name 'calculadora-nomina' -ErrorAction SilentlyContinue | ForEach-Object {[void]$_.CloseMainWindow()}; Start-Sleep -Seconds 2; Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object { $_.CommandLine -like '*CalculadoraNomina*node_modules*vite*bin*vite.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }`)
 execFileSync(process.execPath,[join(root,'scripts/simple3-profile.mjs'),'begin',session],{stdio:'pipe'});isolated=true
 if(maintenanceSource){assert(!existsSync(ownerRoot));cpSync(join(maintenanceSource,'synthetic-user-data'),ownerRoot,{recursive:true,errorOnExist:true})}
 await run(installer,['/S','/D='+appDir]);installed=true;assert(existsSync(exe));pass('NSIS current-user installation',{appDir,installedExeSha256:sha(readFileSync(exe))})
 const storage=await launch(),version=await call('Browser.getVersion')
 if(maintenanceSource){
  const before=await originals(),preferences=await invoke('storage_get_preferences'),generation=(await invoke('storage_begin_write')).generation
  assert.equal(Object.keys(before).length,6)
  await close();await run(installer,['/S','/D='+appDir]);await launch()
  assert.deepEqual(await originals(),before);assert.deepEqual(await invoke('storage_get_preferences'),preferences);assert.equal((await invoke('storage_begin_write')).generation,generation)
  pass('Focused maintenance rerun: six originals, theme, consent and generation preserved');await close()
 }else{
 assert.equal((await list()).items.length,0);assert.deepEqual(await invoke('storage_get_preferences'),{theme:'light',historyAutoSave:false})
 pass('Installed embedded frontend; no dev server, Node or Rust on application PATH',{storage,origin:await evaluate('location.origin'),webview:version.product})
 const external=await invoke('fiscal_import_info',{request:{repository:false}});assert.equal(external.canImport,false)
 const blocked=await evaluate(`window.__TAURI_INTERNALS__.invoke('fiscal_import_info',{request:{repository:true}}).then(()=>({unexpected:true}),e=>e)`);assert.equal(blocked.code,'PRODUCTION_BOOTSTRAP_MISSING');pass('External fiscal routes closed',{qa:external.qa,canImport:external.canImport,code:blocked.code})
 await calculate('monthly','gross-to-net','15000.00');assert.equal((await list()).items.length,0);pass('Consent off: no salary record created')
 await consent(true)
 let count=0
 for(const [period,gross] of [['weekly','3500.00'],['fortnightly','15000.00'],['monthly','15000.00']]){
  const direct=await calculate(period,'gross-to-net',gross);for(let i=0;i<50&&(await list()).items.length<count+1;i++)await sleep(100);assert.equal((await list()).items.length,++count);pass('Gross to net '+period,direct)
  const inverse=await calculate(period,'net-to-gross',direct.net);for(let i=0;i<50&&(await list()).items.length<count+1;i++)await sleep(100);assert.equal((await list()).items.length,++count);pass('Net to gross '+period,inverse)
 }
 await screenshot('installed-results')
 const before=await originals();assert.equal(Object.keys(before).length,6)
 for(const wire of Object.values(before)){const s=JSON.parse(wire).value;assert.equal(s.schemaVersion,2);assert.equal(s.versions.application,'0.1.0');assert.equal(s.fiscalPackage.version,'mx-fiscal-2026-source-v3');assert(!Object.hasOwn(s.capture.form,'paymentDate'));assert(!Object.hasOwn(s.execution,'paymentDate'))}
 pass('Six native Snapshot v2 originals; payment date remains session-only')
 await consent(false);const generation=(await invoke('storage_begin_write')).generation
 const noDirect=await calculate('monthly','gross-to-net','15000.00',false);assert.equal(noDirect.net,'13597.18')
 const noInverse=await calculate('monthly','net-to-gross',noDirect.net,false);assert.equal(noInverse.net,noDirect.net)
 assert.equal((await list()).items.length,6);pass('IMSS No in both directions; no new records after opt-out',{noDirect,noInverse})
 await savePdf(join(session,'current.pdf'));pass('Current PDF through real Windows save dialog')
 await nav('Historial');await wait(`document.querySelectorAll('.history-entry').length===6`,'History list missing')
 const id=Object.keys(before)[0];await click(`[data-history-id="${id}"]`);await wait(`!!document.querySelector('[data-history-execution="${id}"]')`,'Original history did not open')
 await savePdf(join(session,'historical.pdf'),true);assert.deepEqual(await originals(),before);pass('Historical retrieval and PDF preserve original wire/checksums')
 await nav('Parámetros');assert(await evaluate(`document.querySelector('#parameters-workspace').textContent.includes('mx-fiscal-2026-source-v3')`));await nav('Ayuda');assert(await evaluate(`document.querySelector('#help-workspace').textContent.includes('2027')`));pass('Parameters and Help load from installed resources')
 await click('.theme-indicator');await wait(`document.documentElement.dataset.theme==='dark'&&!document.querySelector('.theme-preference-notice')`,'Dark theme failed');for(let i=0;i<40&&(await invoke('storage_get_preferences')).theme!=='dark';i++)await sleep(100)
 await close();await launch();assert.equal((await invoke('storage_get_preferences')).theme,'dark');assert.deepEqual(await originals(),before);assert.equal((await invoke('storage_begin_write')).generation,generation);pass('Installed restart preserves theme, consent, generation and all originals')
 await close();await run(installer,['/S','/D='+appDir]);await launch();assert.deepEqual(await originals(),before);assert.equal((await invoke('storage_get_preferences')).theme,'dark');assert.equal((await invoke('storage_begin_write')).generation,generation);pass('Same-version NSIS maintenance/reinstall preserves original bytes and preferences')
 await screenshot('installed-after-maintenance');await close()
 }
 const db=join(ownerRoot,'payroll.sqlite3'),dbSha=sha(readFileSync(db));await run(join(appDir,'uninstall.exe'),['/S'])
 // NSIS copies its uninstaller to TEMP and the original process returns before
 // that child removes the application. Wait for the actual postcondition.
 for(let i=0;i<150&&existsSync(exe);i++)await sleep(100)
 installed=existsSync(exe)
 assert(!existsSync(exe));assert(existsSync(db));assert.equal(sha(readFileSync(db)),dbSha);pass('Default uninstall removes app and preserves salary database')
 report.differentVersionUpgrade='NOT RUN: first authorized release is 0.1.0; no new version/producer fabricated'
 report.cleanWindowsWithoutWebView='NOT RUN: this Windows already has WebView2; embedded bootstrapper requires internet if runtime is absent'
}catch(e){report.failures.push(e.stack??String(e));checkpoint();console.error(e)}
finally{
 try{await close()}catch(e){report.failures.push('Close: '+e.message)}
 if(installed&&existsSync(join(appDir,'uninstall.exe'))){try{await run(join(appDir,'uninstall.exe'),['/S'])}catch(e){report.failures.push('Uninstall: '+e.message)}}
 if(isolated||existsSync(join(session,'owner-original-preserved'))){try{const text=execFileSync(process.execPath,[join(root,'scripts/simple3-profile.mjs'),'restore',session],{encoding:'utf8'});report.ownerRestoration=JSON.parse(text);assert(report.ownerRestoration.identical)}catch(e){report.failures.push('OWNER RESTORE: '+e.message)}}
 // No installer registration existed before this test. Remove only our key;
 // the NSIS uninstaller deliberately retains its previous-location preference.
 if(registryWasAbsent)for(const key of regKeys){try{execFileSync('reg.exe',['delete',key,'/f'],{stdio:'ignore'})}catch{}}
 checkpoint();console.log(JSON.stringify({session,checks:report.checks.length,failures:report.failures,ownerRestoration:report.ownerRestoration},null,2));process.exitCode=report.failures.length?1:0
}
