//! Bounded transient result JSON, not another cryptographic verifier/codec.
use super::*;
use serde::de::{DeserializeSeed,Visitor,SeqAccess,MapAccess,Error as DeError};
use serde_json::{Value,Map,Number};
struct Seed<'a>{nodes:&'a mut usize,depth:usize}
impl<'de> DeserializeSeed<'de> for Seed<'_>{type Value=Value;fn deserialize<D:serde::Deserializer<'de>>(self,d:D)->std::result::Result<Value,D::Error>{if self.depth>96||*self.nodes>=1_572_864{return Err(D::Error::custom("budget"));}*self.nodes+=1;d.deserialize_any(self)}}
impl<'de> Visitor<'de> for Seed<'_>{type Value=Value;fn expecting(&self,f:&mut std::fmt::Formatter)->std::fmt::Result{f.write_str("bounded JSON")}
 fn visit_unit<E:DeError>(self)->std::result::Result<Value,E>{Ok(Value::Null)}
 fn visit_bool<E:DeError>(self,v:bool)->std::result::Result<Value,E>{Ok(Value::Bool(v))}
 fn visit_i64<E:DeError>(self,v:i64)->std::result::Result<Value,E>{if v.unsigned_abs()>9_007_199_254_740_991{return Err(E::custom("number"));}Ok(v.into())}
 fn visit_u64<E:DeError>(self,v:u64)->std::result::Result<Value,E>{if v>9_007_199_254_740_991{return Err(E::custom("number"));}Ok(v.into())}
 fn visit_f64<E:DeError>(self,v:f64)->std::result::Result<Value,E>{if !v.is_finite()||v.abs()>9_007_199_254_740_991.0||v==0.0&&v.is_sign_negative(){return Err(E::custom("number"));}Ok(Value::Number(Number::from_f64(v).ok_or_else(||E::custom("number"))?))}
 fn visit_str<E:DeError>(self,v:&str)->std::result::Result<Value,E>{Ok(Value::String(v.into()))}
 fn visit_string<E:DeError>(self,v:String)->std::result::Result<Value,E>{Ok(Value::String(v))}
 fn visit_seq<A:SeqAccess<'de>>(self,mut a:A)->std::result::Result<Value,A::Error>{let mut v=vec![];while let Some(x)=a.next_element_seed(Seed{nodes:self.nodes,depth:self.depth+1})?{v.push(x);}Ok(Value::Array(v))}
 fn visit_map<A:MapAccess<'de>>(self,mut a:A)->std::result::Result<Value,A::Error>{let mut v=Map::new();while let Some(k)=a.next_key::<String>()?{if v.contains_key(&k){return Err(A::Error::custom("duplicate"));}let x=a.next_value_seed(Seed{nodes:self.nodes,depth:self.depth+1})?;v.insert(k,x);}Ok(Value::Object(v))}
}
pub fn parse(s:&str)->Result<Value>{if s.len()>RESULT_MAX{return Err(fail("RESULT_TOO_LARGE"));}let mut d=serde_json::Deserializer::from_str(s);let mut nodes=0;let v=Seed{nodes:&mut nodes,depth:0}.deserialize(&mut d).map_err(|_|fail("INVALID_RESULT_JSON"))?;d.end().map_err(|_|fail("INVALID_RESULT_JSON"))?;Ok(v)}
