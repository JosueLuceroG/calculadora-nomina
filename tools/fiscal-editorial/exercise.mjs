// Runs the actual editorial commands; only temporary QA private files exist.
import assert from "node:assert/strict"
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,unlinkSync,copyFileSync,existsSync} from "node:fs"
import {execFileSync} from "node:child_process"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {fileURLToPath} from "node:url"
import {fixture,writeContext,NOW,sourcePath,runNative} from "./src/qa.mjs"
const root=fileURLToPath(new URL("../../",import.meta.url)),cli=fileURLToPath(new URL("src/cli.mjs",import.meta.url)),out=join(root,"docs/evidence/5d3a"),dir=mkdtempSync(join(tmpdir(),"opencode/5d3a-editorial-")),f=fixture(),paths=writeContext(dir,f),privatePaths=[]
const command=(args,json=true)=>{const text=execFileSync(process.execPath,[cli,...args],{encoding:"utf8",maxBuffer:5*1024*1024,timeout:300000});return json?JSON.parse(text):text}
let completedReport
try{
  const candidate=join(dir,"unsigned-candidate.json"),stage1=join(dir,"publication-signed.json"),final=join(dir,"candidate.nomina-fiscal")
  assert(command(["build",sourcePath,candidate]).ok)
  assert.throws(()=>command(["sign-qa",candidate,join(root,"package.json"),"package",join(dir,"must-not-exist.json")]),error=>String(error.stderr).includes("PRIVATE_KEY_MUST_BE_OUTSIDE_WORKSPACE"))
  const canonicalSource=join(dir,"canonical-source.json");command(["canonicalize",sourcePath,canonicalSource],false)
  for(const[key,name,purpose,input,output]of[[f.publisher,"publisher","package",candidate,stage1],[f.approver,"approval","content-approval",stage1,final]]){const path=join(dir,`${name}.pem`);privatePaths.push(path);writeFileSync(path,key.privateKey.export({type:"pkcs8",format:"pem"}),{flag:"wx",mode:0o600});assert.equal(command(["sign-qa",input,path,purpose,output]).privateMaterialEmitted,false)}
  assert(command(["validate",final]).ok);const hash=command(["hash",final]);assert.equal(hash.computedContent,"7e9f13084e64633b29959d79eec5f9c02333fe2695809c662d71fa7fc8393ab0")
  assert.equal(command(["inspect",final]).signed.channel,"qa");assert.deepEqual(command(["diff",candidate,final]),[])
  const verifyArgs=[final,paths.bootstrap,paths.chain,paths.floor,NOW,"inverse","qa"],native=command(["verify",...verifyArgs]);assert(native.ok)
  const trustPath=JSON.parse(readFileSync(paths.chain,"utf8"))[0],independent=command(["verify-independent",final,paths.bootstrap,trustPath,NOW]);assert(independent.publisherAndApproval)
  const publication=command(["publication-report",...verifyArgs]);assert.equal(publication.execution,"not-installed-not-authorized")
  const demo=command(["qa-demo",join(dir,"qa-demo")]);assert.equal(demo.privateKeys,"ephemeral-in-memory-only")
  let fiscal="not-requested";if(process.argv.includes("--fiscal")){execFileSync(process.execPath,[cli,"fiscal-check",final],{stdio:"inherit",timeout:300000});fiscal="passed"}
  const publicDir=join(out,"qa-example");mkdirSync(publicDir,{recursive:true});for(const[from,name]of[[candidate,"unsigned-candidate.json"],[final,"candidate.nomina-fiscal"],[paths.bootstrap,"bootstrap-public.json"],[trustPath,"trust.json"],[paths.floor,"revisions.json"]])copyFileSync(from,join(publicDir,name))
  writeFileSync(join(publicDir,"trust-chain.json"),JSON.stringify([join(publicDir,"trust.json")]))
  const replay=runNative(["verify",join(publicDir,"candidate.nomina-fiscal"),join(publicDir,"bootstrap-public.json"),join(publicDir,"trust-chain.json"),join(publicDir,"revisions.json"),NOW,"inverse","qa"]);assert(replay.ok)
  completedReport={status:"passed",directory:dir,commands:["build","canonicalize","sign-qa reject workspace","sign-qa package","sign-qa content-approval","validate","hash","inspect","diff","verify","verify-independent","publication-report","qa-demo"],fiscalCheck:fiscal,hashes:hash,native:native.result,independent,publication,offlineReplay:"passed using local public inputs",privateMaterial:"temporary QA files removed; root private keys never serialized"}
}finally{for(const path of privatePaths)if(existsSync(path))unlinkSync(path)}
assert(privatePaths.every(path=>!existsSync(path)));writeFileSync(join(out,"editorial-exercise.json"),JSON.stringify(completedReport,null,2)+"\n");console.log(JSON.stringify({status:"passed",directory:dir,fiscalCheck:completedReport.fiscalCheck,offlineReplay:"not-installed-not-authorized"}))
