import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {readFileSync,readdirSync,existsSync,mkdirSync,writeFileSync} from "node:fs"
import {fileURLToPath} from "node:url"
import {join,relative} from "node:path"
import {build} from "esbuild"
const root=fileURLToPath(new URL("../",import.meta.url)),out=join(root,"docs/evidence/5d3a"),sha=bytes=>createHash("sha256").update(bytes).digest("hex")
function walk(path){return readdirSync(path,{withFileTypes:true}).flatMap(e=>["target","node_modules",".git"].includes(e.name)?[]:e.isDirectory()?walk(join(path,e.name)):[join(path,e.name)])}
const baseline=join(out,"product-baseline.json")
if(process.argv.includes("--capture")){
  assert(!existsSync(baseline),"Never replace baseline");mkdirSync(out,{recursive:true})
  const paths=["src","src-tauri","scripts","design","docs/evidence/5c2/legacy","docs/evidence/5d2b/native-pdf"].flatMap(p=>walk(join(root,p)))
  paths.push(...["package.json","package-lock.json","vite.config.ts","tsconfig.app.json","docs/evidence/5c2/independent-controls.json","docs/evidence/5d2b/originals-v1.json","docs/evidence/5d2b/originals-v2.json"].map(p=>join(root,p)))
  writeFileSync(baseline,JSON.stringify({capturedOn:new Date().toISOString(),hashes:Object.fromEntries([...new Set(paths)].sort().map(p=>[relative(root,p).replaceAll("\\","/"),sha(readFileSync(p))]))},null,2)+"\n")
  const bundled=await build({stdin:{contents:'export {FISCAL_PARAMETERS_2026,standardGrossToNetContext2026} from "./src/infrastructure/fiscal/2026.ts";export {createEmbeddedFiscalRegistry2026} from "./src/infrastructure/fiscal/package-registry.ts";export {ENGINE_FISCAL_CAPABILITIES} from "./src/infrastructure/fiscal/engine-capabilities.ts";export {STANDARD_CONVENTIONS} from "./src/domain/payroll/simulation-conventions.ts";',resolveDir:root},bundle:true,platform:"node",format:"esm",write:false})
  const m=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`),registry=m.FISCAL_PARAMETERS_2026,manifest=m.createEmbeddedFiscalRegistry2026().entries[0].manifest,ctx=m.standardGrossToNetContext2026()
  const legacy=value=>JSON.stringify(value,(_,v)=>v&&typeof v==="object"&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)
  assert.equal(sha(legacy(registry)),"7e9f13084e64633b29959d79eec5f9c02333fe2695809c662d71fa7fc8393ab0")
  const signed={format:"mx.nomina.fiscal-package",formatVersion:1,canonicalization:"RFC8785",channel:"qa",publication:{streamId:"mx-standard-2026",streamEpoch:1,revision:1,publishedAt:"2026-10-23T00:00:00Z",minimumTrustEpoch:1,changes:{summary:"QA ONLY: unchanged integrated2026 data; not an official publication",supersedes:null}},manifest,registry,ruleSources:{subsidy:ctx.subsidyRulesSources,retention:ctx.retentionRuleSources},conventions:m.STANDARD_CONVENTIONS,review:{recordId:"qa-5d3a-2026-baseline",reviewedOn:"2026-10-23",independentReportSha256:sha(readFileSync(join(root,"docs/evidence/5d2a/equivalence.json"))),compatibilityStatement:"data-only-same-implemented-rules",sourceChecks:manifest.sources.map((s,sourceIndex)=>({sourceIndex,verifiedOn:s.verifiedOn,documentSha256:null}))}}
  writeFileSync(join(out,"editorial-source-2026.json"),JSON.stringify(signed,null,2)+"\n");writeFileSync(join(out,"legacy-registry.canonical.json"),legacy(registry))
  const stats={nodes:0,depth:0,properties:0,stringBytes:0,keyBytes:0,arrayItems:0};function inspect(v,d=0){stats.nodes++;stats.depth=Math.max(stats.depth,d);if(typeof v==="string")stats.stringBytes=Math.max(stats.stringBytes,Buffer.byteLength(v));else if(Array.isArray(v)){stats.arrayItems=Math.max(stats.arrayItems,v.length);v.forEach(x=>inspect(x,d+1))}else if(v&&typeof v==="object"){stats.properties=Math.max(stats.properties,Object.keys(v).length);for(const[k,x]of Object.entries(v)){stats.keyBytes=Math.max(stats.keyBytes,Buffer.byteLength(k));inspect(x,d+1)}}}
  const dummy=purpose=>({protected:{protocolVersion:1,algorithm:"Ed25519",keyId:"ed25519-sha256:"+"0".repeat(64),purpose},value:"A".repeat(86)})
  const envelope={signed,signatures:[dummy("content-approval"),dummy("package")]};inspect(envelope)
  const measurement={measuredOn:new Date().toISOString(),kind:"unsigned QA source; signature placeholders used only for size",registryCanonicalBytes:Buffer.byteLength(legacy(registry)),envelopeCanonicalEstimateBytes:Buffer.byteLength(legacy(envelope)),...stats,parameterSets:manifest.parameterSets.length,sources:manifest.sources.length,tariffRows:registry.isrTariffs.flatMap(t=>t.data.rows).length,legacySha256:sha(legacy(registry))}
  writeFileSync(join(out,"measurement.json"),JSON.stringify(measurement,null,2)+"\n");console.log(JSON.stringify(measurement))
}else{
  const b=JSON.parse(readFileSync(baseline,"utf8")),changed=Object.entries(b.hashes).filter(([p,h])=>!existsSync(join(root,p))||sha(readFileSync(join(root,p)))!==h).map(([p])=>p)
  const report={checkedOn:new Date().toISOString(),checked:Object.keys(b.hashes).length,changed,unauthorized:changed};writeFileSync(join(out,"product-integrity.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report));assert.deepEqual(changed,[])
}
