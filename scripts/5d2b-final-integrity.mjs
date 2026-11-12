import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {readFileSync,writeFileSync,existsSync,readdirSync} from "node:fs"
import {fileURLToPath} from "node:url"
import {join} from "node:path"
const root=fileURLToPath(new URL("../",import.meta.url)),out=join(root,"docs/evidence/5d2b"),baseline=JSON.parse(readFileSync(join(out,"product-baseline.json"),"utf8"))
// Explicitly scoped test adaptation: ignore erased type imports and allow only
// the compiled metadata JSON, without adding another runtime calculator gate.
const additionalAuthorized=[{path:"src/tests/fiscal-isolation.test.ts",reason:"5D.2b documentary type-only imports and compiled descriptor; runtime calculator restrictions retained"}]
const allowed=[...baseline.allowed,...additionalAuthorized.map(p=>p.path)]
const sha=p=>createHash("sha256").update(readFileSync(p)).digest("hex")
const changed=Object.entries(baseline.hashes).filter(([p,hash])=>!existsSync(join(root,p))||sha(join(root,p))!==hash).map(([p])=>p)
function walk(dir,prefix){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>["target","node_modules",".git"].includes(e.name)?[]:e.isDirectory()?walk(join(dir,e.name),`${prefix}/${e.name}`):[`${prefix}/${e.name}`])}
const added=["src","src-tauri","scripts","design"].flatMap(p=>walk(join(root,p),p)).filter(p=>!Object.hasOwn(baseline.hashes,p))
const additionsAllowed=["src/features/documents/provenance.ts","src/features/documents/presentation-v1.ts","src/features/documents/documents-v2.test.ts","src/infrastructure/fiscal/document-producer.json","src-tauri/src/storage/backup.rs","src-tauri/src/storage/strict_json.rs","src-tauri/src/storage/migration_tests.rs","src-tauri/src/storage/migrations/003.sql","src-tauri/src/storage/fixtures-v2.json","scripts/project-document-producer.mjs","scripts/5d2b-final-integrity.mjs","scripts/5d2b-qa-database.py","scripts/build-5d2b-native.mjs","scripts/check-5d2b-native.mjs","scripts/verify-5d2b-pdfs.py","scripts/5d2b-css-baseline.mjs"]
const css=readdirSync(join(root,"dist/assets")).filter(p=>p.endsWith(".css"));assert.equal(css.length,1)
const cssSha256=sha(join(root,"dist/assets",css[0])),expectedCssSha256=JSON.parse(readFileSync(join(out,"css-baseline.json"),"utf8")).cssSha256
const report={checkedOn:new Date().toISOString(),checked:Object.keys(baseline.hashes).length,changed,added,additionalAuthorized,unauthorized:[...changed.filter(p=>!allowed.includes(p)),...added.filter(p=>!additionsAllowed.includes(p))],cssSha256,expectedCssSha256,cssUnchanged:cssSha256===expectedCssSha256}
writeFileSync(join(out,"product-integrity.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report));assert.deepEqual(report.unauthorized,[])
assert.equal(cssSha256,expectedCssSha256)
const read=p=>JSON.parse(readFileSync(join(root,p),"utf8"))
if(existsSync(join(out,"validation-summary.json"))){
  const summary=read("docs/evidence/5d2b/validation-summary.json"),equivalence=read("docs/evidence/5d2a/equivalence.json"),native=read("docs/evidence/5d2b/native-verification.json"),pdf=read("docs/evidence/5d2b/pdf-quality.json")
  const legacy=read("docs/evidence/4b1/matrix-results.json").records.flatMap(r=>r.comparisons)
  assert.equal(legacy.length,summary.fiscalRegression.legacyComparisons);assert(legacy.every(c=>c.matches))
  for(const key of ["directReports","independentComponents","inverseWindows","inverseCents"])assert.equal(equivalence[key],summary.fiscalRegression[key])
  assert.deepEqual(equivalence.monetaryDifferences,[])
  for(const field of ["failures","errors","external"])assert.deepEqual(native[field],[])
  assert.equal(native.binarySha256,summary.native.binarySha256);assert.equal(sha(join(root,"src-tauri/target/debug/calculadora-nomina.exe")),native.binarySha256)
  assert.equal(pdf.documents.length,summary.pdf.documents);assert.equal(pdf.pages,summary.pdf.pages);assert.equal(pdf.uriLinks,summary.pdf.uriLinks)
  assert.equal(changed.length,summary.integrity.modifiedExistingFiles);assert.equal(cssSha256,summary.integrity.compiledCssSha256)
  for(const item of read("docs/evidence/5d2b/originals-v1.json")){assert.equal(createHash("sha256").update(item.payload).digest("hex"),item.checksum);assert.equal(JSON.parse(item.payload).value.schemaVersion,1)}
  console.log(JSON.stringify({evidenceCrossCheck:"passed",directReports:equivalence.directReports,inverseWindows:equivalence.inverseWindows,legacyComparisons:legacy.length,pdfDocuments:pdf.documents.length}))
}
