import { assertDocumentOutcome } from "../documents/presentation-v1"
import { formatMxn } from "../calculator/format"
import { LocalStorageFailure } from "../storage/storage-api"
import type { StoredFiscalSnapshot } from "../storage/snapshot"
import {assertSnapshotV3} from '../documents/provenance-v3'
import {isCompatDocument} from '../documents/presentation-document-compat'
import {assertCompatSnapshot} from '../documents/provenance-compat-v1'

/** Valida fidelidad de presentación, no impuestos: utiliza los proyectores ya
 * existentes y compara, sin sustituir valores ni consultar parámetros actuales. */
export function assertHistoricalPresentation(snapshot: StoredFiscalSnapshot): StoredFiscalSnapshot {
  try {
    if(snapshot.schemaVersion===3){if(isCompatDocument(snapshot))assertCompatSnapshot(snapshot);else assertSnapshotV3(snapshot)}
    const { report } = snapshot.outcome
    const mode=snapshot.capture.form.mode
    if (report.operation!==mode) throw new Error("direction")
    assertDocumentOutcome(snapshot.outcome,snapshot.capture.form.effectiveDate)
    if(report.operation==="gross-to-net" && formatMxn(snapshot.capture.form.amount)!==formatMxn(report.gross.amount)) throw new Error("request")
    if(report.operation==="net-to-gross" && formatMxn(snapshot.capture.form.amount)!==formatMxn(report.targetNet)) throw new Error("request")
    return snapshot
  } catch {
    throw new LocalStorageFailure("INCOMPATIBLE_SCHEMA","Este registro no puede presentarse fielmente con esta versión. Se conserva sin recalcular ni modificar.")
  }
}
