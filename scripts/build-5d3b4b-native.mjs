import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {existsSync,mkdirSync,copyFileSync,readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url)),qa=process.argv.includes('--qa'),base=join(tmpdir(),'opencode/5d3b4b-artifacts'),exe=join(root,'src-tauri/target/debug/calculadora-nomina.exe'),sha=b=>createHash('sha256').update(b).digest('hex')
assert.equal(execFileSync('pwsh',['-NoProfile','-Command',"@(Get-Process -Name 'calculadora-nomina' -ErrorAction SilentlyContinue).Count"],{encoding:'utf8'}).trim(),'0','Do not touch a personal application session');mkdirSync(base,{recursive:true});if(!existsSync(join(base,'before.exe')))copyFileSync(exe,join(base,'before.exe'))
execFileSync('npm.cmd',['run','tauri','--','build','--debug','--no-bundle',...(qa?['--features','fiscal-import-qa']:[])],{cwd:root,env:{...process.env,NOMINA_FISCAL_QA_BUILD_ACK:qa?'5d3b2-isolated-only':''},shell:true,stdio:'inherit',timeout:600000})
const b=readFileSync(exe);assert.equal(b.includes(Buffer.from('NOMINA_FISCAL_IMPORT_QA_ONLY_5D3B2')),qa);const folder=join(base,qa?'qa':'normal');mkdirSync(folder,{recursive:true});const artifact=join(folder,'calculadora-nomina.exe');copyFileSync(exe,artifact);const result={recordedAt:new Date().toISOString(),qa,artifact,sha256:sha(b),kind:'debug-integrated-no-bundle-no-release',productionBootstrap:false};writeFileSync(join(root,`docs/evidence/5d3b4b/build-${qa?'qa':'normal'}.json`),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result))
