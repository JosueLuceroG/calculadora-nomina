import type { FiscalOutcome, FiscalPresentation } from "../fiscal-adapter"
import type { ForwardReport } from "./result-presentation"
import { InverseSearchDetails } from "./inverse-feedback"

export function TechnicalResultDetails({ presentation, forward, report }: {
  presentation: FiscalPresentation; forward?: ForwardReport; report?: FiscalOutcome["report"]
}) {
  const inverseReport = report?.operation === "net-to-gross" && presentation.kind === "inverse" ? report : undefined
  const provenance = forward?.provenance
  return <details className="technical-result-details">
    <summary>Detalles técnicos</summary>
    <div className="technical-result-body">
      {presentation.inverse && <InverseSearchDetails inverse={presentation.inverse} />}
      {presentation.integrationFactorRaw && <p>Factor interno conservado: <span className="fiscal-raw-value">{presentation.integrationFactorRaw}</span>. La vista principal usa cuatro decimales solo para presentación.</p>}
      <p>Días equivalentes internos: {presentation.values.integratedBenefitDays ?? "no determinados"}.</p>
      {inverseReport && <>
        <p>Certificado matemático disponible: {inverseReport.provenance.certificationAvailable ? "Sí" : "No"}. {inverseReport.provenance.certificationReason}</p>
        <p>Certificados de cobertura utilizados: {[...new Set(inverseReport.coverage.evidence.flatMap(e => e.proof ? [e.proof.certificate] : []))].join(", ") || "ninguno en este examen"}.</p>
        <p>Cierres certificados: {inverseReport.metrics.certifiedClosures}. Evaluaciones directas: {inverseReport.metrics.directEvaluations}. Conclusión: {inverseReport.conclusion}.</p>
        <p>Política del inverso: {inverseReport.provenance.policyVersion}. Detención: {inverseReport.metrics.stopReason}.</p>
      </>}
      <p>Paquete fiscal: {provenance?.fiscalPackageVersion ?? inverseReport?.provenance.fiscalPackageVersion ?? "no determinado"}.</p>
      {provenance && <>
        <p>Parámetros y versiones: {provenance.parameterSetVersions.map(p => `${p.id} (${p.version})`).join("; ")}.</p>
        <p>Políticas internas: {provenance.policyVersions.map(p => `${p.component}: ${p.version}`).join("; ")}.</p>
        <p>Los redondeos de cuotas IMSS se realizan por ramo conforme a la política del perfil; no acreditan equivalencia con SUA.</p>
      </>}
      <ul aria-label="Códigos técnicos del resultado">{[...presentation.issues, ...presentation.warnings].map((item, i) => <li key={`${item.code}-${i}`}>{item.code}: {item.message}</li>)}</ul>
    </div>
  </details>
}
