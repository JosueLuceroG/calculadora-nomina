import { useEffect, useState } from "react"
import { ExternalLink, BookOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatMxn } from "../calculator/format"
import { initialBenefits } from "../calculator/form"
import { findCatalogSourceReview, getParameterCatalog2026, type CatalogSource, type ParameterCatalog } from "./parameter-catalog"
import { nativeOfficialSourceOpener } from "./official-source-link"
import { FiscalAdministrationSummary } from './fiscal-administration'

export const parameterCategories = [
  { id: "isr", label: "Tarifas ISR" }, { id: "uma", label: "UMA" },
  { id: "minimum", label: "Salarios mínimos" }, { id: "subsidy", label: "Subsidio al empleo" },
  { id: "imss", label: "Cuotas IMSS" }, { id: "benefits", label: "Prestaciones" },
  { id: "policies", label: "Criterios del simulador" },
] as const
export type ParameterCategory = typeof parameterCategories[number]["id"]
export type ParameterNavigationTarget = Readonly<{ category: ParameterCategory; token: number }>
const periods = [{ id: "weekly", label: "Semanal" }, { id: "fortnightly", label: "Quincenal" }, { id: "monthly", label: "Mensual" }] as const
const date = (value: string) => value.split("-").reverse().join("/")

function Sources({ sources }: { sources: readonly CatalogSource[] }) {
  const [openingError, setOpeningError] = useState<string | null>(null)
  const unique = sources.filter((source, i) => sources.findIndex(other => other.url === source.url && other.locator === source.locator) === i)
  return <details className="parameter-sources">
    <summary>Fuentes oficiales y verificación ({unique.length})</summary>
    <ul>{unique.map(source => {
      const review = findCatalogSourceReview(source.url)
      return <li key={`${source.url}-${source.locator}`}>
        <strong>{source.authority} · {source.document}</strong>
        <p>{source.locator}</p>
        <p>Publicación: {date(source.publicationDate)}{source.currentTextAsOf && ` · Texto revisado con reforma al ${date(source.currentTextAsOf)}`}</p>
        <p>Verificación del paquete: {date(source.verifiedOn)} · {review?.status === "verified" ? `Enlace y documento cotejados: ${date(review.queriedOn.slice(0, 10))} (mismo original de 4B.1)` : "Consulta actual pendiente de verificación"}</p>
        <a href={source.url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${source.document} (${source.authority}) en otra ventana`} data-official-source={source.url} onClick={async event => {
          const open = nativeOfficialSourceOpener()
          if (!open) return
          event.preventDefault()
          setOpeningError(null)
          try { await open(source.url) } catch { setOpeningError(source.url) }
        }}>Abrir documento oficial <ExternalLink size={14} aria-hidden="true" /></a>
        {openingError === source.url && <p role="alert">No se pudo abrir el documento en el navegador predeterminado.</p>}
      </li>
    })}</ul>
  </details>
}
function Scope({ from, through }: { from: string; through: string | null }) {
  const until = through ?? getParameterCatalog2026().supportedDates.through
  return <p className="parameter-validity">Aplicación en el paquete: <time dateTime={from}>{date(from)}</time> a <time dateTime={until}>{date(until)}</time>.</p>
}
function DataKind({ policy = false }: { policy?: boolean }) {
  return <span className={`parameter-kind${policy ? " parameter-kind-policy" : ""}`}>{policy ? "Criterio de la simulación" : "Datos normativos del repositorio"}</span>
}

function Isr({ catalog }: { catalog: ParameterCatalog }) {
  const [period, setPeriod] = useState<typeof periods[number]["id"]>("monthly")
  const tariff = catalog.isrTariffs.find(set => set.data.periodicity === period)!
  const label = periods.find(item => item.id === period)!.label
  return <>
    <DataKind /><p>Tarifas completas del Anexo 8 de la RMF 2026. Importes en MXN; porcentaje sobre el excedente del límite inferior.</p>
    <div className="parameter-periods" role="group" aria-label="Periodicidad de la tarifa ISR">{periods.map(item => <Button key={item.id} type="button" variant="outline" aria-pressed={period === item.id} aria-controls="isr-tariff-table" onClick={() => setPeriod(item.id)}>{item.label}</Button>)}</div>
    <Scope from={tariff.effectiveFrom} through={tariff.effectiveThrough} />
    <IsrTariffTable tariff={tariff} label={label} />
    <Sources sources={tariff.sources} />
  </>
}
export function IsrTariffTable({ tariff, label }: { tariff: ParameterCatalog["isrTariffs"][number]; label: string }) {
  return <table id="isr-tariff-table" className="parameter-table" data-parameter-id={tariff.id}>
    <caption>ISR 2026 · {label} · {tariff.data.rows.length} tramos · MXN</caption>
    <thead><tr><th scope="col">Límite inferior</th><th scope="col">Límite superior</th><th scope="col">Cuota fija</th><th scope="col">Porcentaje sobre excedente</th></tr></thead>
    <tbody>{tariff.data.rows.map((row, i) => <tr key={row.lower} data-isr-row={i + 1}>
      <td>{formatMxn(row.lower)}</td><td>{row.upper === null ? "En adelante" : formatMxn(row.upper)}</td><td>{formatMxn(row.fixedFee)}</td><td>{row.ratePercent}%</td>
    </tr>)}</tbody>
  </table>
}
function Uma({ catalog }: { catalog: ParameterCatalog }) {
  return <><DataKind /><p>Enero utiliza la UMA de vigencia anterior; la UMA 2026 entra en vigor el 1 de febrero. No se aplica una sola UMA a todo el ejercicio.</p>
    {catalog.uma.map(item => <section className="parameter-dataset" key={item.parameters.id} data-parameter-id={item.parameters.id}>
      <h4>UMA {item.parameters.data.valueYear} · {item.parameters.data.valueYear < catalog.exercise ? "enero de 2026" : "febrero a diciembre de 2026"}</h4>
      <Scope from={item.applicationFrom} through={item.applicationThrough} />
      <p>Entrada en vigor original: {date(item.parameters.effectiveFrom)}.</p>
      <table className="parameter-table"><caption>Valores de UMA · MXN</caption><thead><tr><th scope="col">Diaria</th><th scope="col">Mensual</th><th scope="col">Anual</th></tr></thead><tbody><tr>
        <td>{formatMxn(item.parameters.data.daily)}</td><td>{formatMxn(item.parameters.data.monthly)}</td><td>{formatMxn(item.parameters.data.annual)}</td>
      </tr></tbody></table><Sources sources={item.parameters.sources} />
    </section>)}
  </>
}
function Minimum({ catalog }: { catalog: ParameterCatalog }) {
  return <><DataKind />{catalog.minimumWages.map(item => <section key={item.parameters.id} data-parameter-id={item.parameters.id}>
    <Scope from={item.parameters.effectiveFrom} through={item.parameters.effectiveThrough} />
    <table className="parameter-table"><caption>Referencias de salario mínimo 2026 · MXN</caption><thead><tr><th scope="col">Zona</th><th scope="col">Diario oficial</th><th scope="col">Mes del perfil ({item.simulatedMonthlyDays} días)</th><th scope="col">Mes publicado por CONASAMI</th></tr></thead><tbody>
      <tr><th scope="row">General</th><td>{formatMxn(item.parameters.data.general.daily)}</td><td>{formatMxn(item.simulatedMonthlyGeneral)}</td><td>{formatMxn(item.parameters.data.general.publishedMonthlyReference)}</td></tr>
      <tr><th scope="row">ZLFN · informativa</th><td>{formatMxn(item.parameters.data.northernBorder.daily)}</td><td>No se utiliza</td><td>{formatMxn(item.parameters.data.northernBorder.publishedMonthlyReference)}</td></tr>
    </tbody></table>
    <p><strong>Esta versión solo realiza cálculos para la zona salarial general.</strong></p>
    <p>El mes del perfil es el diario general multiplicado por {item.simulatedMonthlyDays}. La expresión mensual publicada por CONASAMI utiliza el diario por 365 entre 12. Son referencias distintas, no cantidades intercambiables.</p>
    <div className="parameter-review-note" role="note"><strong>Alcance contextual · hallazgo 4B.1</strong><p>Las referencias se conservan separadas. La política v2 decide según la base declarada y el contexto del artículo 96, no solo según el importe o la igualdad IMSS. Si falta información compatible, la retención y el neto no se determinan. La región de análisis no es un piso legal. La nómina mensual real no se reconstruye.</p></div>
    <Sources sources={[...item.parameters.sources, catalog.supportingSources.retention]} />
  </section>)}</>
}
function Subsidy({ catalog }: { catalog: ParameterCatalog }) {
  return <><DataKind /><p>La cuota se obtiene de la UMA mensual vigente por el porcentaje del decreto. El límite se compara con la referencia mensual del perfil, no con acumulados reales comprobados.</p>
    {catalog.subsidy.map(item => <section className="parameter-dataset" key={item.parameters.id} data-parameter-id={item.parameters.id}>
      <h4>{item.parameters.effectiveFrom.endsWith("01-01") ? "Enero de 2026" : "Febrero a diciembre de 2026"}</h4>
      <Scope from={item.parameters.effectiveFrom} through={item.parameters.effectiveThrough} />
      <dl className="parameter-facts">
        <div><dt>Límite de ingreso mensual</dt><dd>{formatMxn(item.parameters.data.monthlyIncomeLimit)}</dd></div>
        <div><dt>Porcentaje vigente</dt><dd>{item.ratePercent}%</dd></div>
        <div><dt>UMA mensual de referencia ({item.uma.data.valueYear})</dt><dd>{formatMxn(item.uma.data.monthly)}</dd></div>
        <div><dt>Cuota mensual derivada, a centavos</dt><dd>{formatMxn(item.monthlyQuota.amount)}</dd></div>
      </dl>
      <p>Fórmula operativa: {item.parameters.data.formulaText}. Antes del redondeo: <strong>{item.monthlyQuota.raw} MXN</strong>.</p>
      <DataKind policy /><p>Para un periodo menor al mes: cuota mensual sin redondear ÷ {item.parameters.data.submonthlyDivisor} × días del periodo. Se respeta el máximo mensual. Días de referencia del perfil: {item.periodQuotas.map(q => `${q.period === "weekly" ? "semanal" : "quincenal"} ${q.days}`).join("; ")}.</p>
      <table className="parameter-table"><caption>Cuotas derivadas para los periodos estándar · antes de aplicar elegibilidad</caption><thead><tr><th scope="col">Semanal</th><th scope="col">Quincenal</th><th scope="col">Mensual</th></tr></thead><tbody><tr>{item.periodQuotas.map(q => <td key={q.period}>{formatMxn(q.amount)}</td>)}<td>{formatMxn(item.monthlyQuota.amount)}</td></tr></tbody></table>
      <Sources sources={[...item.parameters.sources, catalog.supportingSources.subsidyRules]} />
    </section>)}
    <p><strong>Determinado no significa aplicado.</strong> El subsidio determinado depende de la elegibilidad; el aplicado reduce el ISR cuando corresponde. El excedente no se entrega en efectivo ni vuelve a sumarse al neto. Una no retención condicionada puede conservar subsidio determinado y aplicación cero.</p>
    <p>El considerando del decreto menciona $ 536.22 como cifra explicativa. No sustituye los porcentajes ni los resultados de la fórmula operativa mostrados arriba.</p>
  </>
}
function Imss({ catalog }: { catalog: ParameterCatalog }) {
  return <><DataKind />{catalog.imss.map(item => <section key={item.parameters.id} data-parameter-id={item.parameters.id}>
    <Scope from={item.parameters.effectiveFrom} through={item.parameters.effectiveThrough} />
    <table className="parameter-table"><caption>Cinco tasas obreras IMSS del simulador</caption><thead><tr><th scope="col">Ramo</th><th scope="col">Tasa obrera</th><th scope="col">Base de cálculo</th><th scope="col">Referencia legal</th></tr></thead><tbody>{item.branches.map(branch => <tr key={branch.id} data-imss-branch={branch.id}>
      <th scope="row">{branch.label}</th><td>{branch.ratePercent}%</td><td>{branch.baseReference === "sbc" ? "SBC estimado" : `SBC que excede de ${item.parameters.data.excessThresholdUmaDailyMultiple} UMA`}</td><td>{branch.legalReference}</td>
    </tr>)}</tbody></table>
    <p>Umbral del excedente: <strong>{item.parameters.data.excessThresholdUmaDailyMultiple} UMA diarias</strong>. Límite superior de referencia del SBC: <strong>{item.parameters.data.sbcCeilingUmaDailyMultiple} UMA diarias</strong> (artículo 28 y desindexación).</p>
    <table className="parameter-table"><caption>Referencias derivadas de UMA · MXN diarios</caption><thead><tr><th scope="col">UMA de referencia</th><th scope="col">Umbral {item.parameters.data.excessThresholdUmaDailyMultiple} UMA</th><th scope="col">Tope {item.parameters.data.sbcCeilingUmaDailyMultiple} UMA</th></tr></thead><tbody>{catalog.uma.map(uma => <tr key={uma.parameters.id}><th scope="row">UMA {uma.parameters.data.valueYear}</th><td>{formatMxn(uma.excessThreshold)}</td><td>{formatMxn(uma.sbcCeiling)}</td></tr>)}</tbody></table>
    <DataKind policy /><p>La cuota calculada se distingue de la realmente descontada y de la absorbida por el patrón cuando aplica el artículo 36. Desactivar el descuento IMSS solo lo excluye de esta simulación; no es una exención legal y no sustituye la absorción legal.</p>
    <p>El SBC es <strong>estimado, no registrado ante el IMSS</strong>. Los días reales de cotización, movimientos y liquidaciones no se determinan. El redondeo por ramo del perfil no acredita equivalencia con SUA.</p>
    <Sources sources={item.parameters.sources} />
  </section>)}</>
}
function Benefits({ catalog }: { catalog: ParameterCatalog }) {
  return <><DataKind />{catalog.benefits.map(item => <section key={item.id} data-parameter-id={item.id}>
    <Scope from={item.effectiveFrom} through={item.effectiveThrough} />
    <table className="parameter-table"><caption>Referencias laborales de prestaciones anuales</caption><thead><tr><th scope="col">Prestación</th><th scope="col">Referencia</th><th scope="col">LFT</th></tr></thead><tbody>
      <tr><th scope="row">Aguinaldo</th><td>{item.data.annualBonusDays} días anuales</td><td>Artículo 87</td></tr>
      <tr><th scope="row">Vacaciones</th><td>{item.data.firstAnnualVacationDays} días: primer derecho anual, según antigüedad</td><td>Artículo 76</td></tr>
      <tr><th scope="row">Prima vacacional</th><td>{item.data.vacationPremiumPercent}% como referencia mínima</td><td>Artículo 80</td></tr>
    </tbody></table>
    <p>La captura inicial de {initialBenefits.bonusDays} días de aguinaldo, {initialBenefits.vacationDays} de vacaciones y {initialBenefits.vacationPremium}% de prima es <strong>editable</strong>. Los {item.data.firstAnnualVacationDays} días no corresponden universalmente a todos los trabajadores: deben ajustarse por antigüedad y prestaciones aplicables. No se infiere antigüedad.</p>
    <DataKind policy /><h4>Factor de integración teórico</h4>
    <p>FI = 1 + (días de aguinaldo + días de vacaciones × prima / 100) / {catalog.integrationRules.annualizationDays}.</p>
    <p>Las vacaciones ordinarias ya están pagadas en el salario; solo su prima incrementa el factor. La anualización de {catalog.integrationRules.annualizationDays} días pertenece al perfil simulado. El SDI es teórico y no acredita el SBC registrado.</p>
    <Sources sources={[...item.sources, catalog.supportingSources.lss]} />
  </section>)}</>
}
function Policies({ catalog }: { catalog: ParameterCatalog }) {
  const days = catalog.contractualDivisors[0].data
  return <><DataKind policy /><p>Estas son convenciones y límites de la aplicación, separados de los datos normativos. No son una homologación con CONTPAQi Nóminas ni SUA.</p>
    <dl className="parameter-policy-list">
      <div><dt>Periodos estándar</dt><dd>Semanal {days.weekly}, quincenal {days.fortnightly}, mensual {days.monthly} días. No se infieren calendario, incidencias ni días reales de cotización.</dd></div>
      <div><dt>Integración y SBC</dt><dd>Prestaciones declaradas, anualización teórica de {catalog.integrationRules.annualizationDays} días y límites de SBC estimados. No se infieren antigüedad ni percepciones variables.</dd></div>
      <div><dt>Redondeos</dt><dd>Precisión interna de {catalog.precision.significantDigits} dígitos. Presentación monetaria a {catalog.precision.moneyDecimals} decimales; IMSS redondeado por ramo antes de sumar, según la política del perfil. No se acredita el mismo resultado que SUA.</dd></div>
      <div><dt>Descuento IMSS</dt><dd>Cuota calculada, descontada, absorbida y excluida se conservan separadas. IMSS No es una exclusión simulada del descuento, no una exención legal.</dd></div>
      <div><dt>Bruto a Neto</dt><dd>Salario ordinario fijo completamente gravado y prestaciones explícitas. No determina una nómina real ni conciliación mensual.</dd></div>
      <div><dt>Neto a Bruto</dt><dd>Busca candidatos verificados con el mismo motor directo. Exactitud, mínimo y cobertura se afirman solo con la evidencia del reporte y dentro de su dominio; puede haber aproximaciones o búsqueda limitada.</dd></div>
      <div><dt>Fuera de alcance</dt><dd>Incidencias, faltas, incapacidades, ingresos variables o exentos, movimientos, acumulados, otros pagos, varios patrones y calendario real no se reconstruyen. El contexto mensual del artículo 96 no se comprueba automáticamente.</dd></div>
    </dl>
    <p>Perfil: <code>{catalog.conventions.id}</code>. Integración: <code>{catalog.integrationRules.id}</code>. IMSS: <code>{catalog.imssPolicy.id}</code>. Paquete: <code>{catalog.packageVersion}</code>.</p>
    <Sources sources={[catalog.supportingSources.lss, catalog.supportingSources.retention, catalog.supportingSources.labor, catalog.supportingSources.subsidyRules]} />
  </>
}

export function ParameterContent({ category, catalog }: { category: ParameterCategory; catalog: ParameterCatalog }) {
  const title = parameterCategories.find(item => item.id === category)!.label
  return <section id="parameter-category-panel" aria-labelledby="parameter-category-title" data-category={category}>
    <h3 id="parameter-category-title" tabIndex={-1}>{title}</h3>
    {category === "isr" ? <Isr catalog={catalog} /> : category === "uma" ? <Uma catalog={catalog} /> : category === "minimum" ? <Minimum catalog={catalog} /> : category === "subsidy" ? <Subsidy catalog={catalog} /> : category === "imss" ? <Imss catalog={catalog} /> : category === "benefits" ? <Benefits catalog={catalog} /> : <Policies catalog={catalog} />}
  </section>
}

export function ParameterSection({ referenceDate, simulationPackage, navigationTarget }: { referenceDate: string; simulationPackage: string | null; navigationTarget?: ParameterNavigationTarget }) {
  const [category, setCategory] = useState<ParameterCategory>(navigationTarget?.category ?? "isr")
  const catalog = getParameterCatalog2026()
  useEffect(() => {
    if (!navigationTarget) return
    setCategory(navigationTarget.category)
    requestAnimationFrame(() => {
      document.getElementById("parameter-category-title")?.focus({ preventScroll: true })
      window.scrollTo(0, 0)
    })
  }, [navigationTarget])
  return <section className="surface parameters-section" aria-labelledby="parameters-title" data-package-id={catalog.packageVersion}>
    <header className="parameters-header"><div><h2 id="parameters-title" tabIndex={-1}><BookOpen size={23} aria-hidden="true" />Parámetros</h2><p>Ejercicio {catalog.exercise} · Catálogo integrado · Consulta de solo lectura</p></div><span className="parameter-exercise">{catalog.exercise}</span></header>
    <FiscalAdministrationSummary catalog={catalog} />
    <div className="parameter-context" role="note"><p>Catálogo independiente del cálculo: paquete <strong>{catalog.packageVersion}</strong>, cobertura {date(catalog.supportedDates.from)} a {date(catalog.supportedDates.through)}.</p>
      <p>Fecha fiscal de tu captura: <strong>{referenceDate ? date(referenceDate) : "sin seleccionar"}</strong>. Paquete de la simulación: {simulationPackage ?? "aún no determinado"}. Consultar esta sección no cambia esos datos ni recalcula.</p>
      {referenceDate && (referenceDate < catalog.supportedDates.from || referenceDate > catalog.supportedDates.through) && <p><strong>La fecha de tu captura está fuera de la cobertura de este catálogo 2026.</strong></p>}
    </div>
    <div className="parameter-categories" role="group" aria-label="Categorías de parámetros">{parameterCategories.map(item => <Button key={item.id} type="button" variant="outline" aria-pressed={category === item.id} aria-controls="parameter-category-panel" onClick={() => setCategory(item.id)}>{item.label}</Button>)}</div>
    <ParameterContent category={category} catalog={catalog} />
    <p className="parameter-coverage-note">Las vigencias de aplicación se muestran dentro de la cobertura del paquete 2026; su fecha final de cobertura no afirma la derogación de una disposición oficial. Consulta local disponible sin internet; los documentos externos solo se abren al elegir su enlace.</p>
  </section>
}
