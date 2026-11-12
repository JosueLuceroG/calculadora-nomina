import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync,readdirSync,writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import postcss from 'postcss'
const root=fileURLToPath(new URL('../',import.meta.url)),before=readFileSync(join(root,'docs/evidence/5d2b/baseline-5d2a.css')),name=readdirSync(join(root,'dist/assets')).find(p=>p.endsWith('.css')),after=readFileSync(join(root,'dist/assets',name)),sha=b=>createHash('sha256').update(b).digest('hex')
function rules(bytes){const result=new Map();function walk(node,path=''){if(node.type==='rule')result.set(path+node.selector,node.toString());else if(node.nodes)for(const child of node.nodes)walk(child,node.type==='atrule'?`${path}@${node.name} ${node.params}/`:path)}walk(postcss.parse(bytes.toString()));return result}
const a=rules(before),b=rules(after),report={baselineSha256:sha(before),compiledSha256:sha(after),identicalBytes:before.equals(after),added:[...b.keys()].filter(k=>!a.has(k)),removed:[...a.keys()].filter(k=>!b.has(k)),changed:[...b.keys()].filter(k=>a.has(k)&&a.get(k)!==b.get(k))}
writeFileSync(join(root,'docs/evidence/5d3b1/css.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));assert(report.identicalBytes,'Approved CSS bytes changed')
