import assert from "node:assert/strict"

/** Colores renderizados, no una repetición del mapa de tokens. Los gradientes
 * se evalúan en sus extremos; las transparencias se componen con los ancestros. */
export async function checkContrast(page,report,name){
 const result=await page.evaluate(()=>{
  const ctx=document.createElement("canvas").getContext("2d",{willReadFrequently:true})
  function rgba(css){ctx.clearRect(0,0,1,1);ctx.fillStyle=css;ctx.fillRect(0,0,1,1);const p=ctx.getImageData(0,0,1,1).data;return[p[0],p[1],p[2],p[3]/255]}
  const composite=(a,b)=>a.slice(0,3).map((c,i)=>c*a[3]+b[i]*(1-a[3]))
  const parent=e=>e.parentElement??e.getRootNode().host
  function backgrounds(e){if(!e)return[rgba(getComputedStyle(document.documentElement).getPropertyValue("--background"))];const s=getComputedStyle(e),behind=backgrounds(parent(e)),base=rgba(s.backgroundColor),stops=[...s.backgroundImage.matchAll(/rgba?\([^)]*\)/g)].map(m=>rgba(m[0]));return(stops.length?stops:[base]).flatMap(f=>behind.map(b=>composite(f,composite(base,b))))}
  const luminance=rgb=>rgb.slice(0,3).map(c=>{const v=c/255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[0.2126,0.7152,0.0722][i],0)
  const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)}
  const texts=[]
  function scan(root){const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);for(let n=walker.nextNode();n;n=walker.nextNode()){const e=n.parentElement;if(!e||!n.textContent.trim()||e.closest("script,style,.sr-only")||e.matches(":disabled")||e.closest("button:disabled"))continue;const range=document.createRange();range.selectNodeContents(n);if(!range.getBoundingClientRect().width||!e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))continue;const s=getComputedStyle(e),large=parseFloat(s.fontSize)>=24||(parseFloat(s.fontSize)>=18.66&&parseInt(s.fontWeight)>=700),bg=backgrounds(e),actual=Math.min(...bg.map(b=>ratio(composite(rgba(s.color),b),b)));texts.push({text:n.textContent.trim().slice(0,75),color:s.color,ratio:actual,required:large?3:4.5})}for(const e of root.querySelectorAll("*"))if(e.shadowRoot)scan(e.shadowRoot)}
  scan(document.body)
  // Inputs tienen valor/placeholder, no nodos de texto.
  for(const e of document.querySelectorAll("input:not([type=checkbox]):not([type=radio]),select")){if(!e.checkVisibility()||e.disabled)continue;const s=getComputedStyle(e),bg=backgrounds(e);texts.push({text:`Control ${e.id}`,color:s.color,ratio:Math.min(...bg.map(b=>ratio(composite(rgba(s.color),b),b))),required:4.5})}
  const root=getComputedStyle(document.documentElement),focus=rgba(root.getPropertyValue("--ring")),card=rgba(root.getPropertyValue("--card")),control=rgba(root.getPropertyValue("--control-fill")),border=rgba(root.getPropertyValue("--input"))
  return{textCount:texts.length,minimumText:Math.min(...texts.map(t=>t.ratio)),failures:texts.filter(t=>t.ratio+0.02<t.required),focusOnCard:ratio(focus,card),focusOnControl:ratio(focus,control),controlBorderOnCard:ratio(border,card),controlBorderOnField:ratio(border,control)}
 })
 report.contrast.push({name,...result});assert.deepEqual(result.failures,[],`Contraste de texto ${name}`);assert(result.focusOnCard>=3&&result.focusOnControl>=3,`Foco visible ${name}`)
 if(await page.locator("html").getAttribute("data-theme")==="dark")assert(result.controlBorderOnCard>=3&&result.controlBorderOnField>=3,`Controles Oscuro ${name}`)
}
