import assert from "node:assert/strict"
export async function checkPolishContrast(page,report,name){
 const result=await page.evaluate(()=>{
  const rgb=s=>s.trim().startsWith("#")?[0,2,4].map(i=>parseInt(s.trim().slice(1).slice(i,i+2),16)):s.match(/[\d.]+/g).slice(0,3).map(Number)
  const lum=c=>c.map(v=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[0.2126,0.7152,0.0722][i],0)
  const ratio=(a,b)=>{const x=lum(rgb(a)),y=lum(rgb(b));return(Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)}
  const root=getComputedStyle(document.documentElement),card=getComputedStyle(document.querySelector(".capture-section")).backgroundColor
  const fields=[...document.querySelectorAll(".capture-section .field-control")].map(e=>{const s=getComputedStyle(e);return{id:e.querySelector("input,select,output")?.id,border:s.borderColor,onField:ratio(s.borderColor,s.backgroundColor),onCard:ratio(s.borderColor,card)}})
  const choice=document.querySelector(".mode-card-selected"),s=getComputedStyle(choice),stops=s.backgroundImage.match(/rgb\([^)]*\)/g)
  const options=[...document.querySelectorAll("#period option")].map(e=>{const s=getComputedStyle(e);return{value:e.value,foreground:s.color,background:s.backgroundColor,ratio:ratio(s.color,s.backgroundColor)}})
  const button=getComputedStyle(document.querySelector(".theme-indicator")),error=document.querySelector(".field-error")
  return{fields,options,selectedModeBorder:s.borderColor,selectedModeMinimum:Math.min(...stops.map(c=>ratio(s.borderColor,c))),focusOnCard:ratio(root.getPropertyValue("--ring"),card),buttonText:ratio(button.color,button.backgroundColor),errorText:error?ratio(getComputedStyle(error).color,card):null}
 })
 report.contrast.push({name,...result});for(const f of result.fields)assert(f.onField>=3&&f.onCard>=3,`Borde ${name}: ${f.id}`);assert(result.selectedModeMinimum>=3,`Selección ${name}`);assert(result.focusOnCard>=3);assert(result.buttonText>=4.5);for(const o of result.options){assert(!o.background.startsWith("rgba(0, 0, 0, 0)"));assert(o.ratio>=4.5,`Opción ${name}: ${o.value}`)}if(result.errorText!==null)assert(result.errorText>=4.5)
}
