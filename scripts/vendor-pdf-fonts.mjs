import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {mkdirSync,writeFileSync,existsSync,readFileSync,unlinkSync} from "node:fs"
import {fileURLToPath} from "node:url"
import {join} from "node:path"
const root=fileURLToPath(new URL("../",import.meta.url)),out=join(root,"src/features/pdf/assets"),base="https://raw.githubusercontent.com/matplotlib/matplotlib/v3.10.7/lib/matplotlib/mpl-data/fonts/ttf/"
const previous=existsSync(join(out,"font-manifest.json"))?JSON.parse(readFileSync(join(out,"font-manifest.json"),"utf8")):null
assert(!previous||(process.argv.includes("--replace-rejected-noto")&&previous.family==="Noto Sans"),"No reemplazar fuentes verificadas")
mkdirSync(out,{recursive:true})
const files=[]
for(const[name,path]of[["DejaVuSans.ttf","DejaVuSans.ttf"],["DejaVuSans-Bold.ttf","DejaVuSans-Bold.ttf"],["LICENSE-DejaVu.txt","LICENSE_DEJAVU"]]){const url=base+path,response=await fetch(url);assert(response.ok,url);const bytes=Buffer.from(await response.arrayBuffer());if(name.endsWith(".ttf"))assert.equal(bytes.readUInt32BE(0),0x00010000);writeFileSync(join(out,name),bytes);files.push({name,url,bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")})}
if(previous){writeFileSync(join(root,"docs/evidence/5b10/font-evaluation.json"),JSON.stringify({rejected:previous,reason:"Sin glifos U+2212, U+2264, U+2265, U+2248, U+2192; no se distribuyen los TTF descartados.",selected:"DejaVu Sans, TTF redistribuidos por Matplotlib v3.10.7"},null,2));for(const f of previous.files)unlinkSync(join(out,f.name))}
writeFileSync(join(out,"font-manifest.json"),JSON.stringify({family:"DejaVu Sans",license:"Bitstream Vera / Arev font license; DejaVu additions public domain",sourceNote:"TTF redistribuibles de Matplotlib v3.10.7, con licencia completa y hashes fijados.",files},null,2));console.log(JSON.stringify(files,null,2))
