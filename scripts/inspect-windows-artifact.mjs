// Read-only PE metadata; no application execution or build pin changes.
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
const path=process.argv[2],bytes=readFileSync(path),pe=bytes.readUInt32LE(0x3c)
assert.equal(bytes.toString('ascii',pe,pe+4),'PE\0\0')
const machine=bytes.readUInt16LE(pe+4),count=bytes.readUInt16LE(pe+6),optional=pe+24,size=bytes.readUInt16LE(pe+20),magic=bytes.readUInt16LE(optional)
const sections=[]
for(let i=0;i<count;i++){const s=optional+size+i*40;sections.push({virtual:bytes.readUInt32LE(s+12),size:Math.max(bytes.readUInt32LE(s+8),bytes.readUInt32LE(s+16)),raw:bytes.readUInt32LE(s+20)})}
const offset=rva=>{const s=sections.find(s=>rva>=s.virtual&&rva<s.virtual+s.size);assert(s,'Invalid PE RVA');return s.raw+rva-s.virtual}
const importsRva=bytes.readUInt32LE(optional+(magic===0x20b?112:96)+8),imports=[]
if(importsRva){for(let p=offset(importsRva);bytes.readUInt32LE(p+12)!==0;p+=20){const start=offset(bytes.readUInt32LE(p+12));imports.push(bytes.toString('ascii',start,bytes.indexOf(0,start)))}}
console.log(JSON.stringify({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),architecture:machine===0x8664?'x64':machine===0x14c?'x86':`0x${machine.toString(16)}`,imports},null,2))
