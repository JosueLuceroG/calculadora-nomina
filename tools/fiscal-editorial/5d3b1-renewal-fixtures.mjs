import {fixture} from './src/qa.mjs'
import {canonicalBytes} from './src/json.mjs'
import {qaKey,addQaSignature} from './src/crypto.mjs'
import {mkdirSync,writeFileSync,existsSync} from 'node:fs'
const out=new URL('../../docs/evidence/5d3b1/renewal/',import.meta.url)
if(existsSync(new URL('bootstrap.json',out)))throw new Error('Do not overwrite QA evidence')
mkdirSync(out,{recursive:true});const f=fixture(),put=(n,v)=>writeFileSync(new URL(n+'.json',out),canonicalBytes(v),{flag:'wx'}),pub=k=>({keyId:k.keyId,publicKey:k.publicKey})
put('bootstrap',f.bootstrap)
const original=structuredClone(f.trust);original.issuedAt='2026-01-01T00:00:00Z';original.expiresAt='2026-03-31T00:00:00Z';put('initial',f.rootEnvelope(original))
const secondRoots=Array.from({length:3},qaKey),thirdRoots=Array.from({length:3},qaKey)
const middle={...structuredClone(original),rootVersion:2,epoch:2,rootKeys:secondRoots.map(pub),issuedAt:'2026-03-30T00:00:00Z',expiresAt:'2026-06-01T00:00:00Z'}
const final={...structuredClone(f.trust),rootVersion:3,epoch:3,rootKeys:thirdRoots.map(pub)}
function signed(s,old,next){let e={signed:s,signatures:[]};for(const k of [...old.slice(0,2),...next.slice(0,2)])e=addQaSignature(e,k,'trust-root');return e}
put('middle',signed(middle,f.roots,secondRoots));put('final',signed(final,secondRoots,thirdRoots));put('package',f.package());console.log('Independent public root-renewal QA fixtures created')
