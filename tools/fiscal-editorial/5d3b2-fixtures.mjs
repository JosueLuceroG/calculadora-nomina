import {fixture,updateContent} from './src/qa.mjs'
import {canonicalBytes} from './src/json.mjs'
import {qaKey,addQaSignature,sha256} from './src/crypto.mjs'
import {mkdirSync,writeFileSync,existsSync,renameSync} from 'node:fs'
const out=new URL('../../docs/evidence/5d3b2/fixtures/',import.meta.url)
if(existsSync(new URL('bootstrap.json',out))){if(!process.argv.includes('--archive-invalid-attempt'))throw new Error('Never overwrite QA fixtures');let n=1;while(existsSync(new URL(`../fixtures-attempt${n}/`,out)))n++;renameSync(out,new URL(`../fixtures-attempt${n}/`,out))}
mkdirSync(out,{recursive:true});const f=fixture(),put=(n,v,ext='json')=>writeFileSync(new URL(`${n}.${ext}`,out),canonicalBytes(v),{flag:'wx'}),now=new Date(),iso=d=>d.toISOString().replace(/\.\d{3}Z$/,'Z')
f.trust.issuedAt=iso(new Date(now.getTime()-60000));f.trust.expiresAt=iso(new Date(now.getTime()+60*86400000))
const futurePublisher=qaKey(),futureApprover=qaKey();const extra=f.trust.delegations.map((d,i)=>({...d,keyId:[futurePublisher,futureApprover][i].keyId,publicKey:[futurePublisher,futureApprover][i].publicKey,exercise:2027,streamId:'qa-2027-rejected'}));f.trust.delegations.push(...extra);f.trust.floors.push({...f.trust.floors[0],exercise:2027,streamId:'qa-2027-rejected'})
put('bootstrap',f.bootstrap);put('trust',f.rootEnvelope());put('package1',f.package(),'nomina-fiscal')
const p2=structuredClone(f.signed);p2.publication.revision=2;p2.registry.version='qa-synthetic-2026-revision2';p2.manifest.packageId='qa-synthetic-2026-revision2';p2.registry.imssConstants[0].data.workerRates['cash-benefits']='0.0030';p2.publication.changes.summary='QA synthetic rate, not official fiscal data and never used for calculation';updateContent(p2);put('package2',f.package(p2),'nomina-fiscal')
const conflict=structuredClone(p2);conflict.publication.changes.summary='QA conflicting payload';put('conflict2',f.package(conflict),'nomina-fiscal')
const bad=structuredClone(f.package());bad.signed.publication.changes.summary='QA tampered';put('bad-signature',bad,'nomina-fiscal')
const unknown=qaKey();let e={signed:f.signed,signatures:[]};e=addQaSignature(e,unknown,'package');e=addQaSignature(e,f.approver,'content-approval');put('unknown-key',e,'nomina-fiscal')
const revoked=structuredClone(f.trust);revoked.epoch=2;revoked.revokedKeyIds=[f.publisher.keyId];revoked.delegations=revoked.delegations.filter(d=>d.keyId!==f.publisher.keyId);put('trust-revoked',f.rootEnvelope(revoked))
const direct=structuredClone(f.trust);direct.epoch=2;direct.delegations.forEach(d=>d.operations=['direct']);put('trust-direct',f.rootEnvelope(direct));const pd=structuredClone(f.signed);pd.manifest.requiredCapabilities=['direct'];put('package-direct',f.package(pd),'nomina-fiscal')
const future=structuredClone(f.signed);future.manifest.exercise=2027;future.registry.exercise=2027;future.publication.streamId='qa-2027-rejected';updateContent(future);let futureEnvelope={signed:future,signatures:[]};futureEnvelope=addQaSignature(futureEnvelope,futurePublisher,'package');futureEnvelope=addQaSignature(futureEnvelope,futureApprover,'content-approval');put('package-2027',futureEnvelope,'nomina-fiscal')
const incompatible=structuredClone(f.signed);incompatible.conventions.monthlyIncomeReferenceDays='31';put('incompatible',f.package(incompatible),'nomina-fiscal')
const expired=structuredClone(f.trust);expired.issuedAt=iso(new Date(now.getTime()-10*86400000));expired.expiresAt=iso(new Date(now.getTime()-86400000));put('trust-expired',f.rootEnvelope(expired))
writeFileSync(new URL('manifest.json',out),JSON.stringify({kind:'QA public inputs only',createdAt:iso(now),privateMaterial:'ephemeral; never serialized',files:['package1.nomina-fiscal','package2.nomina-fiscal'],content1:sha256(canonicalBytes(f.signed.registry))},null,2)+'\n')
console.log('QA fixtures and public bootstrap prepared; no private material persisted')
