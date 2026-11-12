use crate::{errors::{Failure,Result,Stage},limits::*};
use serde_json::{Map,Value};

fn error(code:&'static str)->Failure{Failure::new(Stage::Processing,code)}
struct Parser<'a>{input:&'a [u8],pos:usize,nodes:usize}
impl Parser<'_>{
    fn ws(&mut self){while self.pos<self.input.len()&&matches!(self.input[self.pos],b' '|b'\n'|b'\r'|b'\t'){self.pos+=1;}}
    fn take(&mut self,c:u8)->Result<()>{if self.input.get(self.pos)!=Some(&c){return Err(error("INVALID_JSON"));}self.pos+=1;Ok(())}
    fn string(&mut self,key:bool)->Result<String>{
        let start=self.pos;self.take(b'"')?;let max=if key{MAX_KEY_BYTES}else{MAX_STRING_BYTES};
        loop{
            if self.pos-start>max*6+2{return Err(error(if key{"KEY_LIMIT"}else{"STRING_LIMIT"}));}
            match self.input.get(self.pos).copied(){
                Some(b'"')=>{self.pos+=1;let value:String=serde_json::from_slice(&self.input[start..self.pos]).map_err(|_|error("INVALID_UNICODE_OR_STRING"))?;
                    if value.len()>max{return Err(error(if key{"KEY_LIMIT"}else{"STRING_LIMIT"}));}return Ok(value);},
                Some(b'\\')=>{self.pos+=1;if self.input.get(self.pos).is_none(){return Err(error("INVALID_JSON"));}self.pos+=1;},
                Some(0..=31)|None=>return Err(error("INVALID_JSON")),
                _=>self.pos+=1,
            }
        }
    }
    fn value(&mut self,depth:usize)->Result<Value>{
        if depth>MAX_DEPTH{return Err(error("DEPTH_LIMIT"));}self.nodes+=1;if self.nodes>MAX_NODES{return Err(error("NODE_LIMIT"));}self.ws();
        match self.input.get(self.pos).copied(){
            Some(b'{')=>{self.pos+=1;self.ws();let mut object=Map::new();if self.input.get(self.pos)==Some(&b'}'){self.pos+=1;return Ok(Value::Object(object));}
                loop{if object.len()>=MAX_PROPERTIES{return Err(error("PROPERTY_LIMIT"));}self.ws();let key=self.string(true)?;if object.contains_key(&key){return Err(error("DUPLICATE_KEY"));}self.ws();self.take(b':')?;let value=self.value(depth+1)?;object.insert(key,value);self.ws();
                    if self.input.get(self.pos)==Some(&b'}'){self.pos+=1;break;}self.take(b',')?;}
                Ok(Value::Object(object))},
            Some(b'[')=>{self.pos+=1;self.ws();let mut array=vec![];if self.input.get(self.pos)==Some(&b']'){self.pos+=1;return Ok(Value::Array(array));}
                loop{if array.len()>=MAX_ARRAY_ITEMS{return Err(error("ARRAY_LIMIT"));}array.push(self.value(depth+1)?);self.ws();if self.input.get(self.pos)==Some(&b']'){self.pos+=1;break;}self.take(b',')?;}
                Ok(Value::Array(array))},
            Some(b'"')=>self.string(false).map(Value::String),
            Some(b't')=>{self.literal(b"true")?;Ok(Value::Bool(true))},Some(b'f')=>{self.literal(b"false")?;Ok(Value::Bool(false))},Some(b'n')=>{self.literal(b"null")?;Ok(Value::Null)},
            Some(b'0'..=b'9')=>{let start=self.pos;while matches!(self.input.get(self.pos),Some(b'0'..=b'9')){self.pos+=1;}let raw=&self.input[start..self.pos];
                if (raw.len()>1&&raw[0]==b'0')||matches!(self.input.get(self.pos),Some(b'.'|b'e'|b'E')){return Err(error("INTEGER_TOKEN_REQUIRED"));}
                let text=std::str::from_utf8(raw).map_err(|_|error("INVALID_UTF8"))?;let n=text.parse::<u64>().map_err(|_|error("UNSAFE_INTEGER"))?;if n>MAX_SAFE_INTEGER{return Err(error("UNSAFE_INTEGER"));}Ok(n.into())},
            Some(b'-')=>Err(error("INTEGER_TOKEN_REQUIRED")),_=>Err(error("INVALID_JSON")),
        }
    }
    fn literal(&mut self,expected:&[u8])->Result<()>{if self.input.get(self.pos..self.pos+expected.len())!=Some(expected){return Err(error("INVALID_JSON"));}self.pos+=expected.len();Ok(())}
}
pub fn parse_with_limit(input:&[u8],max:usize)->Result<Value>{
    let max=max.min(MAX_BYTES); // callers may restrict, never expand the protocol cap
    if input.len()>max{return Err(error("FILE_LIMIT"));}std::str::from_utf8(input).map_err(|_|error("INVALID_UTF8"))?;
    if input.starts_with(&[0xef,0xbb,0xbf]){return Err(error("BOM_FORBIDDEN"));}
    let mut parser=Parser{input,pos:0,nodes:0};let value=parser.value(0)?;parser.ws();if parser.pos!=input.len(){return Err(error("TRAILING_DATA"));}Ok(value)
}
pub fn parse(input:&[u8])->Result<Value>{parse_with_limit(input,MAX_BYTES)}
