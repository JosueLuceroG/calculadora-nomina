// Public-only editorial workflow. No private-key input, signing or application IPC.
import {writeFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import {dirname,join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {canonicalBytes,parseStrict,readBounded} from './json.mjs'
import {sha256,message} from './crypto.mjs'
import {runNative} from './qa.mjs'
import {verifyProductionPackage,verifyProductionTrust} from './production-independent.mjs'
const check=(ok,code)=>{if(!ok)throw new Error(code)}
const closed=(v,keys)=>check(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k)),'INVALID_EDITORIAL_OBJECT')
const hash=v=>sha256(canonicalBytes(v))
const output=(path,bytes)=>writeFileSync(path,bytes,{flag:'wx'})
function received(path,max=2097152){const bytes=readBounded(path,max),value=parseStrict(bytes,max);check(bytes.equals(canonicalBytes(value)),'NON_CANONICAL_WIRE');return value}
function workspace(action){
  const root=join(tmpdir(),'opencode');mkdirSync(root,{recursive:true})
  const folder=mkdtempSync(join(root,'r2b2-editorial-'))
  try{return action(folder)}finally{rmSync(folder,{recursive:true,force:true})}
}
function nativeRaw(args){
  try{return runNative(args,{raw:true})}catch(error){
    let code='EDITORIAL_NATIVE_FAILED'
    try{code=parseStrict(error.stdout).error.code}catch{}
    throw new Error(code)
  }
}
function nativeReport(args){const r=runNative(args);check(r.ok,r.error?.code??'EDITORIAL_NATIVE_FAILED');return r.result}
function document(envelope){
  closed(envelope,['signed','signatures']);check(envelope.signed.channel==='production','EDITORIAL_PRODUCTION_CHANNEL_REQUIRED')
  const format=envelope.signed.format;check(['mx.nomina.fiscal-package','mx.nomina.fiscal-trust'].includes(format),'UNSUPPORTED_EDITORIAL_DOCUMENT');return format
}
export function signingRequest(envelope,purpose,id){
  const format=document(envelope),s=envelope.signed,trust=format==='mx.nomina.fiscal-trust'
  check(trust?purpose==='trust-root':['package','content-approval'].includes(purpose),'INVALID_EDITORIAL_PURPOSE')
  check(/^ed25519-sha256:[a-f0-9]{64}$/.test(id),'INVALID_EDITORIAL_KEY_ID')
  const protectedHeader={protocolVersion:1,algorithm:'Ed25519',keyId:id,purpose},bytes=message(protectedHeader,s)
  const identifiers=trust?{rootVersion:s.rootVersion,trustEpoch:s.epoch}:{packageId:s.manifest.packageId,parameterVersion:s.manifest.parameterVersion,exercise:s.manifest.exercise,streamId:s.publication.streamId,streamEpoch:s.publication.streamEpoch,revision:s.publication.revision}
  return {request:{format:'mx.nomina.external-signing-request',formatVersion:1,channel:'production',documentFormat:format,protected:protectedHeader,identifiers,signedPayloadSha256:hash(s),messageSha256:sha256(bytes),messageBytes:bytes.length},bytes}
}
export function prepareProduction(sourcePath,newOutput){
  const source=parseStrict(readBounded(sourcePath)),expected=canonicalBytes({signed:source,signatures:[]})
  const bytes=workspace(folder=>{const path=join(folder,'source.json');output(path,canonicalBytes(source));return nativeRaw(['prepare-production',path])})
  check(bytes.equals(expected),'NATIVE_JCS_MISMATCH');output(newOutput,bytes)
  return {kind:'unsigned-editorial-candidate',channel:'production',signedPayloadSha256:hash(source),containerSha256:sha256(bytes),authentication:'not-checked'}
}
export function exportProductionRequest(candidatePath,purpose,id,requestPath,messagePath){
  const candidate=received(candidatePath),{request,bytes}=signingRequest(candidate,purpose,id)
  const native=workspace(folder=>{const path=join(folder,'candidate.json');output(path,canonicalBytes(candidate));return nativeRaw(['signing-message',path,purpose,id])})
  check(bytes.equals(native),'NATIVE_SIGNING_MESSAGE_MISMATCH')
  output(requestPath,canonicalBytes(request));output(messagePath,bytes)
  return {...request,requestSha256:hash(request),privateMaterialEmitted:false}
}
function contextSnapshot(contextPath){
  const c=parseStrict(readBounded(contextPath,65536),65536);closed(c,['bootstrap','chain','revisions','now','operation'])
  check(['direct','inverse'].includes(c.operation)&&typeof c.now==='string','INVALID_EDITORIAL_CONTEXT')
  const path=(base,p)=>{check(typeof p==='string'&&p.length>0,'INVALID_EDITORIAL_PATH');return resolve(dirname(base),p)}
  const bootstrap=received(path(contextPath,c.bootstrap),16384),chainPath=path(contextPath,c.chain),paths=received(chainPath,65536)
  check(Array.isArray(paths)&&paths.length<=16,'TRUST_TRANSITION_LIMIT')
  const chain=paths.map(p=>received(path(chainPath,p),262144)),revisions=received(path(contextPath,c.revisions),65536)
  return {bootstrap,chain,revisions,now:c.now,operation:c.operation}
}
function verifySnapshot(envelope,c){
  const format=document(envelope),trust=format==='mx.nomina.fiscal-trust',bytes=canonicalBytes(envelope)
  check(bytes.length<=(trust?262144:2097152),'FILE_LIMIT')
  return workspace(folder=>{
    const candidate=join(folder,'candidate.json'),bootstrap=join(folder,'bootstrap.json'),chain=join(folder,'chain.json'),revisions=join(folder,'revisions.json')
    output(candidate,bytes);output(bootstrap,canonicalBytes(c.bootstrap));output(revisions,canonicalBytes(c.revisions))
    const paths=c.chain.map((e,i)=>{const path=join(folder,`trust-${i}.json`);output(path,canonicalBytes(e));return path});output(chain,canonicalBytes(paths))
    const native=trust?nativeReport(['verify-production-trust',candidate,bootstrap,chain,c.now]):nativeReport(['verify',candidate,bootstrap,chain,revisions,c.now,c.operation,'production-editorial'])
    const independent=trust?verifyProductionTrust(c.bootstrap,[...c.chain,envelope],c.now):verifyProductionPackage(envelope,c.bootstrap,c.chain,c.revisions,c.now,c.operation)
    check(native.rootVersion===independent.rootVersion&&native.trustEpoch===independent.trustEpoch,'VERIFIER_STATE_MISMATCH')
    if(!trust)check(native.identities.containerSha256===independent.containerSha256&&native.identities.signedPayloadSha256===independent.signedPayloadSha256&&native.identities.content.sha256===independent.contentSha256,'VERIFIER_IDENTITY_MISMATCH')
    const {head,...publicIndependent}=independent
    return {native,independent:publicIndependent}
  })
}
export function assembleProduction(candidatePath,responsesPath,contextPath,newOutput){
  const candidate=received(candidatePath);document(candidate);check(candidate.signatures.length===0,'UNSIGNED_CANDIDATE_REQUIRED')
  const paths=received(responsesPath,65536);check(Array.isArray(paths)&&paths.length>0&&paths.length<=8,'SIGNATURE_LIMIT')
  const seen=new Set(),signatures=paths.map(p=>{
    check(typeof p==='string','INVALID_EDITORIAL_PATH');const response=received(resolve(dirname(responsesPath),p),65536)
    closed(response,['format','formatVersion','requestSha256','request','signature'])
    check(response.format==='mx.nomina.external-signature'&&response.formatVersion===1,'INVALID_EXTERNAL_SIGNATURE')
    const h=response.request?.protected,{request}=signingRequest(candidate,h?.purpose,h?.keyId)
    check(hash(response.request)===hash(request)&&response.requestSha256===hash(request),'EXTERNAL_REQUEST_BINDING_MISMATCH')
    check(!seen.has(h.keyId),'DUPLICATE_SIGNATURE_KEY');seen.add(h.keyId)
    const b=Buffer.from(response.signature??'','base64url');check(b.length===64&&b.toString('base64url')===response.signature,'INVALID_EXTERNAL_SIGNATURE_ENCODING')
    return {protected:request.protected,value:response.signature}
  }).sort((a,b)=>{const x=a.protected.purpose+'|'+a.protected.keyId,y=b.protected.purpose+'|'+b.protected.keyId;return x<y?-1:x>y?1:0})
  const envelope={signed:candidate.signed,signatures},verification=verifySnapshot(envelope,contextSnapshot(contextPath))
  output(newOutput,canonicalBytes(envelope))
  return {channel:'production',signedPayloadSha256:hash(envelope.signed),containerSha256:hash(envelope),verification,execution:'not-installed-not-authorized'}
}
export function verifyProductionFile(documentPath,contextPath){return verifySnapshot(received(documentPath),contextSnapshot(contextPath))}
export function productionReport(packagePath,contextPath,newOutput){
  const envelope=received(packagePath);check(document(envelope)==='mx.nomina.fiscal-package','PACKAGE_REQUIRED')
  const c=contextSnapshot(contextPath),verification=verifySnapshot(envelope,c),s=envelope.signed
  const report={format:'mx.nomina.editorial-publication-report',formatVersion:1,channel:'production',scope:'operator-selected-bootstrap; not-application-provisioning',publication:'not-published',execution:'not-installed-not-authorized',verifiedAt:c.now,operation:c.operation,
    packageId:s.manifest.packageId,parameterVersion:s.manifest.parameterVersion,exercise:s.manifest.exercise,supportedDates:s.manifest.supportedDates,publicationIdentity:s.publication,
    contentIdentity:s.manifest.contentIdentity,signedPayloadSha256:hash(s),containerSha256:hash(envelope),bootstrapSha256:hash(c.bootstrap),trustDocumentHashes:c.chain.map(hash),revisionStateSha256:hash(c.revisions),
    review:s.review,sources:s.manifest.sources,verification}
  output(newOutput,canonicalBytes(report));return {kind:report.format,reportSha256:hash(report),...verification,execution:report.execution}
}
export function runProductionCommand(command,args){
  const commands={
    'production-prepare':[2,prepareProduction], 'production-export':[5,exportProductionRequest],
    'production-assemble':[4,assembleProduction], 'production-verify':[2,verifyProductionFile], 'production-report':[3,productionReport],
  }
  const entry=commands[command];check(entry&&args.length===entry[0],'INVALID_PRODUCTION_COMMAND_ARGUMENTS');return entry[1](...args)
}
