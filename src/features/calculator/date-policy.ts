import { isValidCivilDate } from "./validation"

export type ReferenceDateMode = "automatic" | "manual"
export type CivilClock = () => Date
export const systemClock: CivilClock = () => new Date()
const pad = (value: number) => String(value).padStart(2, "0")

/** Solo calendario local; ISO UTC se utiliza exclusivamente para instantes. */
export function localCivilDate(now: Date): string {
  return `${String(now.getFullYear()).padStart(4, "0")}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
export function readableCivilDate(value: string): string {
  if (!isValidCivilDate(value)) return "Fecha pendiente"
  const [year, month, day] = value.split("-")
  const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
  return `${Number(day)} de ${months[Number(month) - 1]} de ${year}`
}
export type DateSession = Readonly<{
  consultationLocalDate: string
  preparedAt: string
  referenceDate: string
  mode: ReferenceDateMode
  lastManualDate: string
  preservedFromResult: boolean
}>
export function createDateSession(now: Date): DateSession {
  const today = localCivilDate(now)
  return Object.freeze({ consultationLocalDate: today, preparedAt: now.toISOString(), referenceDate: today, mode: "automatic", lastManualDate: "", preservedFromResult: false })
}
export function chooseAutomaticDate(session: DateSession, now: Date): DateSession {
  return Object.freeze({ ...session, mode: "automatic", referenceDate: localCivilDate(now), lastManualDate: session.mode === "manual" ? session.referenceDate : session.lastManualDate, preservedFromResult: false })
}
export function chooseManualDate(session: DateSession, currentDateCovered: boolean): DateSession {
  return Object.freeze({ ...session, mode: "manual", referenceDate: session.lastManualDate || (currentDateCovered ? session.referenceDate : ""), preservedFromResult: false })
}
export function changeManualDate(session: DateSession, referenceDate: string): DateSession {
  return Object.freeze({ ...session, mode: "manual", referenceDate, lastManualDate: referenceDate, preservedFromResult: false })
}
export function preserveResultDate(session: DateSession): DateSession {
  return Object.freeze({ ...session, preservedFromResult: true })
}
export function automaticDateIsStale(session: DateSession, now: Date): boolean {
  return session.mode === "automatic" && !session.preservedFromResult && session.referenceDate !== localCivilDate(now)
}

export type FiscalExecutionMetadata = Readonly<{
  requestId: number
  consultationLocalDate: string
  preparedAt: string
  fiscalDate: string
  referenceMode: ReferenceDateMode
  packageId: string | null
  startedAt: string
  completedAt: string | null
  completedLocalDate: string | null
  completedLocalTime: string | null
  utcOffsetMinutes: number | null
}>
export function startFiscalExecution(session: DateSession, requestId: number, fiscalDate: string, now: Date, packageId: string | null): FiscalExecutionMetadata {
  return Object.freeze({ requestId, consultationLocalDate: session.consultationLocalDate, preparedAt: session.preparedAt, fiscalDate, referenceMode: session.mode, packageId, startedAt: now.toISOString(), completedAt: null, completedLocalDate: null, completedLocalTime: null, utcOffsetMinutes: null })
}
export function finishFiscalExecution(execution: FiscalExecutionMetadata, now: Date, packageId: string | null): FiscalExecutionMetadata {
  return Object.freeze({ ...execution, packageId, completedAt: now.toISOString(), completedLocalDate: localCivilDate(now), completedLocalTime: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`, utcOffsetMinutes: -now.getTimezoneOffset() || 0 })
}
