import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import assert from "node:assert/strict"
const root=fileURLToPath(new URL("../",import.meta.url)),out=join(root,"docs/evidence/5b7/native-debug-build.json")
const previous=existsSync(out)?JSON.parse(readFileSync(out,"utf8")):null
assert(!previous||process.argv.includes("--rebuild"),"Usar --rebuild para conservar el registro y añadir un intento")
assert.equal(execFileSync("pwsh",["-NoProfile","-Command","@(Get-Process -Name 'calculadora-nomina' -ErrorAction SilentlyContinue).Count"],{encoding:"utf8"}).trim(),"0")
const exe=join(root,"src-tauri/target/debug/calculadora-nomina.exe"),folder=join(tmpdir(),"opencode","5b7-native-backup"),backup=join(folder,"calculadora-nomina-before-5b7.exe")
mkdirSync(folder,{recursive:true});assert(previous||!existsSync(backup))
const sha=p=>createHash("sha256").update(readFileSync(p)).digest("hex")
const before=previous?.beforeSha256??sha(exe)
if(!previous)copyFileSync(exe,backup)
assert.equal(sha(backup),before)
const attempts=[...(previous?.buildAttempts??[]),...(previous?[{completedOn:previous.completedOn,afterSha256:previous.afterSha256,status:previous.status}]:[])]
writeFileSync(out,JSON.stringify({beforeSha256:before,backup,status:"building",buildAttempts:attempts},null,2))
execFileSync("cargo",["build","--manifest-path","src-tauri/Cargo.toml"],{cwd:root,stdio:"inherit",timeout:300000})
const result={completedOn:new Date().toISOString(),beforeSha256:before,afterSha256:sha(exe),backup,status:"passed",kind:"debug-development-with-vite-no-installer",buildAttempts:attempts}
writeFileSync(out,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
