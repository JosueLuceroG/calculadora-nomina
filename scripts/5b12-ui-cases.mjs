import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
const money=s=>{const value=s.replace(/\$|,|\s/g,'').replace('−','-');return value==='—'?null:value}
async function values(p){return{primary:money(await p.locator('#calculator-workspace .primary-amount').innerText()),isr:money(await p.locator('#calculator-workspace .summary-isr .summary-copy p').innerText()),imss:money(await p.locator('#calculator-workspace .summary-imss .summary-copy p').innerText()),secondary:money(await p.locator('#calculator-workspace .summary-net .summary-copy p').innerText())}}
export async function checkFiscalUi(h){
 const p=h.page,fixture=JSON.parse(readFileSync(join(h.root,'src/tests/fixtures/operational-4b1.expected.json'),'utf8'))
 assert.equal(await p.locator('#bonus-days').inputValue(),'15');assert.equal(await p.locator('#vacation-days').inputValue(),'12');assert.equal(await p.locator('#vacation-premium').inputValue(),'25');assert(await p.locator('#include-imss').isChecked())
 assert(await p.locator('input[name=fiscal-date-mode][value=no]').isChecked());assert.equal(await p.locator('#effective-date').getAttribute('data-reference-date'),await p.evaluate(()=>{const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}))
 for(const c of fixture.direct){
  const r=c.request;await h.fill({amount:r.gross,period:r.periodicity,date:r.date,imss:r.includeImss,bonus:r.benefits.annualBonusDays,vacation:r.benefits.annualVacationDays,premium:r.benefits.vacationPremiumPercent});await h.calculate()
  if(r.confirmed){await p.locator('#minimum-month-ack').check();await p.getByRole('button',{name:'Recalcular con hipótesis',exact:true}).click();await p.waitForFunction(()=>document.querySelector('#calculator-workspace .results-section').getAttribute('aria-busy')==='false'&&document.querySelector('.primary-amount').textContent.trim()!=='—')}
  const got=await values(p),expected=c.expected.components;assert.deepEqual({net:got.primary,gross:got.secondary,isr:got.isr,imss:got.imss},{net:expected.net,gross:expected.gross,isr:expected.isrWithheld,imss:expected.imssDeducted},c.id)
  h.report.fiscal.push({id:c.id,family:c.family,source:'native-integrated-real-engine',expected:{net:expected.net,isr:expected.isrWithheld,imss:expected.imssDeducted},obtained:got,differences:[]})
 }
 h.report.checks.push('20 directos M01–M08 en Windows integrado: periodos, vigencias, prestaciones, mínimo/hipótesis, subsidio, IMSS y desconocidos coinciden con controles independientes')
 for(const c of fixture.inverse.filter(c=>!c.request.domain)){
  const r=c.request;await h.fill({mode:'net-to-gross',amount:r.targetNet,period:r.periodicity,date:r.date,imss:r.includeImss,bonus:r.benefits.annualBonusDays,vacation:r.benefits.annualVacationDays,premium:r.benefits.vacationPremiumPercent});await h.calculate()
  if(r.confirmed){await p.locator('#minimum-month-ack').check();await p.getByRole('button',{name:'Recalcular con hipótesis',exact:true}).click();await p.waitForFunction(()=>document.querySelector('#calculator-workspace .results-section').getAttribute('aria-busy')==='false'&&document.querySelector('.primary-amount').textContent.includes('9,451.20'))}
  const got=await values(p);assert.equal(got.primary,c.expectedCandidates[0].gross,c.id);assert.equal(got.secondary,r.targetNet,c.id)
  await p.locator('#calculator-workspace .fiscal-insights > summary').click();const alternative=p.locator('.verified-alternatives > summary');if(await alternative.count())await alternative.click();const text=await p.locator('#calculator-workspace .results-section').innerText();for(const candidate of c.expectedCandidates)assert(text.includes(candidate.gross.replace(/\B(?=(\d{3})+(?!\d))/g,','))||text.includes(candidate.gross),c.id+' candidato '+candidate.gross)
  if(c.id==='M11-unconfirmed')assert((await p.locator('.primary-result h3').innerText()).includes('encontrado'))
  h.report.fiscal.push({id:c.id,family:c.family,source:'native-integrated-real-engine',obtained:got,candidates:c.expectedCandidates.map(e=>e.gross),state:await p.locator('#calculator-workspace .results-section').getAttribute('data-result-state'),differences:[]})
 }
 h.report.checks.push('M09–M11 inversos reales conservan alternativas y garantías; M12 acotado se verifica en matriz independiente y snapshot controlado, sin controles técnicos añadidos al producto')
 assert.equal((await h.rows()).length,0)
 await h.screenshot('fiscal-inverse')
}
export async function checkExperience(h){
 let p=h.page
 await h.fill({amount:'15000.50',bonus:'18.50',vacation:'20.25',premium:'30.50',imss:false,date:'2026-01-31'})
 const salary=p.locator('#salary');await salary.focus();await salary.press('End');await p.keyboard.type('0');assert.equal(await salary.inputValue(),'15,000.500');await salary.press('Home');await salary.press('ArrowRight');await salary.press('Shift+ArrowRight')
 const selection=await salary.evaluate(e=>[e.selectionStart,e.selectionEnd]);await h.nav('Historial').click();await h.nav('Parámetros').click();await h.nav('Ayuda').click();await h.nav('Calcular').click();assert.deepEqual(await salary.evaluate(e=>[e.selectionStart,e.selectionEnd]),selection)
 await salary.focus();await salary.press('Control+Z');assert.equal(await salary.inputValue(),'15,000.50');await salary.press('Control+Y');assert.equal(await salary.inputValue(),'15,000.500');await salary.press('Enter');assert(await p.locator('#salary-error').isVisible());await salary.press('Control+Z')
 assert.equal(await p.locator('#bonus-days').inputValue(),'18.50');assert(await p.locator('#exclude-imss').isChecked());await h.fill();await h.calculate();const before=await values(p)
 await h.nav('Parámetros').click();const links=[]
 for(const label of ['Tarifas ISR','UMA','Salarios mínimos','Subsidio al empleo','Cuotas IMSS','Prestaciones','Criterios del simulador']){
  await p.getByRole('button',{name:label,exact:true}).click()
  if(label==='Tarifas ISR')for(const period of ['Semanal','Quincenal','Mensual']){await p.locator('.parameter-periods').getByRole('button',{name:period,exact:true}).click();assert.equal(await p.locator('#isr-tariff-table tbody tr').count(),11)}
  if(label==='Salarios mínimos')assert((await p.locator('.parameter-review-note').innerText()).includes('no está resuelto'))
  for(const summary of await p.locator('.parameter-sources > summary').all())await summary.click()
  links.push(...await p.locator('[data-official-source]').evaluateAll(els=>els.map(e=>({href:e.getAttribute('href'),data:e.getAttribute('data-official-source'),rel:e.getAttribute('rel')}))))
 }
 assert(links.length>=10);assert(links.every(l=>l.href===l.data&&l.href.startsWith('https://')&&l.rel.includes('noopener')));h.report.officialLinks=links
 const rejected=await p.evaluate(async()=>{try{await window.__TAURI_INTERNALS__.invoke('open_official_source',{url:'https://example.com/'});return false}catch{return true}});assert(rejected)
 await h.nav('Ayuda').click();assert(await p.locator('#help-title').isVisible());const summaries=p.locator('#help-workspace details > summary');assert(await summaries.count()>3);await summaries.first().focus();await p.keyboard.press('Enter');await p.keyboard.press('Space')
 await p.locator('#help-topic-isr > summary').click();await p.locator('#help-topic-isr [data-help-parameter=isr]').click();assert.equal(await h.nav('Parámetros').getAttribute('aria-current'),'page')
 await h.nav('Calcular').click();assert.deepEqual(await values(p),before);await p.locator('#calculator-workspace .fiscal-insights > summary').focus();await p.keyboard.press('Enter');await p.locator('#calculator-workspace .technical-result-details > summary').focus();await p.keyboard.press('Space');assert((await p.locator('.technical-result-body').innerText()).includes('mx-fiscal-2026-source-v3'))
 h.report.checks.push('Máscara monetaria, selección y undo/redo, validación, cuatro secciones, detalles y enlaces oficiales preservan estado y valores; enlaces externos enumerados y rechazo de origen no oficial probado sin abrir navegador personal')
 await h.calculator()
 for(const theme of ['light','dark']){
  const toggle=p.locator('.theme-indicator');assert.equal(await toggle.count(),1);if(await toggle.getAttribute('data-theme')!==theme){await toggle.focus();await p.keyboard.press(theme==='dark'?'Space':'Enter');await p.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme)}
  for(const[width,height]of[[1180,760],[900,600]]){h.native('resize',['-Width',String(width),'-Height',String(height)]);await p.waitForFunction(w=>innerWidth===w,width);await h.measure(`capture-${theme}-${width}`);await h.screenshot(`capture-${theme}-${width}`)}
  const select=p.locator('#period');await select.focus();await p.keyboard.press('Alt+ArrowDown');await h.delay(300)
  const popup=JSON.parse(execFileSync('pwsh',['-NoProfile','-File',join(h.root,'scripts/native-theme-popup.ps1'),'-ProcessId',String(h.native().pid),'-OutputPath',join(h.out,`period-popup-${theme}.png`)],{encoding:'utf8',timeout:30000}));h.report.metrics.push({name:`period-popup-${theme}`,native:popup});await p.keyboard.press('Escape')
  assert(popup.captured,'Debe capturarse el selector nativo abierto');await select.focus();await p.keyboard.press('Home');await p.keyboard.press('ArrowDown');await p.keyboard.press('Enter');assert.equal(await select.inputValue(),'weekly')
 }
 h.native('resize',['-Width','1180','-Height','760']);await p.waitForFunction(()=>innerWidth===1180)
 const cdp=await p.context().newCDPSession(p)
 for(const scale of [1,1.5]){await cdp.send('Emulation.setDeviceMetricsOverride',{width:1180,height:760,deviceScaleFactor:scale,mobile:false});h.report.metrics.push({...await h.measure(`emulated-dpr-${scale}`),kind:'WebView CDP emulation; monitor DPI unchanged'});await p.screenshot({path:join(h.out,`emulated-dpr-${scale}.png`)})}await cdp.send('Emulation.clearDeviceMetricsOverride');await cdp.detach()
 h.report.checks.push('Ventana Windows real 1180×760/900×600, Claro/Oscuro por botón único, teclado y selector nativo abierto; DPR 1/1.5 son emulaciones complementarias, no cambios físicos de DPI')
 await p.evaluate(()=>{const Real=Date;window.__realQaDate=Real;window.__qaClock=new Real(2026,0,31,23,59,58).getTime();window.Date=class extends Real{constructor(...a){if(a.length)super(...a);else super(window.__qaClock)}static now(){return window.__qaClock}}})
 await p.getByRole('button',{name:'Limpiar',exact:true}).click();assert.equal(await p.locator('#effective-date').getAttribute('data-reference-date'),'2026-01-31');await p.getByRole('button',{name:/Bruto a neto/}).click();await salary.fill('10000.00');await p.locator('#period').selectOption('monthly')
 await p.evaluate(()=>window.__qaClock=new window.__realQaDate(2026,1,1,0,0,3).getTime());await salary.press('Enter');assert((await p.locator('#effective-date-error').innerText()).includes('Cambió el día'));await p.getByRole('button',{name:'Usar fecha de hoy',exact:true}).click();await h.calculate();assert.equal((await values(p)).primary,'9557.42')
 await h.calculator();assert.equal(await p.locator('#effective-date').getAttribute('data-reference-date'),'2026-02-01');await p.evaluate(()=>window.__qaClock=new window.__realQaDate(2027,0,1,12).getTime());await p.getByRole('button',{name:'Limpiar',exact:true}).click();assert.equal(await p.locator('#effective-date').getAttribute('data-reference-date'),'2027-01-01');assert(await p.locator('button[type=submit]').isDisabled());assert((await p.locator('#effective-date-error').innerText()).includes('No hay parámetros'))
 await p.locator('input[name=fiscal-date-mode][value=yes]').check();await p.locator('#effective-date').fill('2026-01-31');await p.getByRole('button',{name:/Bruto a neto/}).click();await salary.fill('10000.00');await p.locator('#period').selectOption('monthly');await h.calculate();assert.equal((await values(p)).primary,'9556.74')
 h.report.checks.push('Cambio de día enero/febrero y año sin cobertura verificados con reloj simulado explícito en WebView integrado; bloqueo antes de cálculo y fecha manual histórica preservada')
 await p.reload({waitUntil:'networkidle'});await p.waitForFunction(()=>!document.querySelector('button[type=submit]')?.disabled);await p.getByRole('button',{name:'Limpiar',exact:true}).click();assert.equal(await p.locator('#salary').inputValue(),'');assert.equal(await p.locator('#period').inputValue(),'');assert.equal(await p.locator('#bonus-days').inputValue(),'15');assert(await p.locator('#include-imss').isChecked());assert(await p.locator('input[name=fiscal-date-mode][value=no]').isChecked())
 await h.fill({mode:'net-to-gross',amount:'13202.64',bonus:'365000000'});await h.calculate(false);await p.getByRole('button',{name:'Cancelar',exact:true}).click();await p.waitForFunction(()=>document.querySelector('#calculator-workspace .results-section')?.dataset.resultState==='cancelled');assert(await p.locator('#calculator-workspace').getByRole('button',{name:'Exportar PDF',exact:true}).isDisabled());assert.equal((await h.rows()).length,0)
 h.report.checks.push('Limpiar restaura plantilla/IMSS/fecha automática; cancelación real conserva captura y bloquea exportación, sin guardado sin consentimiento')
}
