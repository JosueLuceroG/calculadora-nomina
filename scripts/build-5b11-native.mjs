import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {copyFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from "node:fs"
import {execFileSync} from "node:child_process"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {fileURLToPath} from "node:url"
const root=fileURLToPath(new URL("../",import.meta.url)),milestone=process.argv.includes("--refinement")?"5b11-1":"5b11",out=join(root,`docs/evidence/${milestone}/native-build.json`),previous=existsSync(out)?JSON.parse(readFileSync(out,"utf8")):null,embedded=process.argv.includes("--embedded")
assert(!previous||process.argv.includes("--rebuild"),"Usar --rebuild para conservar el primer respaldo")
assert.equal(execFileSync("pwsh",["-NoProfile","-Command","@(Get-Process -Name 'calculadora-nomina' -ErrorAction SilentlyContinue).Count"],{encoding:"utf8"}).trim(),"0")
const exe=join(root,"src-tauri/target/debug/calculadora-nomina.exe"),folder=join(tmpdir(),"opencode",`${milestone}-native-backup`),backup=join(folder,`calculadora-nomina-before-${milestone}.exe`),sha=p=>createHash("sha256").update(readFileSync(p)).digest("hex")
mkdirSync(folder,{recursive:true});assert(previous||!existsSync(backup));const before=previous?.beforeSha256??sha(exe);if(!previous)copyFileSync(exe,backup);assert.equal(sha(backup),before)
const attempts=[...(previous?.attempts??[]),...(previous?[{completedOn:previous.completedOn,afterSha256:previous.afterSha256,kind:previous.kind,status:previous.status}]:[])]
writeFileSync(out,JSON.stringify({beforeSha256:before,backup,status:"building",attempts},null,2))
if(embedded)execFileSync("npm.cmd",["run","tauri","--","build","--debug","--no-bundle"],{cwd:root,stdio:"inherit",timeout:360000,shell:true})
else execFileSync("cargo",["build","--manifest-path","src-tauri/Cargo.toml"],{cwd:root,stdio:"inherit",timeout:300000})
const result={completedOn:new Date().toISOString(),beforeSha256:before,afterSha256:sha(exe),backup,status:"passed",kind:embedded?"debug-embedded-assets-no-installer":"debug-development-with-vite",attempts};writeFileSync(out,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
