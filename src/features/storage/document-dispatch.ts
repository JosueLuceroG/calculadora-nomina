import historical from "../documents/document-producer-v3.json"
import compat from "../documents/document-producer-compat-v1.json"

export type DocumentaryRoute = "historical-v3" | "compat-v1"
/** The new identities are reserved for envelope3; never treat them as v1/v2. */
export function assertCompatEnvelopeVersion(value: unknown): void {
  if (!value || typeof value !== "object" || !("executionProvenance" in value)) return
  const p = value.executionProvenance
  if (!p || typeof p !== "object") return
  const reserved = ("producerId" in p && p.producerId === compat.producerId)
    || ("reportContractId" in p && p.reportContractId === compat.reportContractId)
    || ("presentationContractId" in p && p.presentationContractId === compat.presentationContractId)
  if (reserved && (!("schemaVersion" in value) || value.schemaVersion !== 3)) throw new Error("INCOMPATIBLE_DOCUMENT_CONTRACT")
}
/** Called only after the existing byte/token/codec preflight. No fallback. */
export function documentaryRoute(value: unknown): DocumentaryRoute {
  if (!value || typeof value !== "object" || !("schemaVersion" in value) || value.schemaVersion !== 3
    || !("executionProvenance" in value)) throw new Error("INCOMPATIBLE_DOCUMENT_CONTRACT")
  const p = value.executionProvenance
  if (!p || typeof p !== "object" || !("schemaVersion" in p) || p.schemaVersion !== 1
    || !("producerId" in p) || !("reportContractId" in p) || !("presentationContractId" in p)) throw new Error("INCOMPATIBLE_DOCUMENT_CONTRACT")
  for (const [descriptor, route] of [[historical, "historical-v3"], [compat, "compat-v1"]] as const) {
    if (p.producerId === descriptor.producerId && p.reportContractId === descriptor.reportContractId
      && p.presentationContractId === descriptor.presentationContractId) return route
  }
  throw new Error("INCOMPATIBLE_DOCUMENT_CONTRACT")
}
