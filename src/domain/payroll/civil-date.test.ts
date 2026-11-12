import { describe, expect, it } from "vitest"
import { civilDate, isCivilDate, nextCivilDate, validateDateInterval } from "./civil-date"

describe("calendario civil", () => {
  it.each(["2026-01-01", "2026-10-13", "2024-02-29", "2000-02-29", "0001-01-01", "9999-12-31"])("preserva %s", value => {
    expect(civilDate(value)).toBe(value)
  })

  it.each(["", "2026-02-29", "1900-02-29", "2100-02-29", "0000-01-01", "2026-04-31", "2026-13-01", "2026-01-00", "2026-1-1", "2026-01-01T00:00:00Z", "13/10/2026", " 2026-10-13 "])("rechaza %s", value => {
    expect(isCivilDate(value)).toBe(false)
    expect(() => civilDate(value)).toThrow()
  })

  it.each([
    ["2026-01-31", "2026-02-01"], ["2026-02-28", "2026-03-01"],
    ["2024-02-28", "2024-02-29"], ["2024-02-29", "2024-03-01"],
    ["2026-12-31", "2027-01-01"],
  ])("obtiene el día siguiente de %s", (input, expected) => {
    expect(nextCivilDate(input)).toBe(expected)
  })

  it("rechaza inversión de extremos y desbordamiento del año civil", () => {
    expect(() => validateDateInterval({ from: "2026-02-01", through: "2026-01-31" })).toThrow()
    expect(() => nextCivilDate("9999-12-31")).toThrow()
    expect(() => validateDateInterval({ from: "2026-01-01", through: "2026-01-01" })).not.toThrow()
  })
})
