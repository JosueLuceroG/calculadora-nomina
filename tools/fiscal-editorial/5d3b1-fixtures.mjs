// Public QA inputs only; root/private material is ephemeral and never serialized.
import {fixture,updateContent} from './src/qa.mjs'
import {canonicalBytes} from './src/json.mjs'
import {addQaSignature} from './src/crypto.mjs'
import {mkdirSync,writeFileSync,existsSync} from 'node:fs'
const out=new URL('../../docs/evidence/5d3b1/fixtures/',import.meta.url)
if(existsSync(new URL('bootstrap.json',out)))throw new Error('Never overwrite public QA fixtures')
mkdirSync(out,{recursive:true});const f=fixture(),put=(name,v)=>writeFileSync(new URL(name+'.json',out),canonicalBytes(v),{flag:'wx'})
put('bootstrap',f.bootstrap);put('trust1',f.rootEnvelope());put('package1',f.package())
const p2=structuredClone(f.signed);p2.publication.revision=2;p2.publication.changes.summary='QA revision2; identical fiscal parameters, no normative publication';put('package2',f.package(p2))
const conflict=structuredClone(p2);conflict.publication.changes.summary='QA conflicting signed payload';put('conflict2',f.package(conflict))
const alias=structuredClone(f.signed);alias.manifest.packageId='qa-other-package-same-content';alias.publication.revision=3;put('identity-alias',f.package(alias))
const revoked=structuredClone(f.trust);revoked.epoch=2;revoked.revokedKeyIds=[f.publisher.keyId];revoked.delegations=revoked.delegations.filter(d=>d.keyId!==f.publisher.keyId);put('revoked',f.rootEnvelope(revoked))
const withdrawn=structuredClone(f.trust);withdrawn.epoch=2;const {sha256}=await import('./src/crypto.mjs');withdrawn.withdrawnPayloads=[sha256(canonicalBytes(f.signed))];put('withdrawn',f.rootEnvelope(withdrawn))
const epoch=structuredClone(f.trust);epoch.epoch=2;epoch.floors[0].streamEpoch=2;epoch.floors[0].reason='QA stream epoch renewal';epoch.delegations.forEach(d=>d.streamEpoch=2);put('epoch2',f.rootEnvelope(epoch));const pe=structuredClone(p2);pe.publication.streamEpoch=2;pe.publication.revision=1;put('package-epoch2',f.package(pe))
const floor=structuredClone(f.trust);floor.epoch=2;floor.floors[0].minimumRevision=2;floor.delegations.forEach(d=>d.minimumRevision=2);put('floor2',f.rootEnvelope(floor))
const direct=structuredClone(f.trust);direct.epoch=2;direct.delegations.forEach(d=>d.operations=['direct']);put('trust-direct',f.rootEnvelope(direct));const pd=structuredClone(p2);pd.manifest.requiredCapabilities=['direct'];put('package-direct',f.package(pd))
const grant={format:'mx.nomina.fiscal-rollback',formatVersion:1,channel:'qa',streamId:f.signed.publication.streamId,streamEpoch:1,targetPayloadSha256:sha256(canonicalBytes(f.signed)),previousMinimumRevision:2,expiresAt:'2026-10-28T00:00:00Z',reason:'QA evidence only, no activation',nonce:'qa-5d3b1-permit-001'};let ge={signed:grant,signatures:[]};for(const k of f.roots.slice(0,2))ge=addQaSignature(ge,k,'rollback-authorization');put('rollback',ge)
const changed=structuredClone(p2);changed.registry.version='qa-only-2026-copy';changed.manifest.packageId='qa-only-2026-copy';updateContent(changed);put('other-content',f.package(changed))
console.log('Public QA fixtures created; no private material persisted')
