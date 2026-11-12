import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
const root=fileURLToPath(new URL('../',import.meta.url)),version=JSON.parse(readFileSync(join(root,'package.json'))).version
assert.equal(version,'0.1.1-rc.1')
const sha=b=>createHash('sha256').update(b).digest('hex')
const reference=join(root,'src-tauri/target/release/bundle/nsis/Calculadora de Nómina_0.1.0_x64-setup.exe')
assert.equal(sha(readFileSync(reference)),'146cb6bdf9ae121846c15d692e5a5594b5b89433d2e4aeadb0809ea3bfde7f2a')
const source=join(root,`src-tauri/target/release/bundle/nsis/Calculadora de Nómina_${version}_x64-setup.exe`)
const bytes=readFileSync(source),folder=join(root,'artifacts/windows'),name=`CalculadoraNomina_${version}_x64-setup.exe`,target=join(folder,name)
mkdirSync(folder,{recursive:true})
if(existsSync(target))assert.equal(sha(readFileSync(target)),sha(bytes),'Do not replace a different staged candidate')
else writeFileSync(target,bytes,{flag:'wx'})
const manifest={filename:name,version,architecture:'Windows x64',bytes:bytes.length,sha256:sha(bytes),authenticode:'NotSigned',purpose:'release-candidate-for-validation',webview:'Evergreen bootstrapper; internet required if runtime absent',reference010Sha256:sha(readFileSync(reference))}
for(const [path,text]of [[target+'.sha256',`${manifest.sha256}  ${name}\n`],[target+'.json',JSON.stringify(manifest,null,2)+'\n']]){
 if(existsSync(path))assert.equal(readFileSync(path,'utf8'),text);else writeFileSync(path,text,{flag:'wx'})
}
console.log(JSON.stringify({target,...manifest},null,2))
