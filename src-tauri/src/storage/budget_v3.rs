//! Streaming token preflight. No full Value tree before size/depth/node checks.
use super::*;
use std::collections::HashSet;
pub const MAX_DEPTH:usize=96;
pub const MAX_NODES:usize=1_572_864;
struct Scan<'a>{b:&'a [u8],i:usize,nodes:usize,depth:usize,v3:bool,duplicate:bool,negative_zero:bool}
impl Scan<'_>{
fn bad<T>(&self)->Result<T>{Err(failure("INVALID_SNAPSHOT"))}
fn ws(&mut self){while self.i<self.b.len()&&matches!(self.b[self.i],b' '|b'\n'|b'\r'|b'\t'){self.i+=1;}}
fn string(&mut self)->Result<String>{let start=self.i;if self.b.get(self.i)!=Some(&b'"'){return self.bad();}self.i+=1;while self.i<self.b.len(){let c=self.b[self.i];self.i+=1;if c==b'"'{return serde_json::from_slice(&self.b[start..self.i]).map_err(|_|failure("INVALID_SNAPSHOT"));}if c<32{return self.bad();}if c==b'\\'{self.i+=1;if self.i>self.b.len(){return self.bad();}}}self.bad()}
fn value(&mut self,d:usize,root_value:bool,version:bool)->Result<()>{if d>128{return self.bad();}self.depth=self.depth.max(d);self.nodes+=1;if self.nodes>MAX_NODES{return self.bad();}self.ws();match self.b.get(self.i).copied(){
Some(b'{')=>{self.i+=1;self.ws();let mut keys=HashSet::new();if self.b.get(self.i)==Some(&b'}'){self.i+=1;return Ok(());}loop{self.ws();let key=self.string()?;if !keys.insert(key.clone()){self.duplicate=true;}self.ws();if self.b.get(self.i)!=Some(&b':'){return self.bad();}self.i+=1;self.value(d+1,d==0&&key=="value",root_value&&key=="schemaVersion")?;self.ws();match self.b.get(self.i){Some(b'}')=>{self.i+=1;return Ok(());},Some(b',')=>self.i+=1,_=>return self.bad()}}},
Some(b'[')=>{self.i+=1;self.ws();if self.b.get(self.i)==Some(&b']'){self.i+=1;return Ok(());}loop{self.value(d+1,false,false)?;self.ws();match self.b.get(self.i){Some(b']')=>{self.i+=1;return Ok(());},Some(b',')=>self.i+=1,_=>return self.bad()}}},
Some(b'"')=>{self.string()?;Ok(())},
Some(b'n')|Some(b't')|Some(b'f')=>{let token:&[u8]=match self.b[self.i]{b'n'=>b"null",b't'=>b"true",_=>b"false"};if self.b.get(self.i..self.i+token.len())!=Some(token){return self.bad();}self.i+=token.len();Ok(())},
Some(b'-'|b'0'..=b'9')=>{let start=self.i;while matches!(self.b.get(self.i),Some(b'0'..=b'9'|b'-'|b'+'|b'.'|b'e'|b'E')){self.i+=1;}let raw=&self.b[start..self.i];let number:serde_json::Number=serde_json::from_slice(raw).map_err(|_|failure("INVALID_SNAPSHOT"))?;if raw.starts_with(b"-")&&number.as_f64()==Some(0.0){self.negative_zero=true;}if version&&number.as_f64()==Some(3.0){self.v3=true;if raw!=b"3"{return self.bad();}}Ok(())},_=>self.bad()}}
}
pub fn scan(payload:&str)->Result<bool>{if payload.len()>validation::MAX_PAYLOAD{return Err(failure("INVALID_SNAPSHOT"));}let mut s=Scan{b:payload.as_bytes(),i:0,nodes:0,depth:0,v3:false,duplicate:false,negative_zero:false};s.value(0,false,false)?;s.ws();if s.i!=s.b.len()||(s.v3&&(s.depth>MAX_DEPTH||s.duplicate||s.negative_zero)){return Err(failure("INVALID_SNAPSHOT"));}Ok(s.v3)}
