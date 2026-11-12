import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {readFileSync,readdirSync,existsSync,statSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url)),out=join(root,'docs/evidence/5d3b2'),folder=join(root,'src-tauri/target/debug/build')
const candidates=readdirSync(folder).filter(n=>n.startsWith('calculadora-nomina-')).map(n=>join(folder,n,'build-script-build.exe')).filter(p=>existsSync(p)&&readFileSync(p).includes(Buffer.from('QA cannot be a release build'))).sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs)
assert(candidates.length);const gate=candidates[0],checks=[]
for(const [name,profile,ack,needle]of [['release','release','5d3b2-isolated-only','QA cannot be a release build'],['missing-ack','debug','','Use the explicit isolated QA build launcher']]){const result=spawnSync(gate,[],{cwd:join(root,'src-tauri'),env:{...process.env,CARGO_FEATURE_FISCAL_IMPORT_QA:'1',PROFILE:profile,NOMINA_FISCAL_QA_BUILD_ACK:ack},encoding:'utf8',timeout:30000});assert.notEqual(result.status,0);assert((result.stderr??'').includes(needle));checks.push({name,exitCode:result.status,actualCompiledBuildScript:true,rejected:true})}
const build=JSON.parse(readFileSync(join(out,'build-qa.json'))),env={...process.env};delete env.NOMINA_STORAGE_TEST_ROOT;delete env.WEBVIEW2_USER_DATA_FOLDER
const result=spawnSync(build.artifact,[],{cwd:root,env,encoding:'utf8',timeout:30000});assert.notEqual(result.status,0);assert((result.stderr??'').includes('QA_CONTEXT_REQUIRED'));checks.push({name:'qa-executable-without-isolated-context',exitCode:result.status,rejectedBeforeTauriBuilder:true,actualQaExecutable:true})
const config=JSON.parse(readFileSync(join(root,'src-tauri/tauri.conf.json')));assert.equal(config.bundle.active,false)
const report={recordedAt:new Date().toISOString(),status:'passed',checks,bundleActive:false,releaseCreated:false,installerCreated:false,limit:'Guards cover this project build/runtime pipeline; an external actor deliberately repackaging a debug executable is outside this qualification.'};writeFileSync(join(out,'qa-gates.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))
