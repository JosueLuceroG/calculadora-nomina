import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {existsSync,mkdirSync,copyFileSync,readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url)),qa=!process.argv.includes('--production'),base=join(tmpdir(),'opencode/5d3b2-artifacts'),exe=join(root,'src-tauri/target/debug/calculadora-nomina.exe'),sha=b=>createHash('sha256').update(b).digest('hex')
assert.equal(execFileSync('pwsh',['-NoProfile','-Command',"@(Get-Process -Name 'calculadora-nomina' -ErrorAction SilentlyContinue).Count"],{encoding:'utf8'}).trim(),'0','Do not touch an existing user session')
mkdirSync(base,{recursive:true});const backup=join(base,'before-5d3b2.exe');if(!existsSync(backup)&&existsSync(exe))copyFileSync(exe,backup)
const args=['run','tauri','--','build','--debug','--no-bundle',...(qa?['--features','fiscal-import-qa']:[])]
execFileSync('npm.cmd',args,{cwd:root,env:{...process.env,NOMINA_FISCAL_QA_BUILD_ACK:qa?'5d3b2-isolated-only':''},shell:true,stdio:'inherit',timeout:600000})
const bytes=readFileSync(exe),marker=Buffer.from('NOMINA_FISCAL_IMPORT_QA_ONLY_5D3B2');assert.equal(bytes.includes(marker),qa,'Artifact QA marker must match the build profile')
const folder=join(base,qa?'qa':'production');mkdirSync(folder,{recursive:true});const artifact=join(folder,'calculadora-nomina.exe');copyFileSync(exe,artifact)
const record={recordedAt:new Date().toISOString(),qa,kind:'debug-integrated-no-installer-no-release',artifact,sha256:sha(bytes),qaMarkerPresent:bytes.includes(marker),publicQaBootstrapCompiled:qa,productionBootstrapProvisioned:false,backup:existsSync(backup)?{path:backup,sha256:sha(readFileSync(backup))}:null}
writeFileSync(join(root,`docs/evidence/5d3b2/build-${qa?'qa':'production'}.json`),JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify(record))
