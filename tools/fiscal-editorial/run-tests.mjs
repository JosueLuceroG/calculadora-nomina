import {run} from "node:test"
import {spec} from "node:test/reporters"
import {fileURLToPath} from "node:url"
import {writeFileSync} from "node:fs"
const files=["security.cases.mjs","vectors.cases.mjs"].map(p=>fileURLToPath(new URL(`tests/${p}`,import.meta.url)))
const stream=run({files,concurrency:1});stream.on("test:fail",()=>{process.exitCode=1})
stream.on("test:summary",data=>{if(data.file)return;writeFileSync(new URL("../../docs/evidence/5d3a/editorial-tests.json",import.meta.url),JSON.stringify({recordedOn:new Date().toISOString(),...data},null,2)+"\n")})
stream.compose(spec()).pipe(process.stdout)
