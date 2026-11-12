import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import assert from "node:assert/strict"
const root=fileURLToPath(new URL("../",import.meta.url)),out=join(root,"docs/evidence/5b8"),file=join(out,"protected-baseline.json")
mkdirSync(out,{recursive:true})
const hash=p=>createHash("sha256").update(readFileSync(join(root,p))).digest("hex")
const tree=dir=>readdirSync(join(root,dir),{withFileTypes:true}).flatMap(e=>e.isDirectory()?tree(join(dir,e.name)):[join(dir,e.name).replaceAll("\\","/")])
const integration=["src/app/App.tsx","src/app/styles.css","src/components/layout/app-shell.tsx","src/features/calculator/components/capture-summary.tsx","src/features/storage/storage-api.ts","src/features/storage/storage.test.ts","src-tauri/src/lib.rs","src-tauri/src/storage/mod.rs","src-tauri/src/storage/commands.rs","src-tauri/src/storage/tests.rs"]
if(process.argv.includes("--before")){
  assert(!existsSync(file));const paths=[...tree("src"),...tree("src-tauri/src"),"src-tauri/Cargo.toml","src-tauri/Cargo.lock","src-tauri/tauri.conf.json","package.json","package-lock.json","design/UI_APROBADA.png"].filter(p=>!integration.includes(p))
  writeFileSync(file,JSON.stringify({capturedOn:new Date().toISOString(),hashes:Object.fromEntries(paths.map(p=>[p,hash(p)])),integrationBefore:Object.fromEntries(integration.map(p=>[p,hash(p)]))},null,2))
}else{
  const baseline=JSON.parse(readFileSync(file,"utf8")),differences=Object.entries(baseline.hashes).filter(([p,h])=>hash(p)!==h).map(([p])=>p)
  const added=[...tree("src"),...tree("src-tauri/src")].filter(p=>!(p in baseline.hashes)&&!integration.includes(p))
  const report={checkedOn:new Date().toISOString(),protectedFiles:Object.keys(baseline.hashes).length,differences,declaredIntegration:integration.map(p=>({path:p,before:baseline.integrationBefore[p],after:hash(p)})),addedFiles:Object.fromEntries(added.map(p=>[p,hash(p)]))}
  writeFileSync(join(out,"protected-final.json"),JSON.stringify(report,null,2));assert.deepEqual(differences,[]);console.log(JSON.stringify(report))
}
