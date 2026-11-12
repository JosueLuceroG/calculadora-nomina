import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {readFileSync,writeFileSync,copyFileSync,mkdirSync,existsSync,readdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url)),base=join(tmpdir(),'opencode/5d3b4a-artifacts'),exe=join(root,'src-tauri/target/debug/calculadora-nomina.exe'),sha=b=>createHash('sha256').update(b).digest('hex')
assert.equal(execFileSync('pwsh',['-NoProfile','-Command',"@(Get-Process -Name 'calculadora-nomina' -ErrorAction SilentlyContinue).Count"],{encoding:'utf8'}).trim(),'0','An existing personal application session must not be touched');mkdirSync(base,{recursive:true});if(!existsSync(join(base,'before.exe')))copyFileSync(exe,join(base,'before.exe'))
execFileSync('npm.cmd',['run','tauri','--','build','--debug','--no-bundle'],{cwd:root,shell:true,stdio:'inherit',timeout:600000});const bytes=readFileSync(exe);assert(!bytes.includes(Buffer.from('NOMINA_FISCAL_IMPORT_QA_ONLY_5D3B2')))
const assets=Object.fromEntries(readdirSync(join(root,'dist/assets')).filter(n=>n.endsWith('.js')||n.endsWith('.css')).map(n=>[n,sha(readFileSync(join(root,'dist/assets',n)))])),report={recordedAt:new Date().toISOString(),kind:'normal-debug-integrated-no-bundle-no-release',exe,sha256:sha(bytes),previousSha256:sha(readFileSync(join(base,'before.exe'))),fiscalQaFeature:false,assets};writeFileSync(join(root,'docs/evidence/5d3b4a/native-build.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2))
