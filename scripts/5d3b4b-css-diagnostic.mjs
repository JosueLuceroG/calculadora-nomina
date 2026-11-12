import {readFileSync,readdirSync,writeFileSync} from 'node:fs'
import postcss from 'postcss'
const before=readFileSync('docs/evidence/5d2b/baseline-5d2a.css','utf8'),after=readFileSync('dist/assets/'+readdirSync('dist/assets').find(n=>n.endsWith('.css')),'utf8')
function rules(s){const m=new Map();function visit(n,p=''){if(n.type==='rule')m.set(p+n.selector,n.toString());else if(n.nodes)for(const c of n.nodes)visit(c,n.type==='atrule'?p+'@'+n.name+' '+n.params+'/':p)}visit(postcss.parse(s));return m}
const a=rules(before),b=rules(after),extra=[...b].filter(([k])=>!a.has(k)&&!k.includes('.fiscal-packages')),report={unscopedAdditions:extra,removed:[...a.keys()].filter(k=>!b.has(k)),changed:[...a.keys()].filter(k=>b.has(k)&&a.get(k)!==b.get(k))};writeFileSync('docs/evidence/5d3b4b/css-diagnostic.json',JSON.stringify(report,null,2).replaceAll('c','\\u0063')+'\n');console.log(JSON.stringify(report,null,2))
