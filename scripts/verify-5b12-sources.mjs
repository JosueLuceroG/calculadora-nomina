import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url)),out=join(root,'docs/evidence/5b12'),cache=join(tmpdir(),'opencode','5b12-normative-sources'),prior=JSON.parse(readFileSync(join(root,'src/tests/fixtures/operational-4b1.expected.json'),'utf8')).sources
mkdirSync(cache,{recursive:true})
const sources=[['minimum-2026','https://sidof.segob.gob.mx/notas/docFuente/5775534','html'],['lisr','https://www.diputados.gob.mx/LeyesBiblio/pdf/LISR.pdf','pdf'],['lss','https://www.diputados.gob.mx/LeyesBiblio/pdf/LSS.pdf','pdf']]
const records=await Promise.all(sources.map(async([id,url,ext])=>{const queriedOn=new Date().toISOString();try{const response=await fetch(url,{signal:AbortSignal.timeout(60000)}),bytes=Buffer.from(await response.arrayBuffer()),sha256=createHash('sha256').update(bytes).digest('hex'),path=join(cache,`${id}.${ext}`);if(!response.ok)throw new Error(`HTTP ${response.status}`);writeFileSync(path,bytes);return{id,url,finalUrl:response.url,queriedOn,status:response.status,path,sha256,matches4b1:prior.find(s=>s.id===id).sha256.toLowerCase()===sha256}}catch(e){return{id,url,queriedOn,error:e.message}}}))
writeFileSync(join(out,'normative-sources.json'),JSON.stringify({cache,records,scope:'Solo revisión HN-01, no actualización del paquete ni auditoría general de cambios normativos posteriores al corte 4B.1'},null,2));console.log(JSON.stringify(records,null,2))
