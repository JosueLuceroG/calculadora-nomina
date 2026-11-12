import { formatMxn } from "../format"

export function ResultAmount({ value, className, describedBy }: { value: string | null; className?: string; describedBy?: string }) {
  const formatted = formatMxn(value)
  return <p className={className} aria-label={value === null ? "Sin resultado" : `${formatted} MXN`} aria-describedby={value === null ? describedBy : undefined}>{formatted}</p>
}
