import { encodeFiscalSnapshot, type HistoryClassification, type StoredFiscalSnapshot } from "./snapshot"
import {readOriginalDocument} from '../documents/original-document'
import type {CompatClassification} from '../documents/contracts-compat-v1'

export type StorageErrorCode = "UNAVAILABLE" | "CORRUPT_DATABASE" | "INCOMPATIBLE_SCHEMA" | "MIGRATION_FAILED" | "MIGRATION_COMMITTED_VERIFICATION_PENDING" | "MIGRATION_OUTCOME_UNKNOWN" | "V3_WRITE_CLOSED" | "INVALID_SNAPSHOT" | "INVALID_ARGUMENT" | "STALE_GENERATION" | "DELETED_EXECUTION" | "DUPLICATE_CONFLICT" | "CORRUPT_RECORD" | "IO_ERROR" | "BUSY" | "RECOVERY_NOT_ALLOWED" | "AUTO_SAVE_DISABLED" | "BACKUP_FAILED" | "BACKUP_CLEANUP_PENDING" | "RECOVERY_PENDING"
export class LocalStorageFailure extends Error {
  constructor(public readonly code: StorageErrorCode, message: string, public readonly retryable = false) { super(message); this.name = "LocalStorageFailure" }
}
export type LocalPreferences = Readonly<{ theme: "light" | "dark"; historyAutoSave: boolean }>
/** Política inicial: claro y auto-guardado DESACTIVADO; 5B.8 deberá ofrecer opt-in. */
export const initialLocalPreferences: LocalPreferences = Object.freeze({ theme: "light", historyAutoSave: false })
export type HistoryWriteSession = Readonly<{ generation: string }>
export type HistoryCursor = Readonly<{ completedAt: string; executionId: string; generation: string }>
export type HistoryItem = Readonly<{ executionId: string; direction: "gross-to-net" | "net-to-gross"; requestedAmount: string; periodicity: "weekly" | "fortnightly" | "monthly"; completedAt: string; referenceDate: string; classification: HistoryClassification | CompatClassification; gross: string | null; net: string | null }>
export type HistoryPage = Readonly<{ items: readonly HistoryItem[]; nextCursor: HistoryCursor | null; generation: string }>
export type StorageInfo = Readonly<{ schemaVersion: number; databasePath: string; generation: string; encrypted: false }>
type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>
const nativeInvoke: Invoke = (command, args) => {
  const runtime = (globalThis as typeof globalThis & { window?: { __TAURI_INTERNALS__?: { invoke: Invoke } } }).window?.__TAURI_INTERNALS__
  if (!runtime) return Promise.reject(new LocalStorageFailure("UNAVAILABLE", "El almacenamiento nativo requiere la aplicación Windows."))
  return runtime.invoke(command, args)
}

/** Crear el cliente no abre la base. No hay consumidor ni escrituras desde App
 * en 5B.7; los comandos se usan solo explícitamente y en verificación aislada. */
export function createNativeStorageApi(invoke: Invoke = nativeInvoke) {
  async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    try { return await invoke<T>(command, args) }
    catch (error) {
      if (error instanceof LocalStorageFailure) throw error
      const e = error as { code?: StorageErrorCode; message?: string; retryable?: boolean }
      throw new LocalStorageFailure(e?.code ?? "IO_ERROR", e?.message ?? "No se pudo completar la operación local.", e?.retryable ?? false)
    }
  }
  return Object.freeze({
    info: () => call<StorageInfo>("storage_info"),
    beginWrite: () => call<HistoryWriteSession>("storage_begin_write"),
    insert: async (session: HistoryWriteSession, snapshot: StoredFiscalSnapshot) => {
      let payload: string
      try { payload = encodeFiscalSnapshot(snapshot) } catch { throw new LocalStorageFailure("INVALID_SNAPSHOT", "El snapshot no se puede serializar de forma exacta.") }
      return call<{ executionId: string; inserted: boolean }>("storage_insert", { generation: session.generation, payload })
    },
    insertAutomatic: async (session: HistoryWriteSession, snapshot: StoredFiscalSnapshot) => {
      let payload: string
      try { payload = encodeFiscalSnapshot(snapshot) } catch { throw new LocalStorageFailure("INVALID_SNAPSHOT", "El snapshot no se puede serializar de forma exacta.") }
      return call<{ executionId: string; inserted: boolean }>("storage_insert_automatic", { generation: session.generation, payload })
    },
    list: (limit = 30, cursor: HistoryCursor | null = null) => call<HistoryPage>("storage_list", { limit, cursor }),
    get: async (executionId: string) => {
      const text = await call<string | null>("storage_get", { executionId })
      if (text === null) return null
      try { return readOriginalDocument(text,'storage-read') } catch (error) { const incompatible=error instanceof Error&&/INCOMPATIBLE|UNSUPPORTED/.test(error.message);throw new LocalStorageFailure(incompatible?"INCOMPATIBLE_SCHEMA":"CORRUPT_RECORD", "El registro no se pudo recuperar de forma exacta; se conserva sin recalcular.") }
    },
    delete: (executionId: string) => call<{ deleted: boolean }>("storage_delete", { executionId }),
    clear: () => call<HistoryWriteSession>("storage_clear"),
    getPreferences: () => call<LocalPreferences>("storage_get_preferences"),
    setPreferences: (patch: Partial<LocalPreferences>) => call<LocalPreferences>("storage_set_preferences", { patch }),
    recoverCorrupt: () => call<{ quarantinePath: string; generation: string }>("storage_recover_corrupt", { acknowledgement: "quarantine-corrupt-database" }),
  })
}
