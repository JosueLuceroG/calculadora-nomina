/** Gramática de edición, no validación fiscal: admite vacío y punto pendiente.
 * No redondea, recorta ceros, limita decimales ni convierte dinero a Number. */
const plainDraft = /^\d*(?:\.\d*)?$/
const groupedDraft = /^\d{1,3}(?:,\d{3})+(?:\.\d*)?$/

export function canonicalMoneyDraft(text: string): string {
  return groupedDraft.test(text) ? text.replaceAll(",", "") : text
}

export function formatMoneyDraft(text: string): string {
  if (!plainDraft.test(text)) return text
  const [whole, fraction] = text.split(".")
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return fraction === undefined ? grouped : `${grouped}.${fraction}`
}

export function isUnambiguousMoneyPaste(text: string): boolean {
  // Las entradas con coma deben tener agrupación completa, nunca coma decimal.
  return !text.includes(",") || groupedDraft.test(text)
}

export type MoneySelection = { start: number; end: number; direction: "forward" | "backward" | "none" }
export type MoneyEditSnapshot = MoneySelection & { text: string }

/** Cuenta caracteres significativos a cada lado de la selección, no píxeles.
 * Conserva además la afinidad con el lado de una coma. */
export function mapMoneySelection(raw: string, formatted: string, selection: MoneySelection): MoneySelection {
  function position(offset: number) {
    const logical = raw.slice(0, offset).replaceAll(",", "").length
    let index = 0, count = 0
    while (index < formatted.length && count < logical) {
      if (formatted[index] !== ",") count++
      index++
    }
    if (offset > 0 && raw[offset - 1] === "," && formatted[index] === ",") index++
    return index
  }
  return { start: position(selection.start), end: position(selection.end), direction: selection.direction }
}

/** Historial exclusivamente de edición de este input, no de simulaciones.
 * Una entrada por transacción (incluida composición/pegado), máximo 200. */
export class MoneyEditHistory {
  private past: MoneyEditSnapshot[] = []
  private future: MoneyEditSnapshot[] = []
  record(before: MoneyEditSnapshot, after: MoneyEditSnapshot) {
    if (before.text === after.text) return
    this.past.push({ ...before })
    if (this.past.length > 200) this.past.shift()
    this.future = []
  }
  undo(current: MoneyEditSnapshot): MoneyEditSnapshot | undefined {
    const previous = this.past.pop()
    if (previous) this.future.push({ ...current })
    return previous
  }
  redo(current: MoneyEditSnapshot): MoneyEditSnapshot | undefined {
    const next = this.future.pop()
    if (next) this.past.push({ ...current })
    return next
  }
  clear() { this.past = []; this.future = [] }
}
