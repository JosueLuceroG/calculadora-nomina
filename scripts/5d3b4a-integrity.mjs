import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs'
import {join,relative} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url)),out=join(root,'docs/evidence/5d3b4a'),hash=b=>createHash('sha256').update(b).digest('hex'),excluded=new Set(['target','node_modules','.git','gen','renderizados'])
function walk(p){return readdirSync(p,{withFileTypes:true}).flatMap(e=>excluded.has(e.name)?[]:e.isDirectory()?walk(join(p,e.name)):[join(p,e.name)])}
const baseline=join(out,'baseline.json'),allowed=['package.json','package-lock.json','src/features/documents/evidence-v3.ts']
if(process.argv.includes('--capture')){
 assert(!existsSync(baseline),'Never replace an existing baseline');mkdirSync(out,{recursive:true})
 const dirs=['src','src-tauri','crates/nomina-fiscal-package','tools/fiscal-editorial','scripts','design','docs/evidence/5c2/legacy','docs/evidence/5d2b/native-pdf','docs/evidence/5d2b/pdf','docs/evidence/5d3b3'],files=dirs.flatMap(p=>walk(join(root,p)))
 files.push(...readdirSync(root,{withFileTypes:true}).filter(e=>e.isFile()).map(e=>join(root,e.name)),...readdirSync(join(root,'docs')).filter(n=>n.endsWith('.md')).map(n=>join(root,'docs',n)))
 files.push(...['docs/evidence/5c2/independent-controls.json','docs/evidence/5d2b/originals-v1.json','docs/evidence/5d2b/originals-v2.json'].map(p=>join(root,p)))
 const record={recordedAt:new Date().toISOString(),allowed,hashes:Object.fromEntries([...new Set(files)].sort().map(p=>[relative(root,p).replaceAll('\\','/'),hash(readFileSync(p))]))};writeFileSync(baseline,JSON.stringify(record,null,2)+'\n',{flag:'wx'})
 for(const name of ['package.json','package-lock.json'])writeFileSync(join(out,'before-'+name),readFileSync(join(root,name)),{flag:'wx'})
 console.log(JSON.stringify({captured:Object.keys(record.hashes).length,allowed}))
}else{
 const b=JSON.parse(readFileSync(baseline)),changed=Object.entries(b.hashes).filter(([p,h])=>!existsSync(join(root,p))||hash(readFileSync(join(root,p)))!==h).map(([p])=>p),unauthorized=changed.filter(p=>!b.allowed.includes(p))
 const before=JSON.parse(readFileSync(join(out,'before-package-lock.json'))),after=JSON.parse(readFileSync(join(root,'package-lock.json'))),keys=new Set([...Object.keys(before.packages),...Object.keys(after.packages)]),lockChanged=[...keys].filter(k=>JSON.stringify(before.packages[k])!==JSON.stringify(after.packages[k])),lockUnauthorized=lockChanged.filter(k=>!['','node_modules/@noble/curves','node_modules/@noble/hashes'].includes(k))
 const cssName=readdirSync(join(root,'dist/assets')).find(n=>n.endsWith('.css')),css=hash(readFileSync(join(root,'dist/assets',cssName))),cssBaseline='24ebb44acb4d0b8490a937e6c417b02128c51148d2cc34b24917608f661e3d91'
 const report={checkedAt:new Date().toISOString(),checked:Object.keys(b.hashes).length,changed,unauthorized,lockChanged,lockUnauthorized,cssSha256:css,cssBaseline,cssIdentical:css===cssBaseline};writeFileSync(join(out,'integrity.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));assert.deepEqual(unauthorized,[]);assert.deepEqual(lockUnauthorized,[]);assert.equal(report.cssIdentical,true)
}
