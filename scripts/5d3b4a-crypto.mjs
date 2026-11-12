import assert from 'node:assert/strict'
import {buildSync} from 'esbuild'
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
const root=new URL('../',import.meta.url),out=new URL('../docs/evidence/5d3b4a/',import.meta.url),read=p=>JSON.parse(readFileSync(new URL(p,root))),sha=b=>createHash('sha256').update(b).digest('hex')
export function inputs(){return {rfc:read('crates/nomina-fiscal-package/tests/vectors/rfc8032-public.json'),wycheproof:read('crates/nomina-fiscal-package/tests/vectors/wycheproof-ed25519.json'),jcs:read('crates/nomina-fiscal-package/tests/vectors/jcs.json'),parity:read('docs/evidence/5d3b3/parity-v3.json'),fixtures:read('docs/evidence/5d3b3/fixtures-v3.json'),maximum:read('docs/evidence/5d3b3/maximum-v3.json'),plus:read('docs/evidence/5d3b3/maximum-v3-plus1.json')}}
export function bundle(){return buildSync({absWorkingDir:fileURLToPath(root),entryPoints:['scripts/5d3b4a-probe.ts'],bundle:true,write:false,format:'iife',globalName:'Noble4aProbe',platform:'browser',target:'es2022'}).outputFiles[0].text}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const phase=process.argv[2];assert(['before','after'].includes(phase));const file=new URL(`crypto-${phase}.json`,out);if(phase==='before')assert(!existsSync(file),'Never overwrite pre-migration decisions')
 const code=bundle(),probe=new Function(code+';return Noble4aProbe')(),result=probe.run(inputs()),pkg=read('package.json'),record={recordedAt:new Date().toISOString(),runtime:process.version,versions:{curves:pkg.dependencies['@noble/curves'],hashes:pkg.dependencies['@noble/hashes'],canonicalize:pkg.dependencies.canonicalize},bundleSha256:sha(code),productionEvidenceSha256:sha(readFileSync(new URL('src/features/documents/evidence-v3.ts',root))),result}
 if(phase==='after'){const before=read('docs/evidence/5d3b4a/crypto-before.json');record.equivalentToBefore=JSON.stringify(result)===JSON.stringify(before.result);assert(record.equivalentToBefore,'Cryptographic/documentary decisions changed')}
 writeFileSync(file,JSON.stringify(record,null,2)+'\n',phase==='before'?{flag:'wx'}:{});console.log(JSON.stringify({...record,result:{status:result.status,groups:result.groups}},null,2));assert.equal(result.status,'passed')
}
