import { civilDate, nextCivilDate, validateDateInterval, type DateInterval } from "./civil-date"
import type { FiscalParameterSet, FiscalSource, IsrTariff } from "./contracts"
import { FiscalFoundationError } from "./errors"
import { addDecimals, compareDecimals, decimalText, moneyText } from "./money"

const officialHosts = new Set([
  "www.sat.gob.mx", "sat.gob.mx", "www.dof.gob.mx", "dof.gob.mx", "sidof.segob.gob.mx",
  "www.imss.gob.mx", "imss.gob.mx", "www.inegi.org.mx", "inegi.org.mx",
  "www.diputados.gob.mx", "www.gob.mx", "gob.mx",
])
const authorities = new Set(["SAT", "SHCP", "DOF", "IMSS", "INEGI", "CONASAMI", "Cámara de Diputados"])
const parameterKinds = new Set(["isr-tariff", "uma", "minimum-wages", "employment-subsidy", "imss-constants", "contractual-divisors", "labor-benefit-minima"])

export function validateFiscalSource(source: FiscalSource): void {
  let url: URL
  try { url = new URL(source.url) } catch { throw new FiscalFoundationError("INVALID_METADATA", "La URL de la fuente no es válida.") }
  if (url.protocol !== "https:" || !officialHosts.has(url.hostname) || url.username || url.password || url.port || !authorities.has(source.authority) || !source.document.trim() || !source.locator.trim()) {
    throw new FiscalFoundationError("INVALID_METADATA", "La referencia debe identificar una fuente oficial y su ubicación.")
  }
  if (civilDate(source.publicationDate) > civilDate(source.verifiedOn)) {
    throw new FiscalFoundationError("INVALID_METADATA", "La verificación no puede preceder a la publicación.")
  }
  if (source.currentTextAsOf && civilDate(source.currentTextAsOf) > source.verifiedOn) {
    throw new FiscalFoundationError("INVALID_METADATA", "El texto consultado no puede ser posterior a su verificación.")
  }
}

export function validateParameterMetadata<T>(set: FiscalParameterSet<T>): void {
  if (!set.id.trim() || !set.key.trim() || !set.version.trim() || !parameterKinds.has(set.kind) || set.validationScope !== "source-data-only" || set.sources.length === 0) {
    throw new FiscalFoundationError("INVALID_METADATA", "El conjunto de parámetros no tiene metadatos completos.")
  }
  if (set.validation !== "source-verified") {
    throw new FiscalFoundationError("UNVERIFIED_PARAMETER", `El conjunto ${set.id} no está verificado documentalmente.`)
  }
  civilDate(set.effectiveFrom)
  if (set.effectiveThrough !== null) validateDateInterval({ from: set.effectiveFrom, through: set.effectiveThrough })
  set.sources.forEach(validateFiscalSource)
}

export function validateParameterTimeline<T>(sets: readonly FiscalParameterSet<T>[], coverage: DateInterval): void {
  validateDateInterval(coverage)
  if (sets.length === 0) throw new FiscalFoundationError("MISSING_PARAMETER", "No hay parámetros para el conjunto solicitado.")
  const first = sets[0]
  const ids = new Set<string>()
  for (const set of sets) {
    validateParameterMetadata(set)
    if (set.kind !== first.kind || set.key !== first.key || ids.has(set.id)) {
      throw new FiscalFoundationError("INCOMPATIBLE_PARAMETERS", "No se pueden mezclar conjuntos distintos ni identificadores duplicados.")
    }
    ids.add(set.id)
  }
  const sorted = [...sets].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1]
    if (previous.effectiveThrough === null || sorted[index].effectiveFrom <= previous.effectiveThrough) {
      throw new FiscalFoundationError("OVERLAPPING_INTERVALS", "Las vigencias se solapan, incluyendo sus extremos.")
    }
  }
  let needed = civilDate(coverage.from)
  for (const set of sorted) {
    if (set.effectiveThrough !== null && set.effectiveThrough < needed) continue
    if (set.effectiveFrom > coverage.through) break
    if (set.effectiveFrom > needed) {
      throw new FiscalFoundationError("COVERAGE_GAP", `Falta cobertura desde ${needed}.`)
    }
    if (set.effectiveThrough === null || set.effectiveThrough >= coverage.through) return
    needed = nextCivilDate(set.effectiveThrough)
  }
  throw new FiscalFoundationError("COVERAGE_GAP", `Falta cobertura hasta ${coverage.through}.`)
}

export function selectByEffectiveDate<T>(sets: readonly FiscalParameterSet<T>[], effectiveDate: string, supportedDates: DateInterval): FiscalParameterSet<T> {
  const date = civilDate(effectiveDate)
  validateDateInterval(supportedDates)
  if (date < supportedDates.from || date > supportedDates.through) {
    throw new FiscalFoundationError("UNSUPPORTED_DATE", "La fecha está fuera de la cobertura declarada; no se busca un paquete cercano.")
  }
  validateParameterTimeline(sets, supportedDates)
  const selected = sets.find(set => set.effectiveFrom <= date && (set.effectiveThrough === null || date <= set.effectiveThrough))
  if (!selected) throw new FiscalFoundationError("MISSING_PARAMETER", "No hay parámetros para la fecha efectiva.")
  return selected
}

/** Validate imported ranges only. No tariff bracket selection or tax calculation. */
export function validateIsrTariff(tariff: IsrTariff): void {
  const rows = tariff.rows
  if (rows.length !== 11 || compareDecimals(rows[0]?.lower ?? "0", "0.01") !== 0) {
    throw new FiscalFoundationError("INVALID_TARIFF", "La tarifa 2026 debe contener 11 tramos e iniciar en 0.01.")
  }
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]
    moneyText(row.lower, "positive")
    moneyText(row.fixedFee, "non-negative")
    decimalText(row.ratePercent)
    if (compareDecimals(row.ratePercent, "0") <= 0 || compareDecimals(row.ratePercent, "100") > 0) {
      throw new FiscalFoundationError("INVALID_TARIFF", "La tasa porcentual no es válida.")
    }
    if (row.upper === null) {
      if (index !== rows.length - 1) throw new FiscalFoundationError("INVALID_TARIFF", "Solo el último tramo puede ser abierto.")
    } else {
      moneyText(row.upper, "positive")
      if (compareDecimals(row.lower, row.upper) > 0 || index === rows.length - 1) {
        throw new FiscalFoundationError("INVALID_TARIFF", "El límite superior es inválido.")
      }
      const expectedNext = addDecimals(row.upper, "0.01").value
      if (compareDecimals(rows[index + 1].lower, expectedNext) !== 0) {
        throw new FiscalFoundationError("INVALID_TARIFF", "Hay un hueco o solapamiento entre tramos monetarios.")
      }
    }
  }
}
