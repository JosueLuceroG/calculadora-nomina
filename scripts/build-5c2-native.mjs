import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {copyFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url)),folder=join(tmpdir(),'opencode/5c2-native-backup'),exe=join(root,'src-tauri/target/debug/calculadora-nomina.exe'),file=join(root,'docs/evidence/5c2/native-build.json'),sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),backup=join(folder,'before-5c2.exe')
assert.equal(execFileSync('pwsh',['-NoProfile','-Command',"@(Get-Process -Name 'calculadora-nomina' -ErrorAction SilentlyContinue).Count"],{encoding:'utf8'}).trim(),'0')
mkdirSync(folder,{recursive:true});if(existsSync(backup))assert(process.argv.includes('--rebuild'));else copyFileSync(exe,backup)
execFileSync('npm.cmd',['run','tauri','--','build','--debug','--no-bundle'],{cwd:root,stdio:'inherit',shell:true,timeout:360000})
const result={completedOn:new Date().toISOString(),kind:'debug-integrated-assets-no-release-no-installer',beforeSha256:sha(backup),backup,afterSha256:sha(exe),status:'passed'};writeFileSync(file,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
