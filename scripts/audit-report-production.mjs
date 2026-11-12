import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {readFileSync,readdirSync,writeFileSync} from "node:fs"
import {fileURLToPath} from "node:url"
import {join} from "node:path"
const root=fileURLToPath(new URL("../",import.meta.url)),dist=join(root,"dist"),out=join(root,process.argv.includes("--refinement")?"docs/evidence/5b11-1":"docs/evidence/5b11"),html=readFileSync(join(dist,"index.html"),"utf8"),files=readdirSync(join(dist,"assets"))
assert.deepEqual(readdirSync(dist).filter(p=>p.endsWith(".html")),["index.html"])
assert(!/\b(?:src|href)=["'](?:https?:\/\/|\/\/)|\/dev\//.test(html))
const mainPath=html.match(/src="([^\"]+\.js)"/)[1].replace(/^\//,""),main=readFileSync(join(dist,mainPath),"utf8"),runtimeName=files.find(p=>/^export-runtime-.*\.js$/.test(p)),runtime=readFileSync(join(dist,"assets",runtimeName),"utf8")
assert(main.includes(runtimeName),"La aplicación debe cargar el generador por import diferido")
assert(!main.includes("base64,AAEAAA")&&runtime.includes("base64,AAEAAA"),"Las fuentes locales deben permanecer en el módulo diferido")
const assets=files.map(name=>{const path=join(dist,"assets",name),bytes=readFileSync(path);return{path:`dist/assets/${name}`,bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")}})
for(const item of assets.filter(a=>a.path.endsWith(".js"))){const source=readFileSync(join(root,item.path),"utf8");for(const marker of["__historyVerification","__pdfExportVerification","PRUEBA TÉCNICA 5B.10"])assert(!source.includes(marker),`Entrada QA ${marker} incluida en ${item.path}`)}
const report={checkedOn:new Date().toISOString(),status:"passed",mainPath,lazyPdfRuntime:`dist/assets/${runtimeName}`,embeddedLocalFonts:true,developmentEntriesExcluded:true,optionalUpstreamChunks:assets.filter(a=>/html2canvas|purify|index\.es-/.test(a.path)).map(a=>a.path),assets}
if(process.argv.includes("--refinement")){
 const before=JSON.parse(readFileSync(join(root,"docs/evidence/5b11/production-assets.json"),"utf8")).assets.find(a=>a.path.endsWith(".css")),current=assets.find(a=>a.path.endsWith(".css")),css=readFileSync(join(root,current.path),"utf8")
 const candidate=current.sha256===before.sha256?null:[...css.matchAll(/[^{}]+\{[^{}]*\}/g)].map(m=>m[0]).find(rule=>createHash("sha256").update(css.replace(rule,"")).digest("hex")===before.sha256)
 report.desktopCss={beforeSha256:before.sha256,afterSha256:current.sha256,identical:current.sha256===before.sha256,unexpectedRule:candidate??null}
 assert.equal(current.sha256,before.sha256,`La presentación de escritorio debe permanecer idéntica. Regla extra detectada: ${candidate??"revisar diff"}`)
}
writeFileSync(join(out,"production-assets.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
