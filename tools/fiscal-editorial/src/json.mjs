import canonicalize from "canonicalize"
import {openSync,readSync,closeSync} from "node:fs"
export const LIMITS=Object.freeze({bytes:2097152,depth:32,nodes:50000,properties:128,keyBytes:128,stringBytes:16384,arrayItems:2048})
export function parseStrict(bytes,max=LIMITS.bytes){
  max=Math.min(max,LIMITS.bytes)
  if(bytes.length>max)throw new Error("FILE_LIMIT");if(bytes[0]===239&&bytes[1]===187&&bytes[2]===191)throw new Error("BOM_FORBIDDEN")
  const text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);let pos=0,nodes=0
  const fail=code=>{throw new Error(code)},ws=()=>{while(/[\x20\n\r\t]/.test(text[pos]??"!")&&pos<text.length)pos++}
  function string(key=false){const start=pos;if(text[pos++]!=='"')fail("INVALID_JSON");const max=key?LIMITS.keyBytes:LIMITS.stringBytes
    while(pos<text.length){if(pos-start>max*6+2)fail("STRING_LIMIT");const c=text.charCodeAt(pos++)
      if(c===34){const value=JSON.parse(text.slice(start,pos));for(let i=0;i<value.length;i++){const code=value.charCodeAt(i);if(code>=0xd800&&code<=0xdbff){const low=value.charCodeAt(++i);if(!(low>=0xdc00&&low<=0xdfff))fail("INVALID_UNICODE")}else if(code>=0xdc00&&code<=0xdfff)fail("INVALID_UNICODE")}
        if(Buffer.byteLength(value)>max)fail(key?"KEY_LIMIT":"STRING_LIMIT");return value}
      if(c===92){if(pos>=text.length)fail("INVALID_JSON");pos++}else if(c<32)fail("INVALID_JSON")
    }fail("INVALID_JSON")
  }
  function value(depth){if(depth>LIMITS.depth)fail("DEPTH_LIMIT");if(++nodes>LIMITS.nodes)fail("NODE_LIMIT");ws();const c=text[pos]
    if(c==='{'){pos++;ws();const result=Object.create(null);let count=0;if(text[pos]==='}'){pos++;return result}
      while(true){if(++count>LIMITS.properties)fail("PROPERTY_LIMIT");ws();const key=string(true);if(Object.hasOwn(result,key))fail("DUPLICATE_KEY");ws();if(text[pos++]!==':')fail("INVALID_JSON");result[key]=value(depth+1);ws();if(text[pos]==='}'){pos++;return result}if(text[pos++]!==',')fail("INVALID_JSON")}}
    if(c==='['){pos++;ws();const result=[];if(text[pos]===']'){pos++;return result}while(true){if(result.length>=LIMITS.arrayItems)fail("ARRAY_LIMIT");result.push(value(depth+1));ws();if(text[pos]===']'){pos++;return result}if(text[pos++]!==',')fail("INVALID_JSON")}}
    if(c==='"')return string();for(const[token,result]of[["true",true],["false",false],["null",null]])if(text.startsWith(token,pos)){pos+=token.length;return result}
    if(c==='-')fail("INTEGER_TOKEN_REQUIRED");if(c>='0'&&c<='9'){const start=pos;while(text[pos]>='0'&&text[pos]<='9')pos++;const raw=text.slice(start,pos);if(raw.length>1&&raw[0]==='0'||/[.eE]/.test(text[pos]??"!"))fail("INTEGER_TOKEN_REQUIRED");if(raw.length>16||raw.length===16&&raw>"9007199254740991")fail("UNSAFE_INTEGER");return Number(raw)}
    fail("INVALID_JSON")
  }
  const result=value(0);ws();if(pos!==text.length)fail("TRAILING_DATA");return result
}
export const canonicalBytes=value=>Buffer.from(canonicalize(value),"utf8")
export function requireCanonical(bytes){const value=parseStrict(bytes);if(!canonicalBytes(value).equals(Buffer.from(bytes)))throw new Error("NON_CANONICAL_WIRE");return value}
export function readBounded(path,max=LIMITS.bytes){const fd=openSync(path,"r"),buffer=Buffer.alloc(max+1);let length=0;try{while(length<buffer.length){const count=readSync(fd,buffer,length,buffer.length-length,null);if(!count)break;length+=count}if(length>max)throw new Error("FILE_LIMIT");return buffer.subarray(0,length)}finally{closeSync(fd)}}
