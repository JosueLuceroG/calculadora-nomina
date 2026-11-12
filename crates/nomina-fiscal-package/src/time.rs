pub fn civil(value:&str)->bool{
    if value.len()!=10||!value.is_ascii()||value.as_bytes()[4]!=b'-'||value.as_bytes()[7]!=b'-'||value.bytes().enumerate().any(|(i,b)|i!=4&&i!=7&&!b.is_ascii_digit()){return false;}
    let parse=|s:&str|s.parse::<u32>().ok();let(Some(y),Some(m),Some(d))=(parse(&value[..4]),parse(&value[5..7]),parse(&value[8..]))else{return false;};
    let lengths=[31,if y%4==0&&(y%100!=0||y%400==0){29}else{28},31,30,31,30,31,31,30,31,30,31];y>0&&(1..=12).contains(&m)&&d>0&&d<=lengths[(m - 1)as usize]
}
pub fn instant(value:&str)->bool{
    value.len()==20&&value.is_ascii()&&civil(&value[..10])&&value.as_bytes()[10]==b'T'&&value.as_bytes()[13]==b':'&&value.as_bytes()[16]==b':'&&value.as_bytes()[19]==b'Z'
        &&[11..13,14..16,17..19].iter().all(|r|value.as_bytes()[r.clone()].iter().all(u8::is_ascii_digit))
        &&value[11..13].parse::<u32>().map(|v|v<24).unwrap_or(false)&&value[14..16].parse::<u32>().map(|v|v<60).unwrap_or(false)&&value[17..19].parse::<u32>().map(|v|v<60).unwrap_or(false)
}
pub fn seconds(value:&str)->Option<i64>{if !instant(value){return None;}let y=value[..4].parse::<i64>().ok()?;let m=value[5..7].parse::<usize>().ok()?;let d=value[8..10].parse::<i64>().ok()?;
    let previous=y-1;let mut days=previous*365+previous/4-previous/100+previous/400;let lengths=[31,if y%4==0&&(y%100!=0||y%400==0){29}else{28},31,30,31,30,31,31,30,31,30,31];days+=lengths[..m - 1].iter().sum::<i64>()+d-1;
    Some(days*86400+value[11..13].parse::<i64>().ok()?*3600+value[14..16].parse::<i64>().ok()?*60+value[17..19].parse::<i64>().ok()?)
}
pub fn next(value:&str)->Option<String>{if !civil(value){return None;}let y=value[..4].parse::<u32>().ok()?;let m=value[5..7].parse::<u32>().ok()?;let d=value[8..].parse::<u32>().ok()?;
    let next=format!("{y:04}-{m:02}-{:02}",d+1);if civil(&next){return Some(next);}if m<12{Some(format!("{y:04}-{:02}-01",m+1))}else if y<9999{Some(format!("{:04}-01-01",y+1))}else{None}
}
