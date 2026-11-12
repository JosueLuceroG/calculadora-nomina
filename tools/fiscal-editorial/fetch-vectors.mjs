import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {writeFileSync} from "node:fs"
import {fileURLToPath} from "node:url"
const dir=fileURLToPath(new URL("../../crates/nomina-fiscal-package/tests/vectors/",import.meta.url)),sources=[]
async function download(url){const response=await fetch(url,{headers:{"User-Agent":"nomina-qa-vector-capture"}});assert(response.ok,`${response.status}: ${url}`);let size=0,parts=[];for await(const part of response.body){size+=part.length;assert(size<=4194304,"Public vector download limit");parts.push(Buffer.from(part))}const bytes=Buffer.concat(parts);sources.push({url,sha256:createHash("sha256").update(bytes).digest("hex"),bytes:bytes.length});return bytes}
const wycheproofCommit="d17cc89fa5c8f4f4d378b5385ebf75da5d0926c9",jcsCommit="32a48195b9b20fe67b1795e39e4509f14d860b45"
const raw=await download(`https://raw.githubusercontent.com/C2SP/wycheproof/${wycheproofCommit}/testvectors_v1/ed25519_test.json`),data=JSON.parse(raw)
const groups=data.testGroups.map(g=>({publicKey:g.publicKey??g.key,tests:g.tests.map(t=>({tcId:t.tcId,comment:t.comment,msg:t.msg,sig:t.sig,result:t.result,flags:t.flags}))}))
const selected={algorithm:data.algorithm,numberOfTests:data.numberOfTests,testGroups:groups}
function noPrivate(value){if(Array.isArray(value))value.forEach(noPrivate);else if(value&&typeof value==="object")for(const[k,v]of Object.entries(value)){assert(!["sk","secret","secretKey","privateKey","seed"].includes(k),"Private vector data must not be retained");noPrivate(v)}}noPrivate(selected)
assert.equal(groups.flatMap(g=>g.tests).length,data.numberOfTests);writeFileSync(new URL("../../crates/nomina-fiscal-package/tests/vectors/wycheproof-ed25519.json",import.meta.url),JSON.stringify(selected,null,2)+"\n")
const listing=JSON.parse(await download(`https://api.github.com/repos/cyberphone/json-canonicalization/contents/testdata/input?ref=${jcsCommit}`)),jcs=[]
for(const item of listing){if(item.type!=="file"||!/^[a-zA-Z0-9_-]+\.json$/.test(item.name))continue;const name=item.name.slice(0,-5),input=await download(`https://raw.githubusercontent.com/cyberphone/json-canonicalization/${jcsCommit}/testdata/input/${item.name}`),output=await download(`https://raw.githubusercontent.com/cyberphone/json-canonicalization/${jcsCommit}/testdata/output/${item.name}`);jcs.push({name,input:input.toString("utf8"),output:output.toString("utf8")})}
writeFileSync(new URL("../../crates/nomina-fiscal-package/tests/vectors/jcs.json",import.meta.url),JSON.stringify(jcs,null,2)+"\n")
writeFileSync(new URL("../../crates/nomina-fiscal-package/tests/vectors/sources.json",import.meta.url),JSON.stringify({wycheproofCommit,jcsCommit,licenses:{wycheproof:"Apache-2.0",jcs:"Apache-2.0"},selection:"public verification inputs; no private material",sources},null,2)+"\n")
console.log(JSON.stringify({directory:dir,wycheproofTests:data.numberOfTests,jcsVectors:jcs.length,sources:sources.length}))
