import {readFileSync,readdirSync,writeFileSync} from "node:fs"
import {fileURLToPath} from "node:url"
import {join} from "node:path"
import postcss from "postcss"
const root=fileURLToPath(new URL("../",import.meta.url)),before=postcss.parse(readFileSync(join(root,"docs/evidence/5d2b/baseline-5d2a.css"),"utf8")),name=readdirSync(join(root,"dist/assets")).find(p=>p.endsWith(".css")),after=postcss.parse(readFileSync(join(root,"dist/assets",name),"utf8"))
function rules(tree){const result=new Map();function visit(node,path=""){if(node.type==="rule"){result.set(path+node.selector,node.toString());}else if(node.nodes)for(const child of node.nodes)visit(child,node.type==="atrule"?`${path}@${node.name} ${node.params}/`:path)}visit(tree);return result}
const old=rules(before),current=rules(after),report={added:[...current].filter(([key])=>!old.has(key)),removed:[...old].filter(([key])=>!current.has(key)),changed:[...current].filter(([key,value])=>old.has(key)&&old.get(key)!==value)}
writeFileSync(join(root,"docs/evidence/5d3a/css-diff.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2))
