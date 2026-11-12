import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from "node:fs"
import {join} from "node:path"
import {fileURLToPath} from "node:url"
const root=fileURLToPath(new URL("../",import.meta.url)),out=join(root,"docs/evidence/5b91"),file=join(out,"protected-baseline.json")
mkdirSync(out,{recursive:true})
const tree=d=>readdirSync(join(root,d),{withFileTypes:true}).flatMap(e=>e.isDirectory()?tree(join(d,e.name)):[join(d,e.name).replaceAll("\\","/")])
const hash=p=>createHash("sha256").update(readFileSync(join(root,p))).digest("hex")
const integration=["src/features/theme/theme-provider.tsx","src/components/layout/app-shell.tsx","src/app/themes.css","src/app/styles.css","src/features/calculator/components/capture-section.tsx"]
const paths=()=>[...tree("src"),...tree("src-tauri/src"),"package.json","package-lock.json","src-tauri/Cargo.toml","src-tauri/Cargo.lock","src-tauri/tauri.conf.json","design/UI_APROBADA.png"]
if(process.argv.includes("--before")){assert(!existsSync(file));writeFileSync(file,JSON.stringify({capturedOn:new Date().toISOString(),hashes:Object.fromEntries(paths().filter(p=>!integration.includes(p)).map(p=>[p,hash(p)])),integrationBefore:Object.fromEntries(integration.map(p=>[p,hash(p)]))},null,2))}
else{const before=JSON.parse(readFileSync(file,"utf8")),differences=Object.entries(before.hashes).filter(([p,h])=>hash(p)!==h).map(([p])=>p),report={checkedOn:new Date().toISOString(),protectedFiles:Object.keys(before.hashes).length,differences,declaredIntegration:integration.map(p=>({path:p,before:before.integrationBefore[p],after:hash(p)})),addedFiles:Object.fromEntries(paths().filter(p=>!(p in before.hashes)&&!integration.includes(p)).map(p=>[p,hash(p)]))};writeFileSync(join(out,"protected-final.json"),JSON.stringify(report,null,2));assert.deepEqual(differences,[]);console.log(JSON.stringify(report,null,2))}
