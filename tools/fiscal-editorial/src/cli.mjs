import {readFileSync,writeFileSync,mkdirSync,realpathSync} from "node:fs"
import {resolve,relative,isAbsolute,join,sep} from "node:path"
import {execFileSync} from "node:child_process"
import {fileURLToPath} from "node:url"
import {parseStrict,canonicalBytes,readBounded} from "./json.mjs"
import {sha256,privateFromExternalPem,publicBytes,keyId,addQaSignature} from "./crypto.mjs"
import {fixture,writeContext,runNative,readReceived,verifyNode,NOW,sourcePath} from "./qa.mjs"
import {runProductionCommand} from "./production.mjs"
const workspace=fileURLToPath(new URL("../../../",import.meta.url))
function output(path,bytes){writeFileSync(path,bytes,{flag:"wx"})}
const json=path=>parseStrict(readBounded(path))
function diff(a,b,path=""){if(Object.is(a,b))return[];if(a===null||b===null||typeof a!=="object"||typeof b!=="object")return[{path,before:a??null,after:b??null}];return [...new Set([...Object.keys(a),...Object.keys(b)])].sort().flatMap(key=>diff(a[key],b[key],`${path}/${key}`))}
try{
  const[command,...args]=process.argv.slice(2)
  switch(command){
    case"build":{const source=json(args[0]??sourcePath);if(source.channel!=="qa")throw new Error("QA_BUILD_ONLY");const envelope={signed:source,signatures:[]};output(args[1],canonicalBytes(envelope));const report=runNative(["validate",args[1]]);if(!report.ok)throw new Error(report.error.code);console.log(JSON.stringify(report));break}
    case"canonicalize":output(args[1],canonicalBytes(json(args[0])));break
    case"validate":{const report=runNative(["validate",args[0]]);console.log(JSON.stringify(report));if(!report.ok)process.exitCode=2;break}
    case"hash":{const e=readReceived(args[0]);console.log(JSON.stringify({content:e.signed.manifest.contentIdentity,computedContent:sha256(canonicalBytes(e.signed.registry)),signedPayloadSha256:sha256(canonicalBytes(e.signed)),containerSha256:sha256(canonicalBytes(e))}));break}
    case"inspect":console.log(JSON.stringify(readReceived(args[0]),null,2));break
    case"diff":console.log(JSON.stringify(diff(readReceived(args[0]).signed,readReceived(args[1]).signed),null,2));break
    case"sign-qa":{const e=readReceived(args[0]),keyPath=realpathSync(args[1]),inside=relative(workspace,keyPath);if(!isAbsolute(inside)&&inside!==".."&&!inside.startsWith(`..${sep}`))throw new Error("PRIVATE_KEY_MUST_BE_OUTSIDE_WORKSPACE");const pem=readBounded(keyPath,16384);let privateKey;try{privateKey=privateFromExternalPem(pem)}finally{pem.fill(0)}const bytes=publicBytes(privateKey),key={privateKey,publicKey:bytes.toString("base64url"),keyId:keyId(bytes)};output(args[3],canonicalBytes(addQaSignature(e,key,args[2])));console.log(JSON.stringify({purpose:args[2],keyId:key.keyId,privateMaterialEmitted:false}));break}
    case"verify":{const report=runNative(["verify",...args]);console.log(JSON.stringify(report));if(!report.ok)process.exitCode=2;break}
    case"verify-independent":{const e=readReceived(args[0]),bootstrap=json(args[1]),trust=readReceived(args[2]);console.log(JSON.stringify(verifyNode(e,bootstrap,trust,args[3]??NOW)));break}
    case"publication-report":{const e=readReceived(args[0]),native=runNative(["verify",...args]);if(!native.ok)throw new Error(native.error.code);console.log(JSON.stringify({kind:"QA-publication-review-report-not-published",channel:e.signed.channel,packageId:e.signed.manifest.packageId,parameterVersion:e.signed.manifest.parameterVersion,exercise:e.signed.manifest.exercise,contentIdentity:e.signed.manifest.contentIdentity,signedPayloadSha256:sha256(canonicalBytes(e.signed)),containerSha256:sha256(canonicalBytes(e)),independentReportSha256:e.signed.review.independentReportSha256,reviewRecord:e.signed.review.recordId,nativeVerification:native.result,execution:"not-installed-not-authorized"},null,2));break}
    case"fiscal-check":{const e=readReceived(args[0]),hash=sha256(canonicalBytes(e.signed.registry));if(hash!=="7e9f13084e64633b29959d79eec5f9c02333fe2695809c662d71fa7fc8393ab0")throw new Error("NEW_CONTENT_REQUIRES_ITS_OWN_INDEPENDENT_REFERENCE_RUNNER");execFileSync(process.platform==="win32"?"npm.cmd":"npm",["test","--","--maxWorkers=2"],{cwd:workspace,stdio:"inherit",shell:process.platform==="win32",timeout:240000});console.log(JSON.stringify({kind:"unchanged-integrated-2026-fiscal-regression",contentSha256:hash,command:"npm test -- --maxWorkers=2",status:"passed"}));break}
    case"qa-demo":{const dir=resolve(args[0]);mkdirSync(dir,{recursive:false});const f=fixture(),e=f.package(),paths=writeContext(dir,f);output(join(dir,"candidate.nomina-fiscal"),canonicalBytes(e));console.log(JSON.stringify({directory:dir,...paths,privateKeys:"ephemeral-in-memory-only",independent:verifyNode(e,f.bootstrap,f.rootEnvelope())}));break}
    default:if(command?.startsWith("production-")){console.log(JSON.stringify(runProductionCommand(command,args)));break}throw new Error("Commands: build, validate, canonicalize, hash, inspect, diff, sign-qa, verify, verify-independent, publication-report, qa-demo, production-prepare, production-export, production-assemble, production-verify, production-report")
  }
}catch(error){console.error(JSON.stringify({error:error.message}));process.exitCode=2}
