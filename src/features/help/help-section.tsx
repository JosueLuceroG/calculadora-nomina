import { ArrowRight, CircleHelp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatMxn } from "../calculator/format"
import { parameterCategories, type ParameterCategory } from "../parameters/parameter-section"
import examples from "./verified-examples.json"
import { getHelpTopics, inverseHelpStates } from "./help-topics"
import { FiscalUpdateNotice } from '../parameters/fiscal-administration'

function ParameterLink({ category, onOpen }: { category: ParameterCategory; onOpen: (category: ParameterCategory) => void }) {
  const label = category === "benefits" ? "referencias LFT y prestaciones" : parameterCategories.find(item => item.id === category)!.label
  return <Button type="button" variant="outline" data-help-parameter={category} onClick={() => onOpen(category)} aria-label={`Consultar ${label} en Parámetros`}>Ver {label}<ArrowRight size={15} aria-hidden="true" /></Button>
}

export function HelpExample() {
  const example = examples.direct
  const input = example.request
  const value = example.values
  return <details className="help-example" open>
    <summary>Ejemplo verificado · Bruto a Neto</summary>
    <div className="help-example-body" data-help-fixture={example.fixtureId}>
      <p>Ejemplo fijo de control del proyecto. No utiliza ni cambia los datos de tu simulación.</p>
      <dl className="help-example-inputs">
        <div><dt>Fecha fiscal</dt><dd>{input.date.split("-").reverse().join("/")}</dd></div>
        <div><dt>Zona / periodo</dt><dd>General · Mensual</dd></div>
        <div><dt>Aguinaldo / vacaciones</dt><dd>{input.benefits.annualBonusDays} / {input.benefits.annualVacationDays} días</dd></div>
        <div><dt>Prima / IMSS</dt><dd>{input.benefits.vacationPremiumPercent}% · {input.includeImss ? "Sí" : "No"}</dd></div>
      </dl>
      <div className="help-example-grid">
        <dl className="help-example-amounts" aria-label="Importes del ejemplo verificado">
          <div><dt>Bruto</dt><dd>{formatMxn(value.gross)}</dd></div>
          <div><dt>ISR retenido</dt><dd>{formatMxn(value.isrWithheld)}</dd></div>
          <div><dt>IMSS descontado</dt><dd>{formatMxn(value.imssDeducted)}</dd></div>
          <div className="help-example-net"><dt>Neto estimado</dt><dd>{formatMxn(value.net)}</dd></div>
        </dl>
        <ol className="help-example-steps" aria-label="Resta final paso a paso">
          <li><strong>Primero, el ISR:</strong> {formatMxn(value.gross)} − {formatMxn(value.isrWithheld)} = <strong>{formatMxn(example.afterIsr)}</strong>.</li>
          <li><strong>Después, el IMSS:</strong> {formatMxn(example.afterIsr)} − {formatMxn(value.imssDeducted)} = <strong>{formatMxn(value.net)}</strong>.</li>
        </ol>
      </div>
      <p>En este caso, ISR por tarifa: <strong>{formatMxn(value.isrTariff)}</strong>; subsidio aplicado: <strong>{formatMxn(value.subsidyApplied)}</strong>. El ISR retenido ya incorpora el subsidio que corresponda: <strong>no se suma el subsidio otra vez al neto</strong>.</p>
      <p className="help-example-provenance">Importes de los casos de control verificados del proyecto (4B.1). Se muestran valores de referencia, no se ejecuta otro cálculo fiscal.</p>
    </div>
  </details>
}

function InverseExample() {
  const example = examples.inverse
  return <aside className="help-inverse-example" aria-label="Ejemplo semanal de alternativas" data-help-fixture={example.fixtureId}>
    <h4>Un mismo neto, dos brutos verificados</h4>
    <p>Con fecha 01/02/2026, prestaciones 15/12/25, zona General e IMSS Sí, el neto semanal solicitado es <strong>{formatMxn(example.request.targetNet)}</strong>.</p>
    <ul>{example.candidates.map(candidate => <li key={candidate.gross}>Bruto <strong>{formatMxn(candidate.gross)}</strong> → Neto <strong>{formatMxn(candidate.net)}</strong>.</li>)}</ul>
    <p>Estos candidatos del caso de control no aseguran unicidad ni cobertura global. La garantía de mínimo o de cobertura se consulta en el reporte de cada búsqueda.</p>
  </aside>
}

export function HelpSection({ onOpenParameters }: { onOpenParameters: (category: ParameterCategory) => void }) {
  const topics = getHelpTopics()
  return <section className="surface help-section" aria-labelledby="help-title">
    <header className="help-header"><h2 id="help-title" tabIndex={-1}><CircleHelp size={24} aria-hidden="true" />Ayuda</h2><p>Entiende tus importes, los conceptos y el alcance de la simulación.</p></header>
    <FiscalUpdateNotice />
    <p className="help-important-note" role="note">La política contextual v2 del hallazgo 4B.1 separa base salarial, IMSS y artículo 96. La no retención requiere percibir únicamente salario mínimo general en el mes; <strong>no hay una excepción automática de ISR</strong>. Si falta contexto, retención y neto quedan pendientes. La hipótesis compatible no acredita hechos reales.</p>
    <HelpExample />
    <div className="help-topics" aria-label="Conceptos y funcionamiento">
      {topics.map(topic => <details className="help-topic" key={topic.id} id={`help-topic-${topic.id}`}>
        <summary>{topic.title}</summary>
        <div className="help-topic-body">
          {topic.paragraphs.map(text => <p key={text}>{text}</p>)}
          {topic.formula && <p className="help-formula">{topic.formula}</p>}
          {topic.id === "inverse" && <><dl className="help-inverse-states">{inverseHelpStates.map(state => <div key={state.label}><dt>{state.label}</dt><dd>{state.text}</dd></div>)}</dl><InverseExample /></>}
          <div className="help-topic-links" aria-label={`Consultar parámetros de ${topic.title}`}>{topic.parameters.map(category => <ParameterLink key={category} category={category} onOpen={onOpenParameters} />)}</div>
        </div>
      </details>)}
    </div>
    <p className="help-footer" role="note">Guía informativa de una simulación estimada. No es un cálculo oficial certificado, CFDI, SUA ni liquidación de nómina real. Los valores y fuentes se consultan en Parámetros, sin modificar tu cálculo.</p>
  </section>
}
