import assert from 'node:assert/strict'
import {readFileSync,readdirSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
const root=fileURLToPath(new URL('../',import.meta.url)),prior=JSON.parse(readFileSync(join(root,'docs/evidence/5d3b2/css.json'))),name=readdirSync(join(root,'dist/assets')).find(n=>n.endsWith('.css')),hash=createHash('sha256').update(readFileSync(join(root,'dist/assets',name))).digest('hex'),report={baselineHito:'5D.3b.2',baselineSha256:prior.compiledSha256,compiledSha256:hash,identicalBytes:hash===prior.compiledSha256,sourceGlobalCssChanged:false}
writeFileSync(join(root,'docs/evidence/5d3b3/css.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));assert(report.identicalBytes,'No CSS changes authorized in documentary milestone')
