// Isolate only this app's installer registration/shortcuts. The owner's installed
// program directory is never used by the upgrade test and is hash-checked later.
import {execFileSync} from 'node:child_process'
import {existsSync,readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs'
import {join,resolve,sep} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
const [action,folder]=process.argv.slice(2),session=resolve(folder??'')
assert(session.startsWith(join(tmpdir(),'opencode')+sep)&&session.includes('simple3-upgrade-'))
const file=join(session,'installation-state.json'),name='Calculadora de Nómina'
const keys=[`HKCU\\Software\\calculadoranomina\\${name}`,`HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${name}`]
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex')
const reg=(args)=>execFileSync('reg.exe',args,{stdio:'pipe',encoding:'utf8'})
function has(key){try{reg(['query',key]);return true}catch{return false}}
const ps=command=>execFileSync('pwsh.exe',['-NoProfile','-Command',"[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);"+command],{encoding:'utf8'}).trim()
if(action==='begin'){
 assert(!existsSync(file));mkdirSync(session,{recursive:true})
 const paths=JSON.parse(ps(`@([Environment]::GetFolderPath('DesktopDirectory'),[Environment]::GetFolderPath('Programs')) | ConvertTo-Json -Compress`))
 const installed=JSON.parse(ps(`$p=Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${name}' -ErrorAction SilentlyContinue;if($p){@{version=$p.DisplayVersion;location=$p.InstallLocation.Trim('"')}|ConvertTo-Json -Compress}else{'null'}`))
 const state={phase:'prepared',keys:keys.map((key,i)=>({key,existed:has(key),backup:join(session,`registration-${i}.reg`)})),shortcuts:[],installed}
 if(installed){assert.equal(installed.version,'0.1.0');state.installed.exe=join(installed.location,'calculadora-nomina.exe');state.installed.sha256=sha(state.installed.exe)}
 for(const [i,path]of paths.map(p=>join(p,name+'.lnk')).entries())if(existsSync(path))state.shortcuts.push({path,backup:join(session,`owner-shortcut-${i}.lnk`),sha256:sha(path)})
 for(const entry of state.keys)if(entry.existed)reg(['export',entry.key,entry.backup,'/y'])
 writeFileSync(file,JSON.stringify(state,null,2))
 for(const entry of state.shortcuts)renameSync(entry.path,entry.backup)
 for(const entry of state.keys)if(entry.existed)reg(['delete',entry.key,'/f'])
 state.phase='isolated';writeFileSync(file,JSON.stringify(state,null,2));console.log(JSON.stringify({phase:state.phase,installedVersion:installed?.version??null}))
}else if(action==='restore'){
 const state=JSON.parse(readFileSync(file));assert.deepEqual(state.keys.map(e=>e.key),keys)
 assert(['prepared','isolated'].includes(state.phase))
 for(const entry of state.keys){if(has(entry.key))reg(['delete',entry.key,'/f']);if(entry.existed)reg(['import',entry.backup])}
 for(const entry of state.shortcuts){if(existsSync(entry.backup)){if(existsSync(entry.path))renameSync(entry.path,entry.backup+'.test-link');renameSync(entry.backup,entry.path)}assert(existsSync(entry.path));assert.equal(sha(entry.path),entry.sha256)}
 if(state.installed)assert.equal(sha(state.installed.exe),state.installed.sha256,'Owner installation changed')
 state.phase='restored';state.programUnchanged=true;writeFileSync(file,JSON.stringify(state,null,2));console.log(JSON.stringify({phase:state.phase,programUnchanged:true,version:state.installed?.version??null,shortcutsVerified:state.shortcuts.length}))
}else throw Error('Expected begin or restore')
