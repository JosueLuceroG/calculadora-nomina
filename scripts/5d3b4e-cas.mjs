import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs'
import {release,cpus,totalmem} from 'node:os'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url)),out=new URL('../docs/evidence/5d3b4e/',import.meta.url),opt=['curve25519-dalek:2','ed25519-dalek:2','sha2:2','nomina-fiscal-package:1'].flatMap(p=>{const[n,v]=p.split(':');return ['--config',`profile.test.package.${n}.opt-level=${v}`]}),commands=[]
mkdirSync(new URL('logs/',out),{recursive:true})
for(const optimized of [false,true])for(const diagnostic of [true,false]){
 const name=`cas-${optimized?'optimized':'default'}-${diagnostic?'assessment':'historical'}`,profile=optimized?'test-crypto-opt':'debug-default',args=['test','--locked','--offline','--manifest-path','src-tauri/Cargo.toml',...(optimized?opt:[]),diagnostic?'assess_existing_cas_without_weakening':'two_actual_processes_selection_cas_has_one_winner','--','--test-threads=1','--nocapture'],file=new URL(`cas-${profile}.json`,out)
 if(diagnostic&&existsSync(file))writeFileSync(new URL(`cas-${profile}-preceding-${Date.now()}.json`,out),readFileSync(file),{flag:'wx'})
 const start=Date.now(),r=spawnSync('cargo',args,{cwd:root,encoding:'utf8',env:{...process.env,NOMINA_4E_CAS_PROFILE:profile},timeout:300000,maxBuffer:4*1024*1024}),text=(r.stdout??'')+(r.stderr??'');writeFileSync(new URL(`logs/${name}.log`,out),text)
 const decoded=[...text.matchAll(/\[(?:\d+,\s*){10,}\d+\]/g)].map(m=>{try{return Buffer.from(JSON.parse(m[0])).toString()}catch{return ''}})
 const busy=text.includes('BUSY')||decoded.some(t=>t.includes('BUSY')),item={name,command:'cargo',args,profile,exitCode:r.status,seconds:(Date.now()-start)/1000,log:`logs/${name}.log`,decodedChildDiagnostics:decoded,busyObserved:busy,interpretation:r.status===0?'passed':busy?'five-second-budget-sensitivity-observed':'unexpected-failure'};commands.push(item);console.log(JSON.stringify(item))
 if(diagnostic||optimized)assert.equal(r.status,0,text);else assert(r.status===0||busy,text)
}
const read=n=>JSON.parse(readFileSync(new URL(n,out))),report={recordedAt:new Date().toISOString(),status:'assessed-risk-remains-open',platform:process.platform,windowsRelease:release(),logicalProcessors:cpus().length,cpu:cpus()[0]?.model,memoryBytes:totalmem(),lockBudgetMs:5000,default:read('cas-debug-default.json'),optimized:read('cas-test-crypto-opt.json'),commands,productionTimeoutsOrPoliciesChanged:false,performanceIssueResolved:false,distinction:'In-process UI BUSY is a separate worker-admission gate; the historical two-process CAS uses the actual OS lock and full cryptographic replay.',measurementScope:'Exclusive replay guard measured directly; concurrent lock-busy intervals sampled externally at5ms and may merge adjacent holders. Total mutation includes waiting/replay/verification/recovery.',proposedIndependentReview:'Profile replay growth and safe verified replay/checkpoint reuse with atomic head/generation revalidation; preserve immutable evidence, full trust/antirollback/CAS and current lock semantics. No such optimization implemented in4-E.'}
writeFileSync(new URL('cas-assessment.json',out),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,default:report.default,optimized:report.optimized},null,2))
