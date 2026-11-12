import { FISCAL_PARAMETERS_2026 } from "../../infrastructure/fiscal/2026"
import { FISCAL_SOURCES } from "../../infrastructure/fiscal/sources"
import { STANDARD_CONVENTIONS } from "../../domain/payroll/simulation-conventions"
import { STANDARD_INTEGRATION_RULES } from "../../domain/payroll/salary-integration"
import { STANDARD_WORKER_IMSS_POLICY } from "../../domain/payroll/worker-imss"
import { DECIMAL_POLICY, divideDecimals, multiplyDecimals, presentMoney } from "../../domain/payroll/money"
import type { FiscalSource, ImssBranch } from "../../domain/payroll/contracts"
import sourceReview from "./source-review.json"

export type CatalogSource = FiscalSource
type DeepReadonly<T> = T extends string | number | boolean | null | undefined ? T : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T
function immutable<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(immutable)
    Object.freeze(value)
  }
  return value as DeepReadonly<T>
}
const branchDescriptions: Record<ImssBranch, { label: string; legalReference: string }> = {
  "pensioner-medical": { label: "Gastos médicos de pensionados", legalReference: "LSS, artículo 25" },
  "cash-benefits": { label: "Prestaciones en dinero", legalReference: "LSS, artículo 107" },
  "disability-life": { label: "Invalidez y vida", legalReference: "LSS, artículo 147" },
  "unemployment-old-age": { label: "Cesantía y vejez", legalReference: "LSS, artículo 168" },
  "excess-medical": { label: "Enfermedades y maternidad: excedente", legalReference: "LSS, artículo 106 y transitorio XIX" },
}

/** Puerta de lectura autorizada para Parámetros. No invoca motores, no acepta
 * modificaciones y no conoce captura, controlador, fecha de sesión ni resultados.
 * Los derivados explicativos usan la aritmética exacta existente, no tablas nuevas. */
function buildCatalog() {
  const registry = FISCAL_PARAMETERS_2026
  const divisors = registry.contractualDivisors[0].data
  const imss = registry.imssConstants[0].data
  return immutable({
    exercise: registry.exercise, packageVersion: registry.version, supportedDates: registry.supportedDates,
    isrTariffs: registry.isrTariffs,
    uma: registry.uma.map(parameters => ({ parameters,
      applicationFrom: parameters.effectiveFrom < registry.supportedDates.from ? registry.supportedDates.from : parameters.effectiveFrom,
      applicationThrough: parameters.effectiveThrough ?? registry.supportedDates.through,
      excessThreshold: presentMoney(multiplyDecimals(parameters.data.daily, imss.excessThresholdUmaDailyMultiple).value).amount,
      sbcCeiling: presentMoney(multiplyDecimals(parameters.data.daily, imss.sbcCeilingUmaDailyMultiple).value).amount,
    })),
    minimumWages: registry.minimumWages.map(parameters => ({ parameters,
      simulatedMonthlyGeneral: presentMoney(multiplyDecimals(parameters.data.general.daily, divisors.monthly).value).amount,
      simulatedMonthlyDays: divisors.monthly,
    })),
    subsidy: registry.subsidy.map(parameters => {
      const uma = registry.uma.find(set => set.data.valueYear === parameters.data.umaMonthlyValueYear)
      if (!uma) throw new Error("Falta la UMA de referencia del subsidio en el repositorio.")
      const quota = presentMoney(multiplyDecimals(uma.data.monthly, parameters.data.rateProportion).value)
      return { parameters, uma,
        ratePercent: multiplyDecimals(parameters.data.rateProportion, "100").value,
        monthlyQuota: quota,
        periodQuotas: (["weekly", "fortnightly"] as const).map(period => ({ period, days: divisors[period],
          amount: presentMoney(divideDecimals(multiplyDecimals(quota.raw, divisors[period]).value, parameters.data.submonthlyDivisor).value).amount,
        })),
      }
    }),
    imss: registry.imssConstants.map(parameters => ({ parameters,
      branches: (Object.keys(parameters.data.workerRates) as ImssBranch[]).map(id => ({ id, ...branchDescriptions[id],
        rateProportion: parameters.data.workerRates[id],
        ratePercent: multiplyDecimals(parameters.data.workerRates[id], "100").value,
        baseReference: parameters.data.baseReferences[id],
      })),
    })),
    benefits: registry.laborBenefitMinima, contractualDivisors: registry.contractualDivisors,
    conventions: STANDARD_CONVENTIONS, integrationRules: STANDARD_INTEGRATION_RULES,
    imssPolicy: STANDARD_WORKER_IMSS_POLICY, precision: DECIMAL_POLICY,
    supportingSources: { subsidyRules: FISCAL_SOURCES.subsidyRetainedRules,
      retention: FISCAL_SOURCES.isrMinimumWithholding, lss: FISCAL_SOURCES.lss,
      deindexation: FISCAL_SOURCES.umaConstitution, labor: FISCAL_SOURCES.laborBenefits },
    sourceReview,
  })
}
export type ParameterCatalog = ReturnType<typeof buildCatalog>
let catalog: ParameterCatalog | undefined
export function getParameterCatalog2026(): ParameterCatalog { return catalog ??= buildCatalog() }

export function findCatalogSourceReview(url: string) {
  return getParameterCatalog2026().sourceReview.records.find(record => record.url === url)
}
