use crate::{errors::{Failure,Result,Stage},limits::*,time,wire::*};
use std::collections::BTreeSet;
fn bad(code:&'static str)->Failure{Failure::new(Stage::FiscalData,code)}
pub fn identifier(s:&str)->bool{!s.is_empty()&&s.len()<=MAX_ID_BYTES&&s.as_bytes()[0].is_ascii_alphanumeric()&&s.bytes().all(|b|b.is_ascii_alphanumeric()||b"-_:./".contains(&b))}
pub fn digest(s:&str)->bool{s.len()==64&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))}
/** Exact bounded decimal comparison. Never converts a financial value to f64. */
pub fn decimal(s:&str,scale:usize)->Result<(String,String)>{
    let mut parts=s.split('.');let integer=parts.next().unwrap_or("");let fraction=parts.next();
    if integer.is_empty()||integer.len()>20||!integer.bytes().all(|c|c.is_ascii_digit())||parts.next().is_some(){return Err(bad("INVALID_DECIMAL"));}
    let f=fraction.unwrap_or("");if fraction.is_some()&&f.is_empty()||f.len()>scale||!f.bytes().all(|c|c.is_ascii_digit()){return Err(bad("INVALID_DECIMAL"));}
    let i=integer.trim_start_matches('0');let combined=format!("{i}{f}");if combined.trim_start_matches('0').len()>50{return Err(bad("DECIMAL_PRECISION_LIMIT"));}
    Ok((if i.is_empty(){"0".into()}else{i.into()},f.trim_end_matches('0').into()))
}
pub fn cmp(a:&str,b:&str)->Result<std::cmp::Ordering>{let(ai,af)=decimal(a,50)?;let(bi,bf)=decimal(b,50)?;let width=af.len().max(bf.len());Ok(ai.len().cmp(&bi.len()).then_with(||ai.cmp(&bi)).then_with(||format!("{af:0<width$}").cmp(&format!("{bf:0<width$}"))))}
fn positive(s:&str,scale:usize)->Result<()>{decimal(s,scale)?;if cmp(s,"0")?!=std::cmp::Ordering::Greater{return Err(bad("NON_POSITIVE_PARAMETER"));}Ok(())}
fn money_cents(s:&str)->Result<u128>{let(i,f)=decimal(s,2)?;i.parse::<u128>().ok().and_then(|v|v.checked_mul(100)).and_then(|v|format!("{f:0<2}").parse::<u128>().ok().and_then(|f|v.checked_add(f))).ok_or_else(||bad("INVALID_MONEY"))}
pub fn source(s:&Source)->Result<()>{
    let u=url::Url::parse(&s.url).map_err(|_|bad("INVALID_SOURCE_URL"))?;
    if u.scheme()!="https"||!matches!(u.host_str(),Some("www.sat.gob.mx"|"sat.gob.mx"|"www.dof.gob.mx"|"dof.gob.mx"|"sidof.segob.gob.mx"|"www.imss.gob.mx"|"imss.gob.mx"|"www.inegi.org.mx"|"inegi.org.mx"|"www.diputados.gob.mx"|"www.gob.mx"|"gob.mx"))||!u.username().is_empty()||u.password().is_some()||u.port().is_some(){return Err(bad("INVALID_SOURCE_URL"));}
    if !["SAT","SHCP","DOF","IMSS","INEGI","CONASAMI","Cámara de Diputados"].contains(&s.authority.as_str())||s.document.trim().is_empty()||s.locator.trim().is_empty()
        ||!time::civil(&s.publication_date)||!time::civil(&s.verified_on)||s.publication_date>s.verified_on||s.current_text_as_of.as_ref().map(|d|!time::civil(d)||d>&s.verified_on).unwrap_or(false){return Err(bad("INVALID_SOURCE_METADATA"));}Ok(())
}
fn timeline<T>(sets:&[ParameterSet<T>],coverage:&Dates,kind:&str,key:&str,ids:&mut BTreeSet<String>,catalog:&[Source])->Result<()>{
    if sets.is_empty(){return Err(bad("MISSING_PARAMETER"));}let mut ordered=sets.iter().collect::<Vec<_>>();ordered.sort_by_key(|s|&s.effective_from);
    for s in &ordered{
        if !identifier(&s.id)||!identifier(&s.version)||!ids.insert(s.id.clone())||s.kind!=kind||s.key!=key||s.validation!="source-verified"||s.validation_scope!="source-data-only"||s.sources.is_empty(){return Err(bad("INVALID_PARAMETER_METADATA"));}
        if !time::civil(&s.effective_from)||s.effective_through.as_ref().map(|d|!time::civil(d)||d<&s.effective_from).unwrap_or(false){return Err(bad("INVALID_INTERVAL"));}
        for source_item in &s.sources{source(source_item)?;if !catalog.contains(source_item){return Err(bad("SOURCE_NOT_CATALOGUED"));}}
    }
    for pair in ordered.windows(2){if pair[0].effective_through.as_ref().map(|d|d>=&pair[1].effective_from).unwrap_or(true){return Err(bad("OVERLAPPING_INTERVALS"));}}
    let mut needed=coverage.from.clone();for s in ordered{
        if s.effective_through.as_ref().map(|d|d<&needed).unwrap_or(false){continue;}if s.effective_from>coverage.through{break;}if s.effective_from>needed{return Err(bad("COVERAGE_GAP"));}
        match &s.effective_through{None=>return Ok(()),Some(end) if end>=&coverage.through=>return Ok(()),Some(end)=>needed=time::next(end).ok_or_else(||bad("INVALID_INTERVAL"))?}
    }Err(bad("COVERAGE_GAP"))
}
pub fn validate(p:&SignedPackage)->Result<()>{
    let r=&p.registry;let m=&p.manifest;
    if r.exercise!=2026{return Err(bad("UNREVIEWED_FISCAL_EXERCISE"));}
    if r.supported_dates.from!="2026-01-01"||r.supported_dates.through!="2026-12-31"||m.exercise!=r.exercise||m.supported_dates!=r.supported_dates||m.parameter_version!=r.version||!identifier(&m.package_id)||!identifier(&r.version){return Err(bad("PACKAGE_IDENTITY_OR_COVERAGE_MISMATCH"));}
    if m.sources.is_empty()||m.sources.len()>MAX_SOURCES||m.parameter_sets.is_empty()||m.parameter_sets.len()>MAX_SETS{return Err(bad("SOURCE_OR_SET_LIMIT"));}
    for s in &m.sources{source(s)?;}
    if r.isr_tariffs.len()+r.uma.len()+r.minimum_wages.len()+r.subsidy.len()+r.imss_constants.len()+r.contractual_divisors.len()+r.labor_benefit_minima.len()>MAX_SETS{return Err(bad("SET_LIMIT"));}
    let catalogued=m.sources.iter().map(|s|crate::canonical::bytes(s)).collect::<Result<Vec<_>>>()?;if catalogued.iter().collect::<BTreeSet<_>>().len()!=catalogued.len(){return Err(bad("DUPLICATE_SOURCE"));}
    let mut ids=BTreeSet::new();let mut all_identities=vec![];
    for period in ["weekly","fortnightly","monthly"]{
        let sets=r.isr_tariffs.iter().filter(|s|s.key==period).cloned().collect::<Vec<_>>();timeline(&sets,&r.supported_dates,"isr-tariff",period,&mut ids,&m.sources)?;
        for s in sets{if s.data.exercise!=2026||s.data.periodicity!=period||s.data.rows.len()!=11||money_cents(&s.data.rows[0].lower)?!=1{return Err(bad("INVALID_TARIFF"));}
            for(i,row)in s.data.rows.iter().enumerate(){positive(&row.lower,2)?;decimal(&row.fixed_fee,2)?;positive(&row.rate_percent,50)?;if cmp(&row.rate_percent,"100")?==std::cmp::Ordering::Greater{return Err(bad("INVALID_TARIFF_RATE"));}
                match &row.upper{None if i==10=>{},Some(upper) if i<10=>{if money_cents(upper)?<money_cents(&row.lower)?||money_cents(upper)?.checked_add(1)!=Some(money_cents(&s.data.rows[i+1].lower)?){return Err(bad("INVALID_TARIFF_CONTINUITY"));}},_=>return Err(bad("INVALID_TARIFF"))}}
        }
    }
    if r.isr_tariffs.iter().any(|s|!["weekly","fortnightly","monthly"].contains(&s.key.as_str())){return Err(bad("UNKNOWN_PERIODICITY"));}
    macro_rules! family {($sets:expr,$kind:expr,$key:expr)=>{{timeline($sets,&r.supported_dates,$kind,$key,&mut ids,&m.sources)?;}};}
    family!(&r.uma,"uma","daily-monthly-annual");family!(&r.minimum_wages,"minimum-wages","official-zones");family!(&r.subsidy,"employment-subsidy","2026-decree");family!(&r.imss_constants,"imss-constants","ordinary-regime");family!(&r.contractual_divisors,"contractual-divisors","LSS-29-II");family!(&r.labor_benefit_minima,"labor-benefit-minima","LFT-annual-benefits");
    macro_rules! identities {($sets:expr)=>{for s in $sets{all_identities.push(SetIdentity{id:s.id.clone(),version:s.version.clone()});}};}
    identities!(&r.isr_tariffs);identities!(&r.uma);identities!(&r.minimum_wages);identities!(&r.subsidy);identities!(&r.imss_constants);identities!(&r.contractual_divisors);identities!(&r.labor_benefit_minima);
    if all_identities.len()>MAX_SETS||all_identities!=m.parameter_sets{return Err(bad("PARAMETER_CATALOG_MISMATCH"));}
    for s in &r.uma{for value in [&s.data.daily,&s.data.monthly,&s.data.annual]{positive(value,2)?;}if s.data.unit!="MXN"||![2025,2026].contains(&s.data.value_year){return Err(bad("INVALID_UMA"));}}
    for s in &r.minimum_wages{for z in [&s.data.general,&s.data.northern_border]{positive(&z.daily,2)?;positive(&z.published_monthly_reference,2)?;}if s.data.territorial_definition_reference.is_empty()||s.data.monthly_expression_reference!="daily-times-365-divided-by-12"{return Err(bad("INVALID_MINIMUM_REFERENCE"));}}
    for s in &r.subsidy{positive(&s.data.rate_proportion,50)?;positive(&s.data.submonthly_divisor,50)?;positive(&s.data.monthly_income_limit,2)?;
        if cmp(&s.data.rate_proportion,"1")?==std::cmp::Ordering::Greater||s.data.monthly_quota_definition!="official-uma-monthly-times-rate"||s.data.formula_text.is_empty(){return Err(bad("INVALID_SUBSIDY"));}
        // Check the union of both timeline cut points, not just subsidy start.
        for date in std::iter::once(&r.supported_dates.from).chain(r.uma.iter().map(|u|&u.effective_from)).chain(r.subsidy.iter().map(|u|&u.effective_from)){
            if date<&r.supported_dates.from||date>&r.supported_dates.through||date<&s.effective_from||s.effective_through.as_ref().map(|end|date>end).unwrap_or(false){continue;}
            let uma=r.uma.iter().find(|u|&u.effective_from<=date&&u.effective_through.as_ref().map(|end|date<=end).unwrap_or(true)).ok_or_else(||bad("MISSING_UMA"))?;if uma.data.value_year!=s.data.uma_monthly_value_year{return Err(bad("UMA_SUBSIDY_YEAR_MISMATCH"));}
        }
    }
    let branches=["pensioner-medical","cash-benefits","disability-life","unemployment-old-age","excess-medical"];
    for s in &r.imss_constants{positive(&s.data.sbc_ceiling_uma_daily_multiple,50)?;positive(&s.data.excess_threshold_uma_daily_multiple,50)?;
        if cmp(&s.data.excess_threshold_uma_daily_multiple,&s.data.sbc_ceiling_uma_daily_multiple)?!=std::cmp::Ordering::Less||s.data.minimum_sbc_reference!="area-minimum-daily-wage"||s.data.worker_absorption_reference!="LSS-36"||s.data.worker_rates.len()!=5||s.data.base_references.len()!=5{return Err(bad("INVALID_IMSS_CONSTANTS"));}
        for branch in branches{let rate=s.data.worker_rates.get(branch).ok_or_else(||bad("MISSING_IMSS_BRANCH"))?;positive(rate,50)?;if cmp(rate,"1")?==std::cmp::Ordering::Greater||s.data.base_references.get(branch).map(String::as_str)!=Some(if branch=="excess-medical"{"sbc-excess-over-threshold"}else{"sbc"}){return Err(bad("INVALID_IMSS_BRANCH"));}}
    }
    for s in &r.contractual_divisors{for value in [&s.data.weekly,&s.data.fortnightly,&s.data.monthly]{positive(value,50)?;}}
    for s in &r.labor_benefit_minima{for value in [&s.data.annual_bonus_days,&s.data.first_annual_vacation_days,&s.data.vacation_premium_percent]{positive(value,50)?;}if s.data.vacation_seniority_reference!="LFT-76-not-inferred"{return Err(bad("INVALID_BENEFIT_REFERENCE"));}}
    for sources in [&p.rule_sources.subsidy,&p.rule_sources.retention]{if sources.is_empty()||sources.len()>MAX_SOURCES{return Err(bad("MISSING_RULE_SOURCES"));}for s in sources{source(s)?;if !m.sources.contains(s){return Err(bad("SOURCE_NOT_CATALOGUED"));}}}
    if !identifier(&p.review.record_id)||!time::civil(&p.review.reviewed_on)||!time::instant(&p.publication.published_at)||Some(p.review.reviewed_on.as_str())>p.publication.published_at.get(..10)||!digest(&p.review.independent_report_sha256)||p.review.compatibility_statement!="data-only-same-implemented-rules"||p.review.source_checks.len()!=m.sources.len(){return Err(bad("INVALID_REVIEW_RECORD"));}
    for (i,check)in p.review.source_checks.iter().enumerate(){if check.source_index!=i||check.verified_on!=m.sources[i].verified_on||check.verified_on>p.review.reviewed_on||check.document_sha256.as_ref().map(|s|!digest(s)).unwrap_or(false){return Err(bad("INVALID_SOURCE_REVIEW"));}}
    Ok(())
}
