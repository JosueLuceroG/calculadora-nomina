import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
const root=fileURLToPath(new URL("../",import.meta.url)),exe=join(root,"src-tauri/target/debug/calculadora-nomina.exe"),folder=join(tmpdir(),"opencode/5d2b-native-backup"),backup=join(folder,"before-5d2b.exe")
const sha=path=>createHash("sha256").update(readFileSync(path)).digest("hex")
assert.equal(execFileSync("pwsh",["-NoProfile","-Command","@(Get-Process -Name 'calculadora-nomina' -ErrorAction SilentlyContinue).Count"],{encoding:"utf8"}).trim(),"0")
mkdirSync(folder,{recursive:true});if(!existsSync(backup))copyFileSync(exe,backup)
execFileSync("npm.cmd",["run","tauri","--","build","--debug","--no-bundle"],{cwd:root,stdio:"inherit",shell:true,timeout:360000})
const report={checkedOn:new Date().toISOString(),kind:"debug-integrated-no-installer-no-release",backup,beforeSha256:sha(backup),afterSha256:sha(exe)}
writeFileSync(join(root,"docs/evidence/5d2b/native-build.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report))
