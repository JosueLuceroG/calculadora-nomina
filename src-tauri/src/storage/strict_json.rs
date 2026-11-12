use serde::{Deserialize,Deserializer,de::{self,MapAccess,SeqAccess,Visitor}};
use serde_json::Value;
use std::fmt;

struct StrictValue(Value);
impl<'de> Deserialize<'de> for StrictValue {
    fn deserialize<D:Deserializer<'de>>(d:D)->Result<Self,D::Error>{
        struct V;
        impl<'de> Visitor<'de> for V{
            type Value=StrictValue;
            fn expecting(&self,f:&mut fmt::Formatter)->fmt::Result{f.write_str("JSON without duplicate object keys")}
            fn visit_bool<E:de::Error>(self,v:bool)->Result<Self::Value,E>{Ok(StrictValue(v.into()))}
            fn visit_i64<E:de::Error>(self,v:i64)->Result<Self::Value,E>{Ok(StrictValue(v.into()))}
            fn visit_u64<E:de::Error>(self,v:u64)->Result<Self::Value,E>{Ok(StrictValue(v.into()))}
            fn visit_f64<E:de::Error>(self,v:f64)->Result<Self::Value,E>{serde_json::Number::from_f64(v).map(|n|StrictValue(Value::Number(n))).ok_or_else(||E::custom("Invalid JSON number"))}
            fn visit_str<E:de::Error>(self,v:&str)->Result<Self::Value,E>{Ok(StrictValue(v.into()))}
            fn visit_string<E:de::Error>(self,v:String)->Result<Self::Value,E>{Ok(StrictValue(v.into()))}
            fn visit_unit<E:de::Error>(self)->Result<Self::Value,E>{Ok(StrictValue(Value::Null))}
            fn visit_seq<A:SeqAccess<'de>>(self,mut a:A)->Result<Self::Value,A::Error>{let mut values=vec![];while let Some(v)=a.next_element::<StrictValue>()?{values.push(v.0);}Ok(StrictValue(Value::Array(values)))}
            fn visit_map<A:MapAccess<'de>>(self,mut a:A)->Result<Self::Value,A::Error>{let mut values=serde_json::Map::new();while let Some((key,value))=a.next_entry::<String,StrictValue>()?{if values.insert(key,value.0).is_some(){return Err(de::Error::custom("Duplicate JSON key"));}}Ok(StrictValue(Value::Object(values)))}
        }d.deserialize_any(V)
    }
}
pub fn parse(text:&str)->Result<Value,serde_json::Error>{serde_json::from_str::<StrictValue>(text).map(|v|v.0)}
