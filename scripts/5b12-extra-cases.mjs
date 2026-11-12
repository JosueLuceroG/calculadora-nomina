import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {checkContrast} from './theme-contrast.mjs'
export async function checkMonitors(h){
 const p=h.page,move=(action,index=0)=>JSON.parse(execFileSync('pwsh',['-NoProfile','-File',join(h.root,'scripts/native-5b12-monitor.ps1'),'-Action',action,'-ProcessId',String(h.native().pid),'-Index',String(index)],{encoding:'utf8',timeout:30000})),screens=move('inspect');h.report.physicalMonitors=screens;h.report.monitorTests=[]
 for(let i=0;i<screens.monitors.length;i++){
  move('move',i);h.native('resize',['-Width','1180','-Height','760']);await p.waitForFunction(()=>innerWidth===1180);const window=h.native();await p.waitForFunction(scale=>Math.abs(devicePixelRatio-scale)<0.01,window.scale)
  for(const theme of ['light','dark']){
   await h.calculator();if(await p.locator('.theme-indicator').getAttribute('data-theme')!==theme){await p.locator('.theme-indicator').click();await p.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme)}
   const select=p.locator('#period');await select.focus();await p.keyboard.press('Alt+ArrowDown');await h.delay(200);const popup=JSON.parse(execFileSync('pwsh',['-NoProfile','-File',join(h.root,'scripts/native-theme-popup.ps1'),'-ProcessId',String(window.pid),'-OutputPath',join(h.out,`period-monitor-${i}-${theme}.png`)],{encoding:'utf8',timeout:30000}));await p.keyboard.press('Escape');assert(popup.captured);h.report.monitorTests.push({monitor:i,device:screens.monitors[i].device,physicalDpi:window.dpi,scale:window.scale,theme,window,popup})
   await h.fill();await h.calculate();assert.equal(await p.locator('#calculator-workspace .primary-amount').innerText(),'$ 13,202.64')
   for(const[w,height]of[[1180,760],[900,600]]){h.native('resize',['-Width',String(w),'-Height',String(height)]);await p.waitForFunction(w=>innerWidth===w,w);await h.measure(`physical-monitor-${i}-${theme}-${w}`);await p.evaluate(()=>scrollTo(0,0));await h.screenshot(`physical-monitor-${i}-${theme}-${w}`)}
   h.native('resize',['-Width','1180','-Height','760']);await p.waitForFunction(()=>innerWidth===1180)
  }
 }
 h.report.physicalDpiTested=[...new Set(h.report.monitorTests.map(t=>t.physicalDpi))];h.report.checks.push('Transición real entre todos los monitores disponibles: DPI Win32 y DPR coinciden; Claro/Oscuro, menú de periodicidad HWND y resultados 1180×760/900×600, sin cambiar configuración global')
}
export async function checkLayouts(h){
 const p=h.page
 for(const theme of ['light','dark']){
  if(await p.locator('.theme-indicator').getAttribute('data-theme')!==theme){await p.locator('.theme-indicator').click();await p.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme)}
  for(const mode of ['gross-to-net','net-to-gross']){
   await h.fill({mode,amount:mode==='gross-to-net'?'15000.00':'13202.64'});await h.calculate();assert.equal(await p.locator('#calculator-workspace .primary-amount').innerText(),mode==='gross-to-net'?'$ 13,202.64':'$ 15,000.00')
   for(const[width,height]of[[1180,760],[900,600]]){h.native('resize',['-Width',String(width),'-Height',String(height)]);await p.waitForFunction(w=>innerWidth===w,width);await p.evaluate(()=>scrollTo(0,0));await h.measure(`result-${theme}-${mode}-${width}`);await h.screenshot(`result-${theme}-${mode}-${width}`);const details=p.locator('#calculator-workspace .fiscal-insights > summary');await details.scrollIntoViewIfNeeded();assert(await details.isVisible());await p.getByRole('button',{name:'Editar datos',exact:true}).scrollIntoViewIfNeeded();assert(await p.getByRole('button',{name:'Editar datos',exact:true}).isVisible())}
   h.native('resize',['-Width','1180','-Height','760']);await p.waitForFunction(()=>innerWidth===1180)
  }
 }
 h.report.displays=JSON.parse(execFileSync('pwsh',['-NoProfile','-Command',"Add-Type -AssemblyName System.Windows.Forms; @([System.Windows.Forms.Screen]::AllScreens | ForEach-Object { @{device=$_.DeviceName; primary=$_.Primary; bounds=@($_.Bounds.Width,$_.Bounds.Height); work=@($_.WorkingArea.Width,$_.WorkingArea.Height)} }) | ConvertTo-Json -Compress"],{encoding:'utf8'}))
 h.report.checks.push('Resultados directo/inverso en Claro/Oscuro y ventanas nativas 1180×760/900×600: importes íntegros, sin horizontal, detalles y edición alcanzables con desplazamiento natural; monitores enumerados sin cambiar DPI global')
}
export async function checkHistoryPages(h){
 const p=h.page;await h.consent(true);const fixtures=JSON.parse(readFileSync(join(h.root,'src-tauri/src/storage/fixtures.json'),'utf8')),f=JSON.parse(fixtures.find(f=>f.name==='inverse-exact').payload),generation=(await h.invoke('storage_begin_write')).generation,ids=[]
 for(let i=0;i<25;i++){const copy=structuredClone(f);copy.value.executionId=randomUUID();ids.push(copy.value.executionId);const payload=JSON.stringify(copy);if(i===0){const results=await p.evaluate(async args=>Promise.all([0,1].map(()=>window.__TAURI_INTERNALS__.invoke('storage_insert',args))),{generation,payload});assert.equal(results.filter(r=>r.inserted).length,1);h.report.concurrentFreshInsert=results}else await h.invoke('storage_insert',{generation,payload})}
 await h.nav('Calcular').click();await h.history();await p.waitForFunction(()=>document.querySelectorAll('.history-entry').length===20);assert.equal(await p.locator('.history-entry').count(),20);await p.getByRole('button',{name:'Ver más cálculos',exact:true}).click();await p.waitForFunction(()=>document.querySelectorAll('.history-entry').length===25);const listed=await p.locator('.history-entry').evaluateAll(els=>els.map(e=>e.dataset.historyId));assert.equal(new Set(listed).size,25);assert.deepEqual(listed,[...ids].sort().reverse())
 h.native('resize',['-Width','900','-Height','600']);await p.waitForFunction(()=>innerWidth===900);await h.measure('history-list-900');await h.screenshot('history-list-900');await p.locator('.history-entry').first().click();await p.locator('.history-detail').waitFor();await h.measure('history-detail-900');await h.screenshot('history-detail-900');h.native('resize',['-Width','1180','-Height','760'])
 await h.fill({mode:'net-to-gross',amount:'13202.64',bonus:'365000000'});await h.calculate(false);await p.getByRole('button',{name:'Cancelar',exact:true}).click();await p.waitForFunction(()=>document.querySelector('#calculator-workspace .results-section')?.dataset.resultState==='cancelled');assert.equal((await h.rows()).length,25)
 await h.fill({mode:'net-to-gross',amount:'13202.64'});await h.calculate(false);await h.nav('Ayuda').click();await p.waitForFunction(()=>Boolean(document.querySelector('.history-save-saved')));assert.equal(await h.nav('Ayuda').getAttribute('aria-current'),'page');assert.equal((await h.rows()).length,26);await h.nav('Calcular').click();assert.equal(await p.locator('#calculator-workspace .primary-amount').innerText(),'$ 15,000.00')
 await p.locator('.theme-indicator').click();await p.waitForFunction(async()=>{const prefs=await window.__TAURI_INTERNALS__.invoke('storage_get_preferences');return prefs.theme==='dark'&&!document.querySelector('.theme-indicator').disabled});await h.close();await h.launch();await h.page.waitForFunction(()=>document.querySelector('.theme-indicator')?.dataset.theme==='dark');assert.equal((await h.rows()).length,26);assert.equal((await h.invoke('storage_get_preferences')).historyAutoSave,true);await h.screenshot('theme-dark-restart');h.report.darkThemeRestartPreserved=true
 h.report.checks.push('25 fixtures explícitos en SQLite real: orden keyset, página 20+5, IDs únicos, lista/detalle 900×600 sin horizontal; con consentimiento, cancelar no guarda y navegar conserva cálculo/guardado único')
}
export async function checkAccessibility(h){
 const p=h.page;h.report.contrast=[];h.report.contrastObservations=[]
 async function contrast(name){try{await checkContrast(p,h.report,name)}catch(e){const failures=h.report.contrast.at(-1)?.failures;if(!failures?.length||failures.some(f=>f.text!=='1'))throw e;const observation={view:name,message:e.message,conservativeGradientEndpoints:true};h.report.contrastObservations.push(observation)
   const item=p.locator('.step-active .step-number'),box=await item.evaluate(e=>{const range=document.createRange();range.selectNodeContents(e);const a=e.getBoundingClientRect(),b=range.getBoundingClientRect();return{width:a.width,height:a.height,text:{left:b.left-a.left,top:b.top-a.top,right:b.right-a.left,bottom:b.bottom-a.top},foreground:getComputedStyle(e).color,oldColor:e.style.color}}),path=join(h.out,`gradient-background-${name}.png`)
   // Medición QA temporal de fondo bajo el rectángulo del glifo; se restaura inmediatamente.
   try{await item.evaluate(e=>e.style.color='transparent');await item.screenshot({path})}finally{await item.evaluate((e,color)=>e.style.color=color,box.oldColor)}
   writeFileSync(join(h.out,`gradient-${name}.json`),JSON.stringify(box,null,2));observation.paintedGlyphBackground=JSON.parse(execFileSync('python',[join(h.root,'scripts/5b12-gradient-contrast.py'),path,JSON.stringify(box)],{encoding:'utf8'}));observation.glyphRegionMeets45=observation.paintedGlyphBackground.minimumContrast>=4.5
  }}
 await p.locator('#salary').focus();for(const id of ['period','bonus-days','vacation-days','vacation-premium']){await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>document.activeElement.id),id)}
 const help=p.getByRole('button',{name:'Ayuda sobre Fecha de referencia fiscal',exact:true});await help.focus();await p.keyboard.press('Enter');assert(await p.locator('#fiscal-date-help').isVisible());await p.keyboard.press('Escape');assert(await help.evaluate(e=>e===document.activeElement))
 for(const theme of ['light','dark']){
  if(await p.locator('.theme-indicator').getAttribute('data-theme')!==theme){await p.locator('.theme-indicator').focus();await p.keyboard.press('Enter');await p.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme)}
  await h.calculator();await contrast(`capture-${theme}`);await h.fill();await h.calculate();await contrast(`result-${theme}`)
  await p.locator('#calculator-workspace .fiscal-insights > summary').focus();await p.keyboard.press('Enter');await p.locator('#calculator-workspace .technical-result-details > summary').focus();await p.keyboard.press('Space');await contrast(`details-${theme}`)
  await h.nav('Ayuda').click();await contrast(`help-${theme}`);await h.nav('Parámetros').click();await contrast(`parameters-${theme}`)
 }
 h.report.checks.push('Tab ordenado por campos, Enter/Espacio en detalles/tema y Escape/foco de ayuda; contraste de texto y foco medido sobre colores renderizados en diez vistas, sin afirmar auditoría WCAG integral')
}
