const groupedInteger = new Intl.NumberFormat("es-MX", {
  useGrouping: true,
  maximumFractionDigits: 0,
})

/** Exact display of decimal strings; no floating-point monetary conversion. */
export function formatMxn(value: string | null): string {
  if (value === null) return "$ —"
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
    throw new Error("El importe de presentación debe ser una cadena decimal válida.")
  }
  const [integer, fraction = ""] = value.split(".")
  return `$ ${groupedInteger.format(BigInt(integer))}.${fraction.padEnd(2, "0")}`
}

/** Conserva el signo recibido; no calcula diferencias ni convierte dinero a Number. */
export function formatSignedMxn(value: string | null): string {
  if (value === null) return "$ —"
  if (value.startsWith("-")) return `−${formatMxn(value.slice(1))}`
  return `${/^0+(?:\.0+)?$/.test(value) ? "" : "+"}${formatMxn(value)}`
}
