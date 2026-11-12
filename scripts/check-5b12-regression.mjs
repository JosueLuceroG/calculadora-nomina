import assert from "node:assert/strict"
import {execFileSync} from "node:child_process"
import {copyFileSync,mkdirSync,readFileSync,writeFileSync,readdirSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {fileURLToPath} from "node:url"
const root=fileURLToPath(new URL("../",import.meta.url)),out=join(root,"docs/evidence/5b12"),build=join(tmpdir(),"opencode","5b12-frontend-build"),report={commands:[],failures:[]}
mkdirSync(out,{recursive:true});mkdirSync(build,{recursive:true})
function run(name,program,args){const started=Date.now();let output="";try{output=execFileSync(program,args,{cwd:root,encoding:"utf8",timeout:240000,shell:program.endsWith('.cmd'),stdio:["ignore","pipe","pipe"]});report.commands.push({name,program,args,elapsedMs:Date.now()-started,status:"passed"})}catch(e){output=(e.stdout??"")+(e.stderr??"");report.commands.push({name,program,args,elapsedMs:Date.now()-started,status:"failed"});throw e}finally{writeFileSync(join(out,`${name}.log`),output)}console.log(`${name}: passed`);return output}
try{
 run("typecheck","npm.cmd",["run","typecheck"])
 run("vitest","npm.cmd",["test","--","--maxWorkers=2","--reporter=json","--outputFile=docs/evidence/5b12/vitest.json"])
 const tests=JSON.parse(readFileSync(join(out,"vitest.json"),"utf8"));assert.equal(tests.numTotalTests,1475);assert.equal(tests.numPassedTests,1475);assert(tests.success);report.vitest={passed:tests.numPassedTests,failed:tests.numFailedTests}
 const rust=run("rust","cargo",["test","--manifest-path","src-tauri/Cargo.toml","--lib"]);assert.match(rust,/46 passed; 0 failed/);report.rust={passed:46,failed:0}
 run("frontend-build","npm.cmd",["run","build","--","--outDir",build,"--emptyOutDir"]);report.frontendBuild={path:build,files:readdirSync(join(build,"assets")),productionDistPreserved:true}
 const matrix=JSON.parse(readFileSync(join(root,"docs/evidence/4b1/matrix-results.json"),"utf8"));assert.equal(matrix.records.length,32);const comparisons=matrix.records.flatMap(r=>r.comparisons);assert.equal(comparisons.length,1312);assert(comparisons.every(c=>c.matches));assert(matrix.records.every(r=>r.expectedStatus===r.obtainedStatus));report.fiscal={families:[...new Set(matrix.records.map(r=>r.family))].sort(),records:32,comparisons:1312,differences:[],reference:"Controles independientes Fraction existentes de 4B.1; fechas normativas del expediente original"}
 for(const name of ['matrix-results.json','matrix-results.csv','matrix-summary.md'])copyFileSync(join(root,'docs/evidence/4b1',name),join(out,name))
 run("fiscal-identity",process.execPath,["scripts/project-storage-identity.mjs","--check"])
}catch(e){report.failures.push(e.stack??String(e));process.exitCode=1}
finally{writeFileSync(join(out,"regression.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))}
