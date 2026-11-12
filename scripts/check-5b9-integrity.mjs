import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from "node:fs"
import {join} from "node:path"
import {fileURLToPath} from "node:url"
const root=fileURLToPath(new URL("../",import.meta.url)),out=join(root,"docs/evidence/5b9"),baseline=join(out,"protected-baseline.json")
mkdirSync(out,{recursive:true})
const tree=dir=>readdirSync(join(root,dir),{withFileTypes:true}).flatMap(e=>e.isDirectory()?tree(join(dir,e.name)):[join(dir,e.name).replaceAll("\\","/")])
const hash=p=>createHash("sha256").update(readFileSync(join(root,p))).digest("hex")
const integration=["src/app/App.tsx","src/app/styles.css","src/components/layout/app-shell.tsx","src/features/history/historical-results.tsx","src/dev/history-verification.tsx","src-tauri/src/lib.rs"]
const paths=()=>[...tree("src"),...tree("src-tauri/src"),"package.json","package-lock.json","src-tauri/Cargo.toml","src-tauri/Cargo.lock","src-tauri/tauri.conf.json","design/UI_APROBADA.png"]
if(process.argv.includes("--before")){assert(!existsSync(baseline));writeFileSync(baseline,JSON.stringify({capturedOn:new Date().toISOString(),hashes:Object.fromEntries(paths().filter(p=>!integration.includes(p)).map(p=>[p,hash(p)])),integrationBefore:Object.fromEntries(integration.map(p=>[p,hash(p)]))},null,2))}
else{const before=JSON.parse(readFileSync(baseline,"utf8")),protectedEntries=Object.entries(before.hashes),differences=protectedEntries.filter(([p,h])=>hash(p)!==h).map(([p])=>p),report={checkedOn:new Date().toISOString(),protectedFiles:protectedEntries.length,differences,declaredIntegration:integration.map(p=>({path:p,before:before.integrationBefore[p],after:hash(p)})),addedFiles:Object.fromEntries(paths().filter(p=>!(p in before.hashes)&&!integration.includes(p)).map(p=>[p,hash(p)]))};writeFileSync(join(out,"protected-final.json"),JSON.stringify(report,null,2));assert.deepEqual(differences,[]);console.log(JSON.stringify(report,null,2))}
