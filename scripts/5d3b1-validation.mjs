import {spawnSync} from 'node:child_process'
import {writeFileSync,mkdirSync,readFileSync,existsSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url)),out=new URL('../docs/evidence/5d3b1/',import.meta.url)
mkdirSync(new URL('logs/',out),{recursive:true})
const npm=process.platform==='win32'?'npm.cmd':'npm'
const tasks=[
 ['core-rust','cargo',['test','--locked','--offline','--manifest-path','crates/nomina-fiscal-package/Cargo.toml']],
 ['editorial-node',npm,['--prefix','tools/fiscal-editorial','test']],
 ['vitest',npm,['test','--','--maxWorkers=2']],
 ['native-rust','cargo',['test','--locked','--offline','--manifest-path','src-tauri/Cargo.toml','--','--test-threads=2']],
 ['typecheck',npm,['run','typecheck']],
 ['frontend-build',npm,['run','build']],
 ['storage-identity',process.execPath,['scripts/project-storage-identity.mjs','--check']],
 ['producer-identity',process.execPath,['scripts/project-document-producer.mjs','--check']],
 ['pdf-originals','python',['scripts/verify-5d2b-pdfs.py']],
 ['css',process.execPath,['scripts/5d3b1-css.mjs']],
 ['integrity',process.execPath,['scripts/5d3b1-baseline.mjs']],
 ['features','cargo',['tree','--locked','--offline','--manifest-path','src-tauri/Cargo.toml','-e','features','-i','serde_json']],
]
const resume=process.argv.includes('--resume'),rerun=new Set(['native-rust','frontend-build','css','integrity','features'])
const previous=resume?JSON.parse(readFileSync(new URL('validation-commands.json',out))):null
let archiveName='';if(resume){let n=1;while(existsSync(new URL(`validation-attempt${n}.json`,out)))n++;archiveName=`validation-attempt${n}.json`;writeFileSync(new URL(archiveName,out),JSON.stringify(previous,null,2)+'\n',{flag:'wx'})}
const report={recordedAt:new Date().toISOString(),status:'running',commands:[],resumed:resume}
for(const[name,command,args]of tasks){if(resume&&!rerun.has(name)){const old=previous.commands.find(c=>c.name===name&&c.exitCode===0);if(!old)throw new Error(`No successful evidence for ${name}`);report.commands.push({...old,reusedFrom:archiveName});continue;}const start=Date.now();const r=spawnSync(command,args,{cwd:root,encoding:'utf8',shell:command===npm,timeout:300000,maxBuffer:16*1024*1024});const text=((r.stdout??'')+(r.stderr??'')).replace(/\x1b\[[0-9;]*m/g,'');const log=`logs/${name}.log`;writeFileSync(new URL(log,out),text);const entry={name,command,args,exitCode:r.status,seconds:(Date.now()-start)/1000,log};if(name.endsWith('rust')){const m=[...text.matchAll(/test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored/g)];entry.tests=m.reduce((a,m)=>({passed:a.passed+Number(m[1]),failed:a.failed+Number(m[2]),ignored:a.ignored+Number(m[3])}),{passed:0,failed:0,ignored:0})}if(name==='vitest'){entry.tests=Number(text.match(/Tests\s+(\d+) passed/)?.[1]);entry.files=Number(text.match(/Test Files\s+(\d+) passed/)?.[1])}if(name==='editorial-node')entry.summary=JSON.parse(readFileSync(new URL('../5d3a/editorial-tests.json',out)));report.commands.push(entry);console.log(`${name}: ${r.status===0?'passed':'FAILED'} (${entry.seconds}s)`);if(r.status!==0){report.status='failed';report.failed=name;writeFileSync(new URL('validation-commands.json',out),JSON.stringify(report,null,2)+'\n');console.log(text);process.exit(1)}}
report.status='passed-except-separate-full-volume-gate';writeFileSync(new URL('validation-commands.json',out),JSON.stringify(report,null,2)+'\n');console.log('All regression commands passed; physical-volume gate is separate')
