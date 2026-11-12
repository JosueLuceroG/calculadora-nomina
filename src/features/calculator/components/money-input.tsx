import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from "react"
import { Input } from "@/components/ui/input"
import { canonicalMoneyDraft, formatMoneyDraft, isUnambiguousMoneyPaste, mapMoneySelection, MoneyEditHistory, type MoneyEditSnapshot, type MoneySelection } from "../money-editing"

type MoneyInputProps = Omit<ComponentProps<typeof Input>, "value" | "defaultValue" | "onChange" | "type"> & {
  value: string
  onValueChange?: (canonical: string) => void
}
function snapshot(input: HTMLInputElement): MoneyEditSnapshot {
  return { text: input.value, start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0, direction: input.selectionDirection ?? "none" }
}

/** El padre conserva la captura exacta sin agrupadores. Los borradores inválidos
 * se conservan para que la validación existente los rechace al calcular. */
export function MoneyInput({ value, onValueChange, ...props }: MoneyInputProps) {
  const [display, setDisplay] = useState(() => formatMoneyDraft(value))
  const input = useRef<HTMLInputElement>(null)
  const published = useRef(value)
  const history = useRef(new MoneyEditHistory())
  const before = useRef<{ state: MoneyEditSnapshot; data: string | null; type: string } | null>(null)
  const composition = useRef<MoneyEditSnapshot | null>(null)
  const pending = useRef<MoneySelection | null>(null)
  const pasted = useRef<string | null>(null)

  useLayoutEffect(() => {
    if (value !== published.current) {
      published.current = value
      history.current.clear()
      before.current = null
      composition.current = null
      pending.current = null
      setDisplay(formatMoneyDraft(value))
      input.current?.setCustomValidity("")
    }
  }, [value])
  useLayoutEffect(() => {
    if (pending.current && input.current) {
      const { start, end, direction } = pending.current
      input.current.setSelectionRange(start, end, direction)
      pending.current = null
    }
  })

  function publish(text: string, selection: MoneySelection) {
    const field = input.current!
    field.setCustomValidity("")
    // Actualización inmediata también cuando React recibe el mismo valor visual.
    field.value = text
    field.setSelectionRange(selection.start, selection.end, selection.direction)
    pending.current = selection
    setDisplay(text)
    const canonical = canonicalMoneyDraft(text)
    published.current = canonical
    onValueChange?.(canonical)
  }
  function restore(redo: boolean) {
    if (composition.current) return
    const current = snapshot(input.current!)
    const next = redo ? history.current.redo(current) : history.current.undo(current)
    if (next) publish(next.text, next)
    before.current = null
  }
  function commit(raw: string, selection: MoneySelection, previous: MoneyEditSnapshot, stripGeneratedCommas: boolean) {
    const canonical = stripGeneratedCommas ? raw.replaceAll(",", "") : canonicalMoneyDraft(raw)
    const text = formatMoneyDraft(canonical)
    // No se remapean comas que forman parte de un borrador inválido.
    const next = text === raw ? selection : mapMoneySelection(raw, text, selection)
    history.current.record(previous, { text, ...next })
    publish(text, next)
    before.current = null
    pasted.current = null
  }

  // beforeinput real incluye inputType para menú de deshacer y borrado nativos.
  useEffect(() => {
    const field = input.current!
    function capture(event: InputEvent) {
      if (event.inputType === "historyUndo" || event.inputType === "historyRedo") {
        if (event.cancelable) { event.preventDefault(); restore(event.inputType === "historyRedo") }
        return
      }
      before.current = { state: snapshot(field), data: event.data ?? pasted.current, type: event.inputType }
    }
    field.addEventListener("beforeinput", capture)
    return () => field.removeEventListener("beforeinput", capture)
  })

  return <Input {...props} ref={input} type="text" inputMode="decimal" value={display}
    onPaste={event => {
      const text = event.clipboardData.getData("text/plain")
      if (!isUnambiguousMoneyPaste(text)) {
        event.preventDefault()
        event.currentTarget.setCustomValidity("Pegado rechazado: usa comas solo en grupos de tres y punto decimal, por ejemplo 15,000.50. El importe anterior se conserva.")
        event.currentTarget.reportValidity()
        return
      }
      pasted.current = text
    }}
    onKeyDown={event => {
      if (composition.current || event.nativeEvent.isComposing) {
        if (event.key === "Enter") event.preventDefault()
        return
      }
      const modifier = event.ctrlKey || event.metaKey
      if (modifier && !event.altKey && (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")) {
        event.preventDefault()
        restore(event.key.toLowerCase() === "y" || event.shiftKey)
        return
      }
      const field = event.currentTarget
      const previous = snapshot(field)
      if (!modifier && !event.altKey && !event.shiftKey && previous.start === previous.end && canonicalMoneyDraft(previous.text) !== previous.text) {
        const back = event.key === "Backspace" && previous.text[previous.start - 1] === ","
        const forward = event.key === "Delete" && previous.text[previous.start] === ","
        if (back || forward) {
          event.preventDefault()
          const start = back ? previous.start - 2 : previous.start
          const end = back ? previous.start : previous.start + 2
          commit(previous.text.slice(0, start) + previous.text.slice(end), { start, end: start, direction: "none" }, previous, true)
        }
      }
    }}
    onCompositionStart={event => {
      composition.current = snapshot(event.currentTarget)
      before.current = null
    }}
    onCompositionEnd={event => {
      const previous = composition.current
      composition.current = null
      if (previous) {
        const current = snapshot(event.currentTarget)
        commit(current.text, current, previous, !event.data.includes(",") && formatMoneyDraft(canonicalMoneyDraft(previous.text)) === previous.text)
      }
    }}
    onChange={event => {
      const current = snapshot(event.currentTarget)
      if (composition.current || (event.nativeEvent as InputEvent).isComposing) {
        setDisplay(current.text)
        return
      }
      const transaction = before.current
      const previous = transaction?.state ?? { text: display, start: 0, end: display.length, direction: "none" as const }
      const data = transaction?.data ?? pasted.current
      const knownFormatting = canonicalMoneyDraft(previous.text) !== previous.text
      const safeInsertion = data === null || !data.includes(",") || (pasted.current !== null && isUnambiguousMoneyPaste(pasted.current))
      commit(current.text, current, previous, Boolean(transaction && knownFormatting && safeInsertion))
    }}
  />
}
