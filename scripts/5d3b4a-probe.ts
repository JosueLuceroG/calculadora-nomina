// Test-only entry point, bundled by the QA harness; not imported by the application.
import {ed25519} from '@noble/curves/ed25519.js'
import {sha256,sha512} from '@noble/hashes/sha2.js'
import {decodeFiscalSnapshot,encodeFiscalSnapshot} from '../src/features/storage/snapshot'
import {hashBytes,jcs} from '../src/features/documents/evidence-v3'
type Input={rfc:{name:string;public:string;message:string;signature:string}[];wycheproof:{testGroups:{publicKey:{pk:string};tests:{tcId:number;msg:string;sig:string;result:string}[]}[]};jcs:{input:string;output:string}[];parity:{name:string;payload:string;accepted:boolean}[];fixtures:{name:string;payload:string}[];maximum:{payload:string};plus:{payload:string}}
const hex=(b:Uint8Array)=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join('')
const bytes=(s:string)=>Uint8Array.from(s.match(/../g)??[],x=>Number.parseInt(x,16))
// v1/v2 compatibility is confined to this BEFORE/AFTER test probe. Production
// adaptation uses only the reviewed v2 API after migration.
function publicPoint(b:Uint8Array){const P=ed25519.Point as any;const p=P.fromBytes?P.fromBytes(b):P.fromHex(b);const encoded:Uint8Array=p.toBytes?p.toBytes():p.toRawBytes();if(p.isSmallOrder()||!p.isTorsionFree()||hex(encoded)!==hex(b))throw Error('invalid public point');return p}
function signature(pk:string,msg:string,sig:string){try{const p=bytes(pk);publicPoint(p);return ed25519.verify(bytes(sig),bytes(msg),p,{zip215:false})}catch{return false}}
export function run(input:Input){
 const checks:{group:string;id:string;expected:unknown;actual:unknown;passed:boolean}[]=[]
 const check=(group:string,id:string,expected:unknown,actual:unknown)=>checks.push({group,id,expected,actual,passed:JSON.stringify(expected)===JSON.stringify(actual)})
 for(const v of input.rfc)check('rfc8032',v.name,true,signature(v.public,v.message,v.signature))
 // Same strict classification as the unchanged Rust core test: only `valid`
 // is accepted; Wycheproof `acceptable` cases are rejected by this profile.
 for(const g of input.wycheproof.testGroups)for(const v of g.tests){if(!['valid','invalid','acceptable'].includes(v.result))throw Error('Unreviewed Wycheproof classification');check('wycheproof',String(v.tcId),v.result==='valid',signature(g.publicKey.pk,v.msg,v.sig))}
 const r=input.rfc[0],L='edd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010'
 const malformed=[['S-equals-order',r.public,r.message,r.signature.slice(0,64)+L],['identity-R',r.public,r.message,'01'+'00'.repeat(31)+r.signature.slice(64)],['signature-63',r.public,r.message,r.signature.slice(0,-2)],['signature-65',r.public,r.message,r.signature+'00'],['key-31',r.public.slice(0,-2),r.message,r.signature],['key-33',r.public+'00',r.message,r.signature],['changed-message',r.public,'00',r.signature],['identity-key','01'+'00'.repeat(31),'','01'+'00'.repeat(63)]]
 for(const[id,pk,msg,sig]of malformed)check('strict-signatures',id,false,signature(pk,msg,sig))
 for(const[id,pk,expected]of [['rfc-key',r.public,true],['zero','00'.repeat(32),false],['identity','01'+'00'.repeat(31),false],['minus-identity','ec'+'ff'.repeat(30)+'7f',false],['noncanonical-p','ed'+'ff'.repeat(30)+'7f',false],['noncanonical-maximum','ff'.repeat(32),false],['short','00'.repeat(31),false],['long','00'.repeat(33),false]] as const){let valid=true;try{publicPoint(bytes(pk))}catch{valid=false}check('public-points',id,expected,valid)}
 const encoder=new TextEncoder()
 for(const[id,text,h256,h512]of [
  ['empty','','e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855','cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e'],
  ['abc','abc','ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad','ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f']]){const b=encoder.encode(text);check('hashes','sha256-'+id,h256,hex(sha256(b)));check('hashes','production-sha256-'+id,h256,hashBytes(b));check('hashes','sha512-'+id,h512,hex(sha512(b)));check('hashes','sha512-incremental-'+id,h512,hex(sha512.create().update(b.subarray(0,1)).update(b.subarray(1)).digest()))}
 input.jcs.forEach((v,i)=>check('jcs',String(i),v.output,jcs(JSON.parse(v.input))))
 check('jcs','UTF16-order','{"😀":2,"דּ":1}',jcs({'דּ':1,'😀':2}));check('jcs','no-normalization',false,jcs({v:'A\u030a'})===jcs({v:'Å'}));let unicodeRejected=false;try{jcs({v:'\ud800'})}catch{unicodeRejected=true}check('jcs','lone-surrogate',true,unicodeRejected)
 for(const c of input.parity){let accepted=true;try{decodeFiscalSnapshot(c.payload)}catch{accepted=false}check('documents',c.name,c.accepted,accepted)}
 for(const f of input.fixtures){let same=false;try{same=encodeFiscalSnapshot(decodeFiscalSnapshot(f.payload))===f.payload}catch{}check('original-bytes',f.name,true,same)}
 let maximum=false;try{maximum=encodeFiscalSnapshot(decodeFiscalSnapshot(input.maximum.payload))===input.maximum.payload}catch{}check('budget','valid-3145728',true,maximum)
 let plus=false;try{decodeFiscalSnapshot(input.plus.payload)}catch{plus=true}check('budget','reject-3145729',true,plus)
 const groups=Object.fromEntries([...new Set(checks.map(c=>c.group))].map(group=>[group,{total:checks.filter(c=>c.group===group).length,failed:checks.filter(c=>c.group===group&&!c.passed).length}]))
 return {status:checks.every(c=>c.passed)?'passed':'failed',groups,checks}
}
