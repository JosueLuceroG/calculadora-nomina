import { FiscalFoundationError } from "./errors"

declare const civilDateBrand: unique symbol
export type CivilDate = string & { readonly [civilDateBrand]: true }
export type DateInterval = Readonly<{ from: string; through: string }>

export function isCivilDate(value: unknown): value is CivilDate {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  // Number is limited to integer calendar fields, never monetary quantities.
  const [year, month, day] = value.split("-").map(Number)
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= lengths[month - 1]
}

export function civilDate(value: string): CivilDate {
  if (!isCivilDate(value)) throw new FiscalFoundationError("INVALID_DATE", "La fecha debe ser civil y válida: YYYY-MM-DD.")
  return value
}

export function validateDateInterval(interval: DateInterval): void {
  const from = civilDate(interval.from)
  const through = civilDate(interval.through)
  if (from > through) throw new FiscalFoundationError("INVALID_INTERVAL", "El inicio no puede ser posterior al fin del intervalo.")
}

export function nextCivilDate(value: string): CivilDate {
  const date = civilDate(value)
  const [year, month, day] = date.split("-").map(Number)
  const nextDay = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${(day + 1).toString().padStart(2, "0")}`
  if (isCivilDate(nextDay)) return nextDay
  if (month < 12) return civilDate(`${year.toString().padStart(4, "0")}-${(month + 1).toString().padStart(2, "0")}-01`)
  if (year === 9999) throw new FiscalFoundationError("UNSUPPORTED_DATE", "La fecha siguiente excede el rango de cuatro dígitos.")
  return civilDate(`${(year + 1).toString().padStart(4, "0")}-01-01`)
}
