import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {copyFileSync,existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from "node:fs"
import {join} from "node:path"
import {fileURLToPath} from "node:url"
const root=fileURLToPath(new URL("../",import.meta.url)),out=join(root,"docs/evidence/5b11-1"),file=join(out,"protected-baseline.json")
const editable=["src/features/pdf/report-model.ts","src/features/pdf/render-report.ts","src/features/pdf/report.test.tsx"]
const tree=d=>readdirSync(join(root,d),{withFileTypes:true}).flatMap(e=>e.isDirectory()?tree(join(d,e.name)):[join(d,e.name).replaceAll("\\","/")])
const paths=()=>[...tree("src"),...tree("src-tauri/src"),"package.json","package-lock.json","src-tauri/Cargo.toml","src-tauri/Cargo.lock","src-tauri/tauri.conf.json","vite.config.ts","design/UI_APROBADA.png"]
const hash=p=>createHash("sha256").update(readFileSync(join(root,p))).digest("hex")
mkdirSync(out,{recursive:true})
if(process.argv.includes("--before")){
 assert(!existsSync(file),"El baseline no se sustituye")
 mkdirSync(join(out,"anterior"),{recursive:true})
 const previous=["embedded-calcular.pdf","embedded-historial.pdf","native-alternativas.pdf"].map(name=>{const path=`docs/evidence/5b11/${name}`,sha256=hash(path);copyFileSync(join(root,path),join(out,"anterior",name));return{name,sha256,path:`docs/evidence/5b11-1/anterior/${name}`}})
 writeFileSync(file,JSON.stringify({capturedOn:new Date().toISOString(),editable,hashes:Object.fromEntries(paths().map(p=>[p,hash(p)])),previous},null,2))
 console.log(JSON.stringify({status:"captured",previous},null,2))
}else{
 const before=JSON.parse(readFileSync(file,"utf8")),differences=Object.entries(before.hashes).filter(([p,h])=>!editable.includes(p)&&hash(p)!==h).map(([p])=>p)
 const report={checkedOn:new Date().toISOString(),protectedFiles:Object.keys(before.hashes).filter(p=>!editable.includes(p)).length,differences,modifiedPdfFiles:editable.map(path=>({path,before:before.hashes[path],after:hash(path)})),addedFiles:paths().filter(p=>!(p in before.hashes)),previous:before.previous.map(p=>({...p,preserved:hash(p.path)===p.sha256}))}
 writeFileSync(join(out,"protected-final.json"),JSON.stringify(report,null,2));assert.deepEqual(differences,[]);assert(report.previous.every(p=>p.preserved));console.log(JSON.stringify(report,null,2))
}
