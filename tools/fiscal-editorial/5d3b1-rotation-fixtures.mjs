import {fixture} from './src/qa.mjs'
import {qaKey,addQaSignature} from './src/crypto.mjs'
import {canonicalBytes} from './src/json.mjs'
import {mkdirSync,writeFileSync,existsSync} from 'node:fs'
const out=new URL('../../docs/evidence/5d3b1/rotation/',import.meta.url)
if(existsSync(new URL('bootstrap.json',out)))throw new Error('Never overwrite QA rotation evidence')
mkdirSync(out,{recursive:true});const f=fixture(),put=(n,v)=>writeFileSync(new URL(n+'.json',out),canonicalBytes(v),{flag:'wx'})
put('bootstrap',f.bootstrap);put('trust1',f.rootEnvelope());put('package1',f.package())
const publisher=qaKey(),approver=qaKey(),next=structuredClone(f.trust);next.epoch=2;next.revokedKeyIds=[f.publisher.keyId,f.approver.keyId];next.delegations=next.delegations.map((d,i)=>({...d,keyId:[publisher,approver][i].keyId,publicKey:[publisher,approver][i].publicKey}));put('trust2',f.rootEnvelope(next));let envelope={signed:f.signed,signatures:[]};envelope=addQaSignature(envelope,publisher,'package');envelope=addQaSignature(envelope,approver,'content-approval');put('package-resigned',envelope);console.log('Public editorial-rotation fixtures created; identical signed payload')
