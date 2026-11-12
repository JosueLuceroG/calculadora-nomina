use serde::{Deserialize,Serialize};
use std::collections::BTreeMap;
macro_rules! dto {($name:ident {$($field:ident:$ty:ty),*$(,)?})=>{#[derive(Debug,Clone,PartialEq,Eq,Serialize,Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]pub struct $name{$(pub $field:$ty),*}};}
#[derive(Debug,Clone,Copy,PartialEq,Eq,Serialize,Deserialize)]#[serde(rename_all="lowercase")]pub enum Channel{Qa,Production}
#[derive(Debug,Clone,Copy,PartialEq,Eq,PartialOrd,Ord,Serialize,Deserialize)]#[serde(rename_all="kebab-case")]pub enum Purpose{ContentApproval,Package,RollbackAuthorization,TrustRoot}
impl Purpose{pub fn name(self)->&'static str{match self{Self::ContentApproval=>"content-approval",Self::Package=>"package",Self::RollbackAuthorization=>"rollback-authorization",Self::TrustRoot=>"trust-root"}}}
#[derive(Debug,Clone,Copy,PartialEq,Eq,PartialOrd,Ord,Serialize,Deserialize)]#[serde(rename_all="lowercase")]pub enum Capability{Direct,Inverse}
dto!(Protected{protocol_version:u64,algorithm:String,key_id:String,purpose:Purpose});
dto!(SignatureRecord{protected:Protected,value:String});
dto!(ContentIdentity{scheme:String,sha256:String});
dto!(Dates{from:String,through:String});
dto!(SetIdentity{id:String,version:String});
#[derive(Debug,Clone,PartialEq,Eq,Serialize,Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]pub struct Source{
    pub authority:String,pub document:String,pub url:String,pub locator:String,pub publication_date:String,pub verified_on:String,
    #[serde(skip_serializing_if="Option::is_none")]pub current_text_as_of:Option<String>,
}
dto!(Manifest{manifest_version:u64,package_id:String,parameter_version:String,exercise:u64,supported_dates:Dates,parameter_schema_id:String,required_rule_profile_id:String,required_contextual_policy_id:String,required_capabilities:Vec<Capability>,parameter_sets:Vec<SetIdentity>,sources:Vec<Source>,content_identity:ContentIdentity});
dto!(Changes{summary:String,supersedes:Option<ContentIdentity>});
dto!(Publication{stream_id:String,stream_epoch:u64,revision:u64,published_at:String,minimum_trust_epoch:u64,changes:Changes});
dto!(SourceCheck{source_index:usize,verified_on:String,document_sha256:Option<String>});
dto!(Review{record_id:String,reviewed_on:String,independent_report_sha256:String,compatibility_statement:String,source_checks:Vec<SourceCheck>});
dto!(RuleSources{subsidy:Vec<Source>,retention:Vec<Source>});
dto!(Periods{weekly:String,fortnightly:String,monthly:String});
dto!(Conventions{id:String,nature:String,activation:String,result_classification:String,reference_cotized_days:Periods,monthly_income_reference_days:String,temporal_scope:String,interval_inference:String,subsidy_estimation:String,monthly_accumulation:String,geography:String,benefit_seniority:String,fiscal_rounding_approval:String,sua_equivalence:String});
#[derive(Debug,Clone,PartialEq,Eq,Serialize,Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]pub struct ParameterSet<T>{pub id:String,pub kind:String,pub key:String,pub version:String,pub effective_from:String,pub effective_through:Option<String>,pub validation:String,pub validation_scope:String,pub sources:Vec<Source>,pub data:T}
dto!(TariffRow{lower:String,upper:Option<String>,fixed_fee:String,rate_percent:String});
dto!(Tariff{exercise:u64,periodicity:String,rows:Vec<TariffRow>});
dto!(Uma{value_year:u64,daily:String,monthly:String,annual:String,unit:String});
dto!(Zone{daily:String,published_monthly_reference:String});
dto!(MinimumWages{general:Zone,northern_border:Zone,territorial_definition_reference:String,monthly_expression_reference:String});
dto!(Subsidy{uma_monthly_value_year:u64,rate_proportion:String,monthly_income_limit:String,submonthly_divisor:String,monthly_quota_definition:String,formula_text:String});
dto!(Imss{sbc_ceiling_uma_daily_multiple:String,excess_threshold_uma_daily_multiple:String,worker_rates:BTreeMap<String,String>,base_references:BTreeMap<String,String>,minimum_sbc_reference:String,worker_absorption_reference:String});
dto!(Benefits{annual_bonus_days:String,first_annual_vacation_days:String,vacation_premium_percent:String,vacation_seniority_reference:String});
dto!(Registry{version:String,exercise:u64,supported_dates:Dates,isr_tariffs:Vec<ParameterSet<Tariff>>,uma:Vec<ParameterSet<Uma>>,minimum_wages:Vec<ParameterSet<MinimumWages>>,subsidy:Vec<ParameterSet<Subsidy>>,imss_constants:Vec<ParameterSet<Imss>>,contractual_divisors:Vec<ParameterSet<Periods>>,labor_benefit_minima:Vec<ParameterSet<Benefits>>});
dto!(SignedPackage{format:String,format_version:u64,canonicalization:String,channel:Channel,publication:Publication,manifest:Manifest,registry:Registry,rule_sources:RuleSources,conventions:Conventions,review:Review});
dto!(Envelope{signed:SignedPackage,signatures:Vec<SignatureRecord>});
dto!(RootKey{key_id:String,public_key:String});
dto!(Delegation{key_id:String,public_key:String,purpose:Purpose,channel:Channel,exercise:u64,parameter_schema_id:String,rule_profile_id:String,contextual_policy_id:String,stream_id:String,stream_epoch:u64,minimum_revision:u64,maximum_revision:u64,not_before:String,not_after:String,operations:Vec<Capability>});
dto!(StreamFloor{stream_id:String,exercise:u64,rule_profile_id:String,stream_epoch:u64,minimum_revision:u64,reason:Option<String>});
dto!(SignedTrust{format:String,format_version:u64,canonicalization:String,channel:Channel,root_version:u64,epoch:u64,issued_at:String,expires_at:String,root_validity:Dates,root_keys:Vec<RootKey>,threshold:usize,delegations:Vec<Delegation>,revoked_key_ids:Vec<String>,withdrawn_payloads:Vec<String>,floors:Vec<StreamFloor>});
dto!(TrustEnvelope{signed:SignedTrust,signatures:Vec<SignatureRecord>});
dto!(RollbackGrant{format:String,format_version:u64,channel:Channel,stream_id:String,stream_epoch:u64,target_payload_sha256:String,previous_minimum_revision:u64,expires_at:String,reason:String,nonce:String});
dto!(RollbackEnvelope{signed:RollbackGrant,signatures:Vec<SignatureRecord>});
