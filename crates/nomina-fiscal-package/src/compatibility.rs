use crate::{errors::{Failure,Result,Stage},wire::*};
use serde::Serialize;
#[derive(Clone)]pub struct CompiledPolicy{inverse:bool}
#[derive(Debug,Clone,Serialize)]#[serde(rename_all="camelCase")]pub struct Compatibility{pub rule_profile:String,pub direct_available:bool,pub inverse_available:bool,pub content_matches_integrated_pin:bool,pub dynamic_admission_enabled:bool,pub inverse_certificate:&'static str}
impl CompiledPolicy{
    pub fn current_2026()->Self{Self{inverse:true}}
    pub fn direct_only(&self)->Self{Self{inverse:false}}
    pub fn motor_identity(&self)->&'static str{"payroll-js-sha256:4f90d957a9948f8a90c661ccbe1f59ea5afd3a6e56df341f4318570e1985a842"}
    pub fn guard(&self,p:&SignedPackage)->Result<()>{let bad=|code|Failure::new(Stage::Compatibility,code);
        if p.manifest.exercise!=2026||p.registry.exercise!=2026{return Err(bad("EXERCISE_NOT_AUTHORIZED"));}
        if p.manifest.parameter_schema_id!="embedded-registry-2026-v1"||p.manifest.required_rule_profile_id!="mx-standard-2026-contextual-v2"||p.manifest.required_contextual_policy_id!="standard-isr-withholding-2026-independent-context-v2"||p.conventions.id!="standard-estimate-2026-v1"{return Err(bad("REQUIRES_APPLICATION_UPDATE"));}Ok(())
    }
    pub fn assess(&self,p:&SignedPackage,operation:Capability)->Result<Compatibility>{self.guard(p)?;
        if p.conventions.nature!="simulation-convention"||p.conventions.activation!="not-activated"||p.conventions.result_classification!="estimated"||p.conventions.reference_cotized_days!=(Periods{weekly:"7".into(),fortnightly:"15".into(),monthly:"30".into()})
            ||p.conventions.monthly_income_reference_days!="30"||p.conventions.temporal_scope!="effective-date-snapshot"||p.conventions.interval_inference!="no-calendar-interval-inferred"||p.conventions.subsidy_estimation!="explicit-estimation-preference-recorded"
            ||p.conventions.monthly_accumulation!="not-simulated"||p.conventions.geography!="general-zone"||p.conventions.benefit_seniority!="declared-entitlement-not-inferred"||p.conventions.fiscal_rounding_approval!="pending-operation-validation"||p.conventions.sua_equivalence!="not-validated"
            ||p.registry.contractual_divisors.iter().any(|s|s.data!=p.conventions.reference_cotized_days){return Err(Failure::new(Stage::Compatibility,"CONVENTION_CHANGE_REQUIRES_PROGRAM"));}
        if (operation==Capability::Inverse||p.manifest.required_capabilities.contains(&Capability::Inverse))&&!self.inverse{return Err(Failure::new(Stage::Compatibility,"INVERSE_NOT_AUTHORIZED"));}
        Ok(Compatibility{rule_profile:p.manifest.required_rule_profile_id.clone(),direct_available:true,inverse_available:self.inverse,content_matches_integrated_pin:p.manifest.package_id=="mx-fiscal-2026-source-v3"&&p.manifest.parameter_version=="mx-fiscal-2026-source-v3"&&p.manifest.content_identity.scheme=="legacy-registry-v1"&&p.manifest.content_identity.sha256=="7e9f13084e64633b29959d79eec5f9c02333fe2695809c662d71fa7fc8393ab0",dynamic_admission_enabled:false,inverse_certificate:"not-granted-by-package; existing runtime preconditions remain required"})
    }
}
