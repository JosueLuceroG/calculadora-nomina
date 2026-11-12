import { describe, expect, it } from "vitest"
import { formatMxn } from "./format"

describe("formato MXN exacto, solo presentación", () => {
  it.each([
    [null, "$ —"],
    ["0", "$ 0.00"],
    ["15000", "$ 15,000.00"],
    ["0.01", "$ 0.01"],
    ["20.5", "$ 20.50"],
    ["000020.50", "$ 20.50"],
    ["9007199254740993123456789.99", "$ 9,007,199,254,740,993,123,456,789.99"],
  ])("presenta %s sin perder precisión", (value, expected) => {
    expect(formatMxn(value)).toBe(expected)
  })

  it.each(["1.234", "NaN", "1,000.00", "1e3", "", "1."])("no redondea ni interpreta silenciosamente %s", value => {
    expect(() => formatMxn(value)).toThrow()
  })
})
