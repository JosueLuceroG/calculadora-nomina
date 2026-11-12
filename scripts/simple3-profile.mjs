// Explicitly authorized local test isolation. Never edits the owner's database.
// Keep the original directory intact; restore and verify every original file.
import {existsSync,lstatSync,readdirSync,readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {join,resolve,basename,sep} from 'node:path'
import {tmpdir} from 'node:os'
import assert from 'node:assert/strict'

const [action,folder]=process.argv.slice(2),session=resolve(folder??'')
const allowed=join(tmpdir(),'opencode')+sep
assert(session.startsWith(allowed)&&basename(session).startsWith('simple3-'),'Use an exclusive approved test directory')
const original=join(process.env.LOCALAPPDATA,'mx.calculadoranomina.desktop')
const stateFile=join(session,'profile-state.json'),backup=join(session,'owner-original-preserved')
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
function inventory(root){
 const files={}
 function visit(dir,relative=''){
  for(const name of readdirSync(dir).sort()){
   const path=join(dir,name),key=relative?`${relative}/${name}`:name,stat=lstatSync(path)
   assert(!stat.isSymbolicLink(),'Refuse redirected data directories')
   if(stat.isDirectory())visit(path,key)
   else if(stat.isFile())files[key]={bytes:stat.size,sha256:sha(readFileSync(path))}
   else throw Error('Unsupported data entry')
  }
 }
 visit(root);return files
}
if(action==='begin'){
 mkdirSync(session,{recursive:true});assert(!existsSync(stateFile)&&!existsSync(backup))
 assert(existsSync(original),'Expected original profile')
 const before=inventory(original),state={original,backup,phase:'prepared',before,digest:sha(JSON.stringify(before))}
 writeFileSync(stateFile,JSON.stringify(state,null,2))
 renameSync(original,backup)
 state.phase='isolated';writeFileSync(stateFile,JSON.stringify(state,null,2))
 console.log(JSON.stringify({phase:state.phase,session,protectedFiles:Object.keys(before).length,digest:state.digest}))
}else if(action==='restore'){
 const state=JSON.parse(readFileSync(stateFile));assert.equal(state.original,original);assert.equal(state.backup,backup);assert(existsSync(backup))
 assert(['isolated','prepared'].includes(state.phase))
 if(existsSync(original)){
  const synthetic=join(session,'synthetic-user-data');assert(!existsSync(synthetic));renameSync(original,synthetic)
 }
 renameSync(backup,original)
 const after=inventory(original)
 assert.deepEqual(after,state.before,'Owner data file content changed')
 state.phase='restored';state.restoredDigest=sha(JSON.stringify(after));state.restoredAt=new Date().toISOString()
 writeFileSync(stateFile,JSON.stringify(state,null,2))
 console.log(JSON.stringify({phase:state.phase,protectedFiles:Object.keys(after).length,beforeDigest:state.digest,afterDigest:state.restoredDigest,identical:true}))
}else throw Error('Expected begin or restore')
