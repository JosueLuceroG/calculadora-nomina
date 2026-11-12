import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,rmSync,readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs'
import {join,resolve,dirname,basename} from 'node:path'
import {tmpdir} from 'node:os'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {sign} from 'node:crypto'
import {canonicalBytes} from '../src/json.mjs'
import {message,sha256} from '../src/crypto.mjs'
import {runNative} from '../src/qa.mjs'
import {prepareProduction,exportProductionRequest,assembleProduction,verifyProductionFile,productionReport,signingRequest} from '../src/production.mjs'
import {verifyProductionPackage,verifyProductionTrust} from '../src/production-independent.mjs'
import {setupFixture,assemblePackage,responses,testKey,publicRecord,put,get,NOW} from './production-fixture.mjs'

function setup(t,demonstration=false){
  const parent=join(tmpdir(),'opencode');assert(existsSync(parent))
  const requested=demonstration?process.env.NOMINA_R2B2_DEMO_DIR:null
  let dir
  if(requested){dir=resolve(requested);assert.equal(dirname(dir),resolve(parent));assert(basename(dir).startsWith('r2b2-demo-'));mkdirSync(dir)}
  else {dir=mkdtempSync(join(parent,'r2b2-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))}
  return setupFixture(dir)
}
function publicFilesOnly(folder){
  const inspect=value=>{if(Array.isArray(value))value.forEach(inspect);else if(value&&typeof value==='object')for(const[k,v]of Object.entries(value)){assert(!['privateKey','private_key','secretKey','seed','password','passphrase'].includes(k));inspect(v)}}
  for(const name of readdirSync(folder)){const bytes=readFileSync(join(folder,name));assert(!bytes.includes(Buffer.from('-----BEGIN PRIVATE KEY-----')));if(name.endsWith('.json')||name.endsWith('.nomina-fiscal'))inspect(JSON.parse(bytes))}
}
function independently(f,envelope){return verifyProductionPackage(envelope,get(f.bootstrap),get(f.chain).map(get),get(f.revisions),NOW,'direct')}
function envelopeFromResponses(f,list){return {signed:get(f.candidate).signed,signatures:get(list).map(p=>{const r=get(p);return {protected:r.request.protected,value:r.signature}}).sort((a,b)=>a.protected.purpose<b.protected.purpose?-1:1)}}
function renewTrust(f,mutate,tag){
  const s=structuredClone(f.trust);s.epoch=2;mutate(s)
  const source=join(f.dir,`${tag}-source.json`),candidate=join(f.dir,`${tag}-candidate.json`),out=join(f.dir,`${tag}-trust.json`)
  put(source,s);prepareProduction(source,candidate)
  const list=responses(f.dir,candidate,f.roots.slice(0,2).map(key=>({key,purpose:'trust-root'})),tag)
  assembleProduction(candidate,list,f.context,out);put(f.chain,[f.trustPath,out])
}

test('production editorial: external root quorum + publisher/approver, dual verification and public report',t=>{
  const f=setup(t,true),result=assemblePackage(f)
  assert.equal(result.verification.native.authentication,'authenticated');assert.equal(result.verification.native.editorialApproval,'approved-by-distinct-delegated-key')
  assert.equal(result.verification.independent.signedPayloadSha256,result.signedPayloadSha256);assert.equal(result.execution,'not-installed-not-authorized')
  const reportPath=join(f.dir,'publication-report.json'),cli=fileURLToPath(new URL('../src/cli.mjs',import.meta.url))
  const summary=JSON.parse(execFileSync(process.execPath,[cli,'production-report',f.packagePath,f.context,reportPath],{encoding:'utf8'}))
  const report=get(reportPath);assert.equal(summary.reportSha256,sha256(canonicalBytes(report)));assert.equal(report.publication,'not-published');assert.equal(report.scope,'operator-selected-bootstrap; not-application-provisioning');assert(report.sources.length>0)
  const inverseContext=join(f.dir,'inverse-context.json');put(inverseContext,{...get(f.context),operation:'inverse'});assert(verifyProductionFile(f.packagePath,inverseContext).native.authentication)
  publicFilesOnly(f.dir)
  if(process.env.NOMINA_R2B2_DEMO_DIR)console.log(JSON.stringify({demonstration:'ephemeral-test-only',directory:f.dir,bootstrapSha256:report.bootstrapSha256,contentSha256:report.contentIdentity.sha256,signedPayloadSha256:report.signedPayloadSha256,containerSha256:report.containerSha256,reportSha256:summary.reportSha256,privateMaterialWritten:false,applicationAuthority:'unchanged'}))
})

test('exported messages match native bytes and exact protocol for all three signing roles',t=>{
  const f=setup(t)
  for(const [candidate,key,purpose] of [[f.trustCandidate,f.roots[2],'trust-root'],[f.candidate,f.publisher,'package'],[f.candidate,f.approver,'content-approval']]){
    const requestPath=join(f.dir,`${purpose}.request.json`),messagePath=join(f.dir,`${purpose}.bin`),r=exportProductionRequest(candidate,purpose,key.keyId,requestPath,messagePath),request=get(requestPath),bytes=readFileSync(messagePath)
    assert.deepEqual(bytes,runNative(['signing-message',candidate,purpose,key.keyId],{raw:true}));assert.deepEqual(bytes,message(request.protected,get(candidate).signed));assert.equal(r.messageSha256,sha256(bytes));assert.equal(r.requestSha256,sha256(canonicalBytes(request)))
  }
})

test('altered external signature is rejected without writing an assembled artifact',t=>{
  const f=setup(t),list=responses(f.dir,f.candidate,[{key:f.publisher,purpose:'package'},{key:f.approver,purpose:'content-approval'}]),path=get(list)[0],r=get(path)
  const bytes=Buffer.from(r.signature,'base64url');bytes[0]^=1;r.signature=bytes.toString('base64url');put(path,r)
  assert.throws(()=>assembleProduction(f.candidate,list,f.context,f.packagePath),/INVALID_SIGNATURE/);assert(!existsSync(f.packagePath))
  assert.throws(()=>independently(f,envelopeFromResponses(f,list)),/EDITORIAL_SIGNATURE/)
})

test('correct cryptography with swapped editorial purposes fails delegation checks',t=>{
  const f=setup(t),list=responses(f.dir,f.candidate,[{key:f.publisher,purpose:'content-approval'},{key:f.approver,purpose:'package'}])
  assert.throws(()=>assembleProduction(f.candidate,list,f.context,f.packagePath),/DELEGATION_SCOPE_MISMATCH/)
  const envelope={signed:get(f.candidate).signed,signatures:get(list).map(p=>{const r=get(p);return {protected:r.request.protected,value:r.signature}}).sort((a,b)=>a.protected.purpose<b.protected.purpose?-1:1)}
  assert.throws(()=>independently(f,envelope),/DELEGATION_SCOPE_OR_ROLE/)
})

test('one key cannot occupy both package and content-approval roles',t=>{
  const f=setup(t),list=responses(f.dir,f.candidate,[{key:f.publisher,purpose:'package'},{key:f.publisher,purpose:'content-approval'}])
  assert.throws(()=>assembleProduction(f.candidate,list,f.context,f.packagePath),/DUPLICATE_SIGNATURE_KEY/)
})

test('custodian quorum is two distinct roots; one signature cannot assemble trust',t=>{
  const f=setup(t),empty=join(f.dir,'empty-chain.json'),context=join(f.dir,'initial-context.json');put(empty,[]);put(context,{...get(f.context),chain:empty})
  const list=responses(f.dir,f.trustCandidate,[{key:f.roots[0],purpose:'trust-root'}],'single-root'),out=join(f.dir,'single-root-trust.json')
  assert.throws(()=>assembleProduction(f.trustCandidate,list,context,out),/ROOT_QUORUM_NOT_MET/);assert(!existsSync(out))
  const response=get(get(list)[0]),e={signed:f.trust,signatures:[{protected:response.request.protected,value:response.signature}]}
  assert.throws(()=>verifyProductionTrust(get(f.bootstrap),[e],NOW),/ROOT_QUORUM/)
})

test('request metadata or payload changed after signing fails binding',t=>{
  const f=setup(t),list=responses(f.dir,f.candidate,[{key:f.publisher,purpose:'package'},{key:f.approver,purpose:'content-approval'}]),candidate=get(f.candidate)
  candidate.signed.review.recordId='changed-after-external-signing';put(f.candidate,candidate)
  assert.throws(()=>assembleProduction(f.candidate,list,f.context,f.packagePath),/EXTERNAL_REQUEST_BINDING_MISMATCH/)
})

test('tampered signing-request hash cannot be used with an otherwise valid signature',t=>{
  const f=setup(t),list=responses(f.dir,f.candidate,[{key:f.publisher,purpose:'package'},{key:f.approver,purpose:'content-approval'}]),p=get(list)[0],r=get(p)
  r.request.messageSha256='0'.repeat(64);r.requestSha256=sha256(canonicalBytes(r.request));put(p,r)
  assert.throws(()=>assembleProduction(f.candidate,list,f.context,f.packagePath),/EXTERNAL_REQUEST_BINDING_MISMATCH/)
})

test('fiscal content modified after assembly fails native and independent integrity checks',t=>{
  const f=setup(t);assemblePackage(f);const envelope=get(f.packagePath);envelope.signed.registry.uma[0].data.daily='113.15';put(f.packagePath,envelope)
  assert.throws(()=>verifyProductionFile(f.packagePath,f.context),/CONTENT_HASH_MISMATCH/);assert.throws(()=>independently(f,envelope),/CONTENT_HASH/)
})

test('wrong channel and wrong document purpose are rejected',t=>{
  const f=setup(t),source=join(f.dir,'qa-source.json');put(source,{...f.source,channel:'qa'})
  assert.throws(()=>prepareProduction(source,join(f.dir,'qa-candidate.json')),/EDITORIAL_PRODUCTION_CHANNEL_REQUIRED/)
  assert.throws(()=>signingRequest(get(f.candidate),'trust-root',f.publisher.keyId),/INVALID_EDITORIAL_PURPOSE/)
  assemblePackage(f);const e=get(f.packagePath);e.signed.channel='qa';put(f.packagePath,e)
  assert.throws(()=>verifyProductionFile(f.packagePath,f.context),/EDITORIAL_PRODUCTION_CHANNEL_REQUIRED/);assert.throws(()=>independently(f,e),/PACKAGE_CHANNEL_OR_FORMAT/)
})

test('native production mode still fails closed and cannot fall back to QA',t=>{
  const f=setup(t);assemblePackage(f)
  const r=runNative(['verify',f.packagePath,f.bootstrap,f.chain,f.revisions,NOW,'direct','production'])
  assert.equal(r.ok,false);assert.equal(r.error.code,'PRODUCTION_BOOTSTRAP_MISSING')
})

test('delegation channel remains mandatory in both verifiers',t=>{
  const f=setup(t),s=structuredClone(f.trust);s.delegations[0].channel='qa'
  const source=join(f.dir,'wrong-trust-source.json'),candidate=join(f.dir,'wrong-trust-candidate.json'),empty=join(f.dir,'empty.json'),context=join(f.dir,'wrong-trust-context.json');put(source,s);put(empty,[]);put(context,{...get(f.context),chain:empty});prepareProduction(source,candidate)
  const list=responses(f.dir,candidate,f.roots.slice(0,2).map(key=>({key,purpose:'trust-root'})),'bad-delegation')
  assert.throws(()=>assembleProduction(candidate,list,context,join(f.dir,'wrong-trust.json')),/INVALID_DELEGATION/)
  const signatures=get(list).map(p=>{const r=get(p);return {protected:r.request.protected,value:r.signature}}).sort((a,b)=>a.protected.keyId<b.protected.keyId?-1:1)
  assert.throws(()=>verifyProductionTrust(get(f.bootstrap),[{signed:s,signatures}],NOW),/DELEGATION_ROLE_OR_CHANNEL/)
})

test('root replacement verifies old/new quorums and a chain from the selected initial anchor',t=>{
  const f=setup(t),newRoots=Array.from({length:3},testKey),s={...f.trust,rootVersion:2,epoch:2,rootKeys:newRoots.map(publicRecord)},source=join(f.dir,'rotation-source.json'),candidate=join(f.dir,'rotation-candidate.json'),out=join(f.dir,'rotation.json')
  put(source,s);prepareProduction(source,candidate)
  const list=responses(f.dir,candidate,[...f.roots.slice(0,2),...newRoots.slice(0,2)].map(key=>({key,purpose:'trust-root'})),'rotation')
  const result=assembleProduction(candidate,list,f.context,out);assert.equal(result.verification.native.rootVersion,2);assert.equal(result.verification.independent.rootVersion,2)
  put(f.chain,[f.trustPath,out]);assemblePackage(f);assert.equal(verifyProductionFile(f.packagePath,f.context).native.rootVersion,2)
})

test('local revision floors are not bypassed by valid signatures',t=>{
  const f=setup(t);assemblePackage(f)
  put(f.revisions,[{channel:'production',streamId:f.source.publication.streamId,exercise:2026,ruleProfileId:f.source.manifest.requiredRuleProfileId,streamEpoch:1,revision:2,payloadSha256:sha256(canonicalBytes(f.source))}])
  assert.throws(()=>verifyProductionFile(f.packagePath,f.context),/REVISION_ROLLBACK/);assert.throws(()=>independently(f,get(f.packagePath)),/REVISION_ROLLBACK_OR_CONFLICT/)
})

test('delegated operations cannot authorize an inverse operation implicitly',t=>{
  const f=setup(t);assemblePackage(f);renewTrust(f,s=>s.delegations.forEach(d=>{d.operations=['direct']}),'direct-only')
  const context=join(f.dir,'inverse-context.json');put(context,{...get(f.context),operation:'inverse'})
  assert.throws(()=>verifyProductionFile(f.packagePath,context),/EDITORIAL_OPERATION_NOT_AUTHORIZED/)
  assert.throws(()=>verifyProductionPackage(get(f.packagePath),get(f.bootstrap),get(f.chain).map(get),[],NOW,'inverse'),/EDITORIAL_VALIDITY_OR_OPERATION/)
})

test('signed withdrawals and revocations invalidate an otherwise signed package',t=>{
  const f=setup(t);assemblePackage(f);renewTrust(f,s=>{s.withdrawnPayloads=[sha256(canonicalBytes(f.source))]},'withdrawn')
  assert.throws(()=>verifyProductionFile(f.packagePath,f.context),/PAYLOAD_WITHDRAWN/);assert.throws(()=>independently(f,get(f.packagePath)),/PAYLOAD_WITHDRAWN/)
  const other=setup(t);assemblePackage(other);renewTrust(other,s=>{s.revokedKeyIds=[other.publisher.keyId];s.delegations=s.delegations.filter(d=>d.keyId!==other.publisher.keyId)},'revoked')
  assert.throws(()=>verifyProductionFile(other.packagePath,other.context),/KEY_REVOKED/);assert.throws(()=>independently(other,get(other.packagePath)),/DELEGATION_SCOPE_OR_ROLE/)
})

test('different private signer cannot impersonate the requested publisher key',t=>{
  const f=setup(t),list=responses(f.dir,f.candidate,[{key:f.publisher,purpose:'package'},{key:f.approver,purpose:'content-approval'}]),p=get(list)[0],r=get(p)
  r.signature=sign(null,message(r.request.protected,f.source),testKey().privateKey).toString('base64url');put(p,r)
  assert.throws(()=>assembleProduction(f.candidate,list,f.context,f.packagePath),/INVALID_SIGNATURE/)
})

test('existing reports are never overwritten',t=>{
  const f=setup(t);assemblePackage(f);const report=join(f.dir,'report.json');productionReport(f.packagePath,f.context,report);const before=readFileSync(report)
  assert.throws(()=>productionReport(f.packagePath,f.context,report),/EEXIST/);assert.deepEqual(readFileSync(report),before)
})
