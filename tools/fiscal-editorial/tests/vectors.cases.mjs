// Explicit Node-runner cases; not discovered by the application's Vitest glob.
import {test} from "node:test"
import assert from "node:assert/strict"
import {readFileSync,mkdtempSync,rmSync,writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {createPublicKey,verify} from "node:crypto"
import {canonicalBytes} from "../src/json.mjs"
import {runNative} from "../src/qa.mjs"
const vectors=new URL("../../../crates/nomina-fiscal-package/tests/vectors/",import.meta.url),load=name=>JSON.parse(readFileSync(new URL(name,vectors),"utf8"))
for(const v of load("jcs.json"))test(`Independent JCS golden ${v.name}`,()=>assert.equal(canonicalBytes(JSON.parse(v.input)).toString(),v.output))
for(const v of load("rfc8032-public.json"))test(`RFC8032 native and OpenSSL: ${v.name}`,()=>{const pk=Buffer.from(v.public,"hex"),sig=Buffer.from(v.signature,"hex"),msg=Buffer.from(v.message,"hex"),key=createPublicKey({key:Buffer.concat([Buffer.from("302a300506032b6570032100","hex"),pk]),format:"der",type:"spki"});assert(verify(null,msg,key,sig));const r=runNative(["vector",pk.toString("base64url"),sig.toString("base64url"),msg.toString("base64url")]);assert(r.ok&&r.result.rawPrimitiveVectorValid)})
for(const group of load("wycheproof-ed25519.json").testGroups)for(const v of group.tests)test(`Wycheproof tcId ${v.tcId}: ${v.result}`,()=>{const pk=Buffer.from(group.publicKey.pk,"hex"),sig=Buffer.from(v.sig,"hex"),msg=Buffer.from(v.msg,"hex"),r=runNative(["vector",pk.toString("base64url"),sig.toString("base64url"),msg.toString("base64url")]);assert.equal(Boolean(r.ok&&r.result.rawPrimitiveVectorValid),v.result==="valid")})
test("Native and independent canonicalizers preserve actual historical2026 bytes",t=>{const dir=mkdtempSync(join(tmpdir(),"opencode/5d3a-jcs-"));t.after(()=>rmSync(dir,{recursive:true,force:true}));const source=JSON.parse(readFileSync(new URL("../../../docs/evidence/5d3a/editorial-source-2026.json",import.meta.url),"utf8")),path=join(dir,"registry.json");writeFileSync(path,JSON.stringify(source.registry,null,2));const native=runNative(["canonical",path],{raw:true}),independent=canonicalBytes(source.registry),historical=readFileSync(new URL("../../../docs/evidence/5d3a/legacy-registry.canonical.json",import.meta.url));assert(native.equals(independent));assert(native.equals(historical))})
