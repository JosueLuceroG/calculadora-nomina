import {qaKey,addQaSignature,sha256,verifyPrimitive} from "./crypto.mjs"
import {canonicalBytes,requireCanonical,readBounded} from "./json.mjs"
import {readFileSync,writeFileSync} from "node:fs"
import {execFileSync} from "node:child_process"
import {join} from "node:path"
import {fileURLToPath} from "node:url"
export const NOW="2026-10-23T12:00:00Z"
export const sourcePath=fileURLToPath(new URL("../../../docs/evidence/5d3a/editorial-source-2026.json",import.meta.url))
export const nativePath=process.env.NOMINA_NATIVE_VERIFY??fileURLToPath(new URL(`../native-verify/target/debug/nomina-fiscal-verify-editorial${process.platform==="win32"?".exe":""}`,import.meta.url))
const pub=key=>({keyId:key.keyId,publicKey:key.publicKey})
export function fixture(){
  const signed=JSON.parse(readFileSync(sourcePath,"utf8")),roots=Array.from({length:3},qaKey),publisher=qaKey(),approver=qaKey()
  const scope=key=>({keyId:key.keyId,publicKey:key.publicKey,purpose:key===publisher?"package":"content-approval",channel:"qa",exercise:2026,parameterSchemaId:signed.manifest.parameterSchemaId,ruleProfileId:signed.manifest.requiredRuleProfileId,contextualPolicyId:signed.manifest.requiredContextualPolicyId,streamId:signed.publication.streamId,streamEpoch:1,minimumRevision:1,maximumRevision:1000,notBefore:"2026-01-01T00:00:00Z",notAfter:"2027-01-01T00:00:00Z",operations:["direct","inverse"]})
  const trust={format:"mx.nomina.fiscal-trust",formatVersion:1,canonicalization:"RFC8785",channel:"qa",rootVersion:1,epoch:1,issuedAt:"2026-10-22T00:00:00Z",expiresAt:"2027-01-01T00:00:00Z",rootValidity:{from:"2026-01-01T00:00:00Z",through:"2031-01-01T00:00:00Z"},rootKeys:roots.map(pub),threshold:2,delegations:[scope(publisher),scope(approver)],revokedKeyIds:[],withdrawnPayloads:[],floors:[{streamId:signed.publication.streamId,exercise:2026,ruleProfileId:signed.manifest.requiredRuleProfileId,streamEpoch:1,minimumRevision:1,reason:null}]}
  const f={signed,roots,publisher,approver,trust,bootstrap:{channel:"qa",rootKeys:roots.map(pub)}}
  f.package=(s=f.signed,keys=[f.publisher,f.approver])=>keys.reduce((e,key)=>addQaSignature(e,key,key===f.publisher?"package":"content-approval"),{signed:s,signatures:[]})
  f.rootEnvelope=(s=f.trust,keys=f.roots.slice(0,2))=>keys.reduce((e,key)=>addQaSignature(e,key,"trust-root"),{signed:s,signatures:[]})
  return f
}
export function runNative(args,{raw=false}={}){try{const stdout=execFileSync(nativePath,args,{encoding:raw?undefined:"utf8",maxBuffer:5*1024*1024,timeout:30000});return raw?stdout:JSON.parse(stdout)}catch(error){if(error.stdout?.length&&!raw)return JSON.parse(error.stdout.toString());throw error}}
export function writeContext(dir,f,updates=[f.rootEnvelope()],floors=[]){const bootstrap=join(dir,"bootstrap-public.json"),chain=join(dir,"trust-chain.json"),floor=join(dir,"revisions.json");writeFileSync(bootstrap,canonicalBytes(f.bootstrap));const paths=updates.map((update,i)=>{const path=join(dir,`trust-${i}.json`);writeFileSync(path,canonicalBytes(update));return path});writeFileSync(chain,canonicalBytes(paths));writeFileSync(floor,canonicalBytes(floors));return{bootstrap,chain,floor}}
export function nativeVerify(dir,f,envelope=f.package(),{updates,floors,now=NOW,operation="direct",mode="qa",bytes}={}){const paths=writeContext(dir,f,updates??[f.rootEnvelope()],floors??[]),path=join(dir,"candidate.nomina-fiscal");writeFileSync(path,bytes??canonicalBytes(envelope));return runNative(["verify",path,paths.bootstrap,paths.chain,paths.floor,now,operation,mode])}
/** Independent OpenSSL-backed checks; does not claim native fiscal compatibility. */
export function verifyNode(envelope,bootstrap,trustEnvelope,now=NOW){
  if(bootstrap.channel!=="qa"||trustEnvelope.signed.channel!=="qa"||envelope.signed.channel!=="qa")throw new Error("CHANNEL_MISMATCH")
  const roots=new Map(bootstrap.rootKeys.map(k=>[k.keyId,k]));if(roots.size!==3||trustEnvelope.signed.threshold!==2)throw new Error("ROOT_POLICY")
  const seen=new Set();for(const record of trustEnvelope.signatures){const key=roots.get(record.protected.keyId);if(!key||seen.has(key.keyId)||record.protected.purpose!=="trust-root"||!verifyPrimitive(record,trustEnvelope.signed,key.publicKey))throw new Error("ROOT_SIGNATURE");seen.add(key.keyId)}if(seen.size<2)throw new Error("ROOT_QUORUM")
  const trust=trustEnvelope.signed;if(now<trust.issuedAt||now>=trust.expiresAt)throw new Error("TRUST_EXPIRED")
  const roles=new Set(),ids=new Set();for(const record of envelope.signatures){const d=trust.delegations.find(d=>d.keyId===record.protected.keyId);if(!d||ids.has(d.keyId)||trust.revokedKeyIds.includes(d.keyId)||d.purpose!==record.protected.purpose||d.channel!==envelope.signed.channel||now<d.notBefore||now>=d.notAfter||!verifyPrimitive(record,envelope.signed,d.publicKey))throw new Error("EDITORIAL_SIGNATURE");roles.add(d.purpose);ids.add(d.keyId)}
  if(!roles.has("package")||!roles.has("content-approval"))throw new Error("EDITORIAL_ROLES")
  if(sha256(canonicalBytes(envelope.signed.registry))!==envelope.signed.manifest.contentIdentity.sha256)throw new Error("CONTENT_HASH")
  return{kind:"independent-OpenSSL-authentication",publisherAndApproval:true,contentSha256:envelope.signed.manifest.contentIdentity.sha256,execution:"not-installed-not-authorized"}
}
export function updateContent(signed){signed.manifest.parameterVersion=signed.registry.version;signed.manifest.exercise=signed.registry.exercise;signed.manifest.supportedDates=structuredClone(signed.registry.supportedDates);signed.manifest.contentIdentity.sha256=sha256(canonicalBytes(signed.registry));return signed}
export function readReceived(path){return requireCanonical(readBounded(path))}
