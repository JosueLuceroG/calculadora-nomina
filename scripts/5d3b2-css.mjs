import assert from 'node:assert/strict'
import {readFileSync,readdirSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import postcss from 'postcss'
const root=fileURLToPath(new URL('../',import.meta.url)),before=readFileSync(join(root,'docs/evidence/5d2b/baseline-5d2a.css')),name=readdirSync(join(root,'dist/assets')).find(n=>n.endsWith('.css')),after=readFileSync(join(root,'dist/assets',name)),sha=b=>createHash('sha256').update(b).digest('hex')
function rules(b){const map=new Map();function walk(node,path=''){if(node.type==='rule')map.set(path+node.selector,{selector:node.selector,css:node.toString()});else if(node.nodes)for(const c of node.nodes)walk(c,node.type==='atrule'?`${path}@${node.name} ${node.params}/`:path)}walk(postcss.parse(b.toString()));return map}
const a=rules(before),b=rules(after),added=[...b.keys()].filter(k=>!a.has(k)),removed=[...a.keys()].filter(k=>!b.has(k)),changed=[...a.keys()].filter(k=>b.has(k)&&a.get(k).css!==b.get(k).css),unauthorized=added.filter(k=>!b.get(k).selector.split(',').every(s=>s.trim().startsWith('.fiscal-packages')))
const report={baselineSha256:sha(before),compiledSha256:sha(after),added,removed,changed,unauthorized,authorizedScope:'new fiscal-packages component only'};writeFileSync(join(root,'docs/evidence/5d3b2/css.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));assert.deepEqual(removed,[]);assert.deepEqual(changed,[]);assert.deepEqual(unauthorized,[])
