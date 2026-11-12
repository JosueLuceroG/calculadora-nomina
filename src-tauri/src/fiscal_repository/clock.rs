use super::errors::*;
use std::time::{SystemTime,UNIX_EPOCH};
#[derive(Clone)]pub struct Clock{#[cfg(test)]pub fixed:Option<std::sync::Arc<std::sync::Mutex<String>>>}
impl Clock{
    pub fn system()->Self{Self{#[cfg(test)]fixed:None}}
    pub fn now(&self)->Result<String>{
        #[cfg(test)]if let Some(v)=&self.fixed{return Ok(v.lock().map_err(|_|fail("CLOCK_ERROR"))?.clone());}
        let secs=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|fail("CLOCK_ERROR"))?.as_secs();utc(secs)
    }
}
pub fn utc(secs:u64)->Result<String>{
    let mut days=secs/86400;let mut year=1970;loop{let n=if year%4==0&&(year%100!=0||year%400==0){366}else{365};if days<n{break;}days-=n;year+=1;if year>9999{return Err(fail("CLOCK_ERROR"));}}
    let leap=year%4==0&&(year%100!=0||year%400==0);let months=[31,if leap{29}else{28},31,30,31,30,31,31,30,31,30,31];let mut month=0;while days>=months[month]{days-=months[month];month+=1;}
    Ok(format!("{year:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",month+1,days+1,(secs%86400)/3600,(secs%3600)/60,secs%60))
}
pub fn check(now:&str,maximum:&str)->Result<()>{if !nomina_fiscal_package::time::instant(now){return Err(fail("CLOCK_ERROR"));}if !maximum.is_empty()&&now<maximum{return Err(fail("CLOCK_ROLLBACK"));}Ok(())}
