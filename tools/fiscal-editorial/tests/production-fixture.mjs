// Test-only external signers. Private KeyObjects stay in memory; never export/log them.
import {generateKeyPairSync,sign} from 'node:crypto'
import {readFileSync,writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {canonicalBytes} from '../src/json.mjs'
import {keyId,sha256} from '../src/crypto.mjs'
import {prepareProduction,exportProductionRequest,assembleProduction} from '../src/production.mjs'
export const NOW='2026-11-04T12:00:00Z'
export function testKey(){
  const {privateKey,publicKey}=generateKeyPairSync('ed25519'),bytes=publicKey.export({type:'spki',format:'der'}).subarray(-32)
  return {privateKey,publicKey:bytes.toString('base64url'),keyId:keyId(bytes)}
}
export const publicRecord=({keyId,publicKey})=>({keyId,publicKey})
export const put=(path,v)=>writeFileSync(path,canonicalBytes(v))
export const get=path=>JSON.parse(readFileSync(path,'utf8'))
export function externalResponse(requestPath,messagePath,key){
  const request=get(requestPath),bytes=readFileSync(messagePath)
  if(sha256(bytes)!==request.messageSha256||bytes.length!==request.messageBytes)throw new Error('TEST_SIGNER_MESSAGE_MISMATCH')
  return {format:'mx.nomina.external-signature',formatVersion:1,requestSha256:sha256(canonicalBytes(request)),request,signature:sign(null,bytes,key.privateKey).toString('base64url')}
}
export function responses(dir,candidate,signers,tag='sign'){
  const paths=signers.map(({key,purpose},i)=>{
    const request=join(dir,`${tag}-${i}.request.json`),message=join(dir,`${tag}-${i}.message.bin`),response=join(dir,`${tag}-${i}.response.json`)
    exportProductionRequest(candidate,purpose,key.keyId,request,message);put(response,externalResponse(request,message,key));return response
  })
  const path=join(dir,`${tag}-responses.json`);put(path,paths);return path
}
export function setupFixture(dir){
  const roots=Array.from({length:3},testKey),publisher=testKey(),approver=testKey()
  const sourcePath=fileURLToPath(new URL('../../../docs/evidence/5d3a/editorial-source-2026.json',import.meta.url)),source=get(sourcePath)
  source.channel='production';source.review.recordId='r2b2-ephemeral-test-not-real-publication';source.publication.publishedAt='2026-11-01T00:00:00Z'
  const delegation=(key,purpose)=>({...publicRecord(key),purpose,channel:'production',exercise:2026,parameterSchemaId:source.manifest.parameterSchemaId,ruleProfileId:source.manifest.requiredRuleProfileId,contextualPolicyId:source.manifest.requiredContextualPolicyId,
    streamId:source.publication.streamId,streamEpoch:1,minimumRevision:1,maximumRevision:1000,notBefore:'2026-11-01T00:00:00Z',notAfter:'2026-12-01T00:00:00Z',operations:['direct','inverse']})
  const trust={format:'mx.nomina.fiscal-trust',formatVersion:1,canonicalization:'RFC8785',channel:'production',rootVersion:1,epoch:1,issuedAt:'2026-11-01T00:00:00Z',expiresAt:'2026-12-01T00:00:00Z',rootValidity:{from:'2026-01-01T00:00:00Z',through:'2031-01-01T00:00:00Z'},rootKeys:roots.map(publicRecord),threshold:2,
    delegations:[delegation(publisher,'package'),delegation(approver,'content-approval')],revokedKeyIds:[],withdrawnPayloads:[],floors:[{streamId:source.publication.streamId,exercise:2026,ruleProfileId:source.manifest.requiredRuleProfileId,streamEpoch:1,minimumRevision:1,reason:null}]}
  const bootstrap=join(dir,'bootstrap.json'),chain=join(dir,'chain.json'),revisions=join(dir,'revisions.json'),context=join(dir,'context.json'),trustSource=join(dir,'trust-source.json'),trustCandidate=join(dir,'trust-candidate.json'),trustPath=join(dir,'trust.json'),packageSource=join(dir,'package-source.json'),candidate=join(dir,'candidate.nomina-fiscal'),packagePath=join(dir,'package.nomina-fiscal')
  put(bootstrap,{channel:'production',rootKeys:roots.map(publicRecord)});put(chain,[]);put(revisions,[]);put(context,{bootstrap,chain,revisions,now:NOW,operation:'direct'});put(trustSource,trust);put(packageSource,source)
  prepareProduction(trustSource,trustCandidate);prepareProduction(packageSource,candidate)
  const rootResponses=responses(dir,trustCandidate,roots.slice(0,2).map(key=>({key,purpose:'trust-root'})),'roots')
  assembleProduction(trustCandidate,rootResponses,context,trustPath);put(chain,[trustPath])
  return {dir,roots,publisher,approver,source,trust,bootstrap,chain,revisions,context,trustSource,trustCandidate,trustPath,candidate,packagePath,rootResponses}
}
export function assemblePackage(f,tag='package'){
  const list=responses(f.dir,f.candidate,[{key:f.publisher,purpose:'package'},{key:f.approver,purpose:'content-approval'}],tag)
  return assembleProduction(f.candidate,list,f.context,f.packagePath)
}
