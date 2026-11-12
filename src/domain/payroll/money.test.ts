import Decimal from "decimal.js"
import { describe, expect, it } from "vitest"
import { FiscalFoundationError } from "./errors"
import { addDecimals, compareDecimals, decimalText, divideDecimals, moneyText, multiplyDecimals, presentMoney, roundDecimal, subtractDecimals } from "./money"

describe("cadenas monetarias", () => {
  it.each([
    ["0", "0.00"], ["-0.00", "0.00"], ["00001.2", "1.20"],
    ["-0.01", "-0.01"], ["9007199254740993.99", "9007199254740993.99"],
    ["99999999999999999999.99", "99999999999999999999.99"],
  ])("valida %s sin pérdida de centavos", (input, expected) => {
    expect(moneyText(input)).toBe(expected)
  })

  it.each(["", "+1", "1.", ".5", " 1 ", "1,000.00", "1e3", "NaN", "Infinity", "1.001", "100000000000000000000"])("rechaza %s sin redondear entradas", input => {
    expect(() => moneyText(input)).toThrow(FiscalFoundationError)
  })

  it("rechaza Number aun si un cliente elude el contrato TypeScript", () => {
    expect(() => moneyText(1.25 as unknown as string)).toThrow(FiscalFoundationError)
  })

  it("distingue importes firmados, no negativos y positivos", () => {
    expect(moneyText("-1.25", "signed")).toBe("-1.25")
    expect(moneyText("0", "non-negative")).toBe("0.00")
    expect(() => moneyText("-0.01", "non-negative")).toThrow()
    expect(() => moneyText("-0", "positive")).toThrow()
    expect(moneyText("0.01", "positive")).toBe("0.01")
  })
})

describe("precisión decimal y operaciones generales", () => {
  it("evita el error binario 0.1 + 0.2 y conserva el valor exacto", () => {
    expect(addDecimals("0.1", "0.2")).toMatchObject({ value: "0.3", exact: true })
    expect(subtractDecimals("0.3", "0.1")).toMatchObject({ value: "0.2", exact: true })
  })

  it("conserva productos finitos exactos de los datos oficiales, sin aplicar subsidio", () => {
    expect(multiplyDecimals("3439.46", "0.1559")).toMatchObject({ value: "536.211814", exact: true })
    expect(multiplyDecimals("3566.22", "0.1502")).toMatchObject({ value: "535.646244", exact: true })
  })

  it("distingue cocientes exactos de divisiones periódicas a 50 dígitos", () => {
    expect(divideDecimals("1", "8")).toMatchObject({ value: "0.125", exact: true })
    expect(divideDecimals("1", "3")).toMatchObject({ value: `0.${"3".repeat(50)}`, exact: false, precision: 50 })
    expect(divideDecimals("0", "3").exact).toBe(true)
  })

  it("señala también pérdida de precisión en una suma finita", () => {
    expect(addDecimals(`1.${"9".repeat(49)}`, `0.${"0".repeat(49)}1`)).toMatchObject({ value: `1.${"9".repeat(49)}`, exact: false })
  })

  it("opera signos sin convertir cantidades a números binarios", () => {
    expect(multiplyDecimals("-1.25", "-2")).toMatchObject({ value: "2.5", exact: true })
    expect(divideDecimals("1", "-8")).toMatchObject({ value: "-0.125", exact: true })
    expect(subtractDecimals("0", "0.01").value).toBe("-0.01")
    expect(compareDecimals("9007199254740993.98", "9007199254740993.99")).toBe(-1)
  })

  it("rechaza cero como divisor y desbordamiento técnico, sin recortar valores", () => {
    expect(() => divideDecimals("1", "-0.00")).toThrow()
    expect(() => addDecimals("99999999999999999999.99", "0.01")).toThrow()
    expect(() => decimalText(`0.${"1".repeat(51)}`)).toThrow()
  })

  it("aísla la configuración del constructor Decimal global", () => {
    const precision = Decimal.precision
    const rounding = Decimal.rounding
    try {
      Decimal.set({ precision: 3, rounding: Decimal.ROUND_DOWN })
      expect(divideDecimals("1", "3").value).toBe(`0.${"3".repeat(50)}`)
      expect(addDecimals("12345.67", "0.01").value).toBe("12345.68")
    } finally { Decimal.set({ precision, rounding }) }
  })
})

describe("determinación técnica de presentación", () => {
  it.each([
    ["1.234", "1.23"], ["1.235", "1.24"], ["-1.235", "-1.24"],
    ["0.005", "0.01"], ["-0.004", "0.00"], ["535.646244", "535.65"],
  ])("redondea %s con half-up y conserva el original", (input, expected) => {
    const shown = presentMoney(input)
    expect(shown.raw).toBe(decimalText(input))
    expect(shown.amount).toBe(expected)
    expect(shown.rounded).toBe(true)
  })

  it("no confunde igualdad monetaria con cambio de formato", () => {
    expect(presentMoney("1.20")).toMatchObject({ raw: "1.2", amount: "1.20", rounded: false })
  })

  it("expone modos alternativos explícitos para comprobar política", () => {
    expect(presentMoney("1.245", "half-even").amount).toBe("1.24")
    expect(presentMoney("1.245", "half-up").amount).toBe("1.25")
    expect(presentMoney("-1.239", "toward-zero").amount).toBe("-1.23")
    expect(() => roundDecimal("1.25", -1)).toThrow()
    expect(() => roundDecimal("1.25", 1.5)).toThrow()
  })
})
