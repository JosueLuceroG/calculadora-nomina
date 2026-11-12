import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync,readdirSync,existsSync,mkdirSync,writeFileSync} from 'node:fs'
import {join,relative} from 'node:path'
import {fileURLToPath} from 'node:url'
import {canonicalBytes} from '../tools/fiscal-editorial/src/json.mjs'
const root=fileURLToPath(new URL('../',import.meta.url)),out=join(root,'docs/evidence/5d3b1'),sha=b=>createHash('sha256').update(b).digest('hex')
const excluded=new Set(['target','node_modules','.git','renderizados'])
function walk(p){return readdirSync(p,{withFileTypes:true}).flatMap(e=>excluded.has(e.name)?[]:e.isDirectory()?walk(join(p,e.name)):[join(p,e.name)])}
const allowed=['src-tauri/Cargo.toml','src-tauri/Cargo.lock','src-tauri/src/lib.rs','tools/fiscal-editorial/tests/security.cases.mjs']
const baseline=join(out,'baseline.json')
if(process.argv.includes('--capture')){
  assert(!existsSync(baseline),'Never overwrite a baseline');mkdirSync(out,{recursive:true})
  const paths=['src','src-tauri','crates/nomina-fiscal-package','tools/fiscal-editorial','scripts','design','docs/evidence/5c2/legacy','docs/evidence/5d2b/native-pdf'].flatMap(p=>walk(join(root,p)))
  paths.push(...['package.json','package-lock.json','vite.config.ts','docs/evidence/5c2/independent-controls.json','docs/evidence/5d2b/originals-v1.json','docs/evidence/5d2b/originals-v2.json'].map(p=>join(root,p)))
  writeFileSync(baseline,JSON.stringify({recordedAt:new Date().toISOString(),allowed,hashes:Object.fromEntries([...new Set(paths)].sort().map(p=>[relative(root,p).replaceAll('\\','/'),sha(readFileSync(p))]))},null,2)+'\n')
  const bytes=readFileSync(join(root,'docs/evidence/5d3a/qa-example/candidate.nomina-fiscal')),env=JSON.parse(bytes),trust=readFileSync(join(root,'docs/evidence/5d3a/qa-example/trust.json'))
  const measured={recordedAt:new Date().toISOString(),containerBytes:bytes.length,payloadBytes:canonicalBytes(env.signed).length,contentBytes:canonicalBytes(env.signed.registry).length,trustBytes:trust.length,storedObjectBytes:bytes.length+canonicalBytes(env.signed).length+canonicalBytes(env.signed.registry).length,contentSha256:sha(canonicalBytes(env.signed.registry)),containerSha256:sha(bytes)}
  writeFileSync(join(out,'measurement.json'),JSON.stringify(measured,null,2)+'\n');console.log(JSON.stringify(measured))
}else{
  const b=JSON.parse(readFileSync(baseline)),changed=Object.entries(b.hashes).filter(([p,h])=>!existsSync(join(root,p))||sha(readFileSync(join(root,p)))!==h).map(([p])=>p),unauthorized=changed.filter(p=>!b.allowed.includes(p))
  const report={checkedAt:new Date().toISOString(),checked:Object.keys(b.hashes).length,changed,unauthorized};writeFileSync(join(out,'integrity.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));assert.deepEqual(unauthorized,[])
}
