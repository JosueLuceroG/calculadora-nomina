import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from "node:fs"
import {join} from "node:path"
import {fileURLToPath} from "node:url"
const root=fileURLToPath(new URL("../",import.meta.url)),out=join(root,"docs/evidence/5b12"),file=join(out,"product-baseline.json")
const tree=d=>existsSync(join(root,d))?readdirSync(join(root,d),{withFileTypes:true}).flatMap(e=>e.isDirectory()?tree(join(d,e.name)):[join(d,e.name).replaceAll("\\","/")]):[]
const paths=()=>[...tree("src"),...tree("src-tauri/src"),...tree("dist"),...tree("src-tauri/capabilities"),"package.json","package-lock.json","src-tauri/Cargo.toml","src-tauri/Cargo.lock","src-tauri/tauri.conf.json","vite.config.ts","design/UI_APROBADA.png","src-tauri/target/debug/calculadora-nomina.exe",...['embedded-calcular.pdf','embedded-historial.pdf','embedded-alternativas.pdf'].map(n=>`docs/evidence/5b11-1/${n}`)]
const hash=p=>createHash("sha256").update(readFileSync(join(root,p))).digest("hex")
mkdirSync(out,{recursive:true})
if(process.argv.includes("--before")){assert(!existsSync(file));const result={capturedOn:new Date().toISOString(),hashes:Object.fromEntries(paths().map(p=>[p,hash(p)]))};writeFileSync(file,JSON.stringify(result,null,2));console.log(JSON.stringify({status:"captured",protectedFiles:Object.keys(result.hashes).length,executableSha256:result.hashes['src-tauri/target/debug/calculadora-nomina.exe']}))}
else{const before=JSON.parse(readFileSync(file,"utf8")),differences=Object.entries(before.hashes).filter(([p,h])=>!existsSync(join(root,p))||hash(p)!==h).map(([p])=>p),addedProductFiles=paths().filter(p=>!(p in before.hashes)),result={checkedOn:new Date().toISOString(),protectedFiles:Object.keys(before.hashes).length,differences,addedProductFiles,executableSha256:hash('src-tauri/target/debug/calculadora-nomina.exe')};writeFileSync(join(out,"product-integrity.json"),JSON.stringify(result,null,2));assert.deepEqual(differences,[]);assert.deepEqual(addedProductFiles,[]);console.log(JSON.stringify(result,null,2))}
