import type {StandardGrossToNetContext} from '../../domain/payroll/gross-to-net-contracts'
import type {FiscalRegistry} from '../../domain/payroll/contracts'
import type {FiscalExecutionApi,PreparedExecution,Material} from '../../features/calculator/fiscal-execution-api'
import {hashObject} from '../../features/documents/evidence-v3'
const immutable=<T>(v:T):T=>{if(v&&typeof v==='object'){Object.values(v).forEach(immutable);Object.freeze(v)}return v}
/** Data-only bridge. Construction acquires the exact owned native reference;
 * no public from-JSON constructor, embedded fallback or executable formula. */
export async function createExternalFiscalProvider(api:FiscalExecutionApi,execution:PreparedExecution){
 const material:Material=await api.material(execution),s=material.packageEnvelope.signed,r=s.registry as FiscalRegistry,c=material.context
 const context:StandardGrossToNetContext=immutable(structuredClone({fiscalPackageVersion:r.version,exercise:r.exercise,supportedDates:r.supportedDates,contractualDivisors:r.contractualDivisors,laborBenefitMinima:r.laborBenefitMinima,uma:r.uma,minimumWages:r.minimumWages,imssConstants:r.imssConstants,isrTariffs:r.isrTariffs,subsidy:r.subsidy,subsidyRulesSources:s.ruleSources.subsidy,retentionRuleSources:s.ruleSources.retention}))
 if(context.fiscalPackageVersion!==c.parameterVersion||context.exercise!==2026||c.effectiveSets.length!==7||new Set(c.effectiveSets.map(x=>x.role)).size!==7)throw Error('EXTERNAL_PROVIDER_CONTEXT_MISMATCH')
 const families={isrTariff:'isrTariffs',uma:'uma',minimumWages:'minimumWages',subsidy:'subsidy',imssConstants:'imssConstants',contractualDivisors:'contractualDivisors',laborBenefitMinima:'laborBenefitMinima'} as const
 type SeriesItem={id:string;version:string;effectiveFrom:string;effectiveThrough:string|null;data:{periodicity?:string}}
 for(const ref of c.effectiveSets){if(families[ref.role as keyof typeof families]!==ref.family)throw Error('EXTERNAL_PROVIDER_SET_MISMATCH');const family=(r as unknown as Record<string,SeriesItem[]|undefined>)[ref.family];if(!family||family.filter(x=>x.id===ref.id&&x.version===ref.version&&x.effectiveFrom<=c.fiscalDate&&(x.effectiveThrough===null||x.effectiveThrough>=c.fiscalDate)&&(ref.role!=='isrTariff'||x.data.periodicity===c.periodicity)).length!==1)throw Error('EXTERNAL_PROVIDER_SET_MISMATCH')}
 return Object.freeze({material,context,contextSha256:hashObject(c),execution})
}
