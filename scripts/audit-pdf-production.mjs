import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {readFileSync,readdirSync,writeFileSync} from "node:fs"
import {fileURLToPath} from "node:url"
import {join} from "node:path"
const root=fileURLToPath(new URL("../",import.meta.url)),out=join(root,"docs/evidence/5b10"),before=JSON.parse(readFileSync(join(out,"protected-baseline.json"),"utf8")),hash=s=>createHash("sha256").update(s).digest("hex"),files=readdirSync(join(root,"dist/assets")),rows=[]
for(const[path,expected]of Object.entries(before.productionAssets)){
 const ext=path.endsWith(".css")?".css":".js",current=files.find(p=>p.endsWith(ext));assert(current)
 const data=readFileSync(join(root,"dist/assets",current)),actual=hash(data),row={beforePath:path,currentPath:`dist/assets/${current}`,expectedSha256:expected,actualSha256:actual,identical:actual===expected,extraRule:null}
 if(ext===".js"){const text=data.toString();row.pdfProbeExcluded=!text.includes("nomina-pdf-probe-v1")&&!text.includes("NotoSans-Regular.ttf")&&!text.includes("DejaVuSans.ttf")&&!text.includes("save_pdf_probe");assert(row.pdfProbeExcluded)}
 rows.push(row)
}
assert(rows.every(r=>r.identical),"La prueba aislada no debe alterar el JS/CSS de producción")
assert(!files.some(p=>/\.(ttf|pdf)$/i.test(p)));assert.deepEqual(readdirSync(join(root,"dist")).filter(p=>p.endsWith(".html")),["index.html"]);writeFileSync(join(out,"production-assets.json"),JSON.stringify({checkedOn:new Date().toISOString(),assets:rows},null,2));console.log(JSON.stringify(rows,null,2))
