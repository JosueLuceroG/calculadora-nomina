import Decimal from "decimal.js"
import { FiscalFoundationError } from "./errors"

declare const decimalBrand: unique symbol
declare const moneyBrand: unique symbol
export type DecimalText = string & { readonly [decimalBrand]: true }
export type MoneyText = string & { readonly [moneyBrand]: true }
export type RoundingMode = "half-up" | "half-even" | "toward-zero"
export type MoneySign = "signed" | "non-negative" | "positive"

/** Technical bounds, not fiscal ceilings or an IMSS operational prescription. */
export const DECIMAL_POLICY = Object.freeze({
  id: "decimal-50-v1",
  significantDigits: 50,
  maxIntegerDigits: 20,
  maxFractionDigits: 100,
  maxTextLength: 256,
  moneyDecimals: 2,
  precisionRounding: "half-up" as const,
  displayRounding: "half-up" as const,
  nature: "technical-policy" as const,
  suaEquivalence: "not-validated" as const,
})

// The default Decimal constructor can be configured by other consumers without
// affecting this private arithmetic context. Instances never cross the API.
const ArithmeticDecimal = Decimal.clone({
  precision: DECIMAL_POLICY.significantDigits,
  rounding: Decimal.ROUND_HALF_UP,
})

function validateText(value: string): void {
  if (typeof value !== "string" || value.length > DECIMAL_POLICY.maxTextLength || !/^-?\d+(?:\.\d+)?$/.test(value)) {
    throw new FiscalFoundationError("INVALID_DECIMAL", "Usa una cadena decimal finita con punto, sin exponentes ni separadores.")
  }
  const unsigned = value.replace(/^-/, "")
  const [integer, fraction = ""] = unsigned.split(".")
  const integerDigits = integer.replace(/^0+/, "").length
  const significantDigits = (integer + fraction).replace(/^0+/, "").replace(/0+$/, "").length
  if (integerDigits > DECIMAL_POLICY.maxIntegerDigits || fraction.length > DECIMAL_POLICY.maxFractionDigits || significantDigits > DECIMAL_POLICY.significantDigits) {
    throw new FiscalFoundationError("DECIMAL_RANGE", "El valor excede el rango técnico de precisión admitido.")
  }
}

export function decimalText(value: string): DecimalText {
  validateText(value)
  const parsed = new ArithmeticDecimal(value)
  return (parsed.isZero() ? "0" : parsed.toFixed()) as DecimalText
}

export function moneyText(value: string, sign: MoneySign = "signed"): MoneyText {
  validateText(value)
  if (!["signed", "non-negative", "positive"].includes(sign)) {
    throw new FiscalFoundationError("INVALID_MONEY_SIGN", "La política de signo no es válida.")
  }
  if ((value.split(".")[1]?.length ?? 0) > DECIMAL_POLICY.moneyDecimals) {
    throw new FiscalFoundationError("INVALID_MONEY_SCALE", "El importe admite como máximo dos decimales; no se redondea al validar.")
  }
  const parsed = new ArithmeticDecimal(value)
  if ((sign === "non-negative" && parsed.lt(0)) || (sign === "positive" && parsed.lte(0))) {
    throw new FiscalFoundationError("INVALID_MONEY_SIGN", "El signo del importe no corresponde a la operación solicitada.")
  }
  return (parsed.isZero() ? "0.00" : parsed.toFixed(2)) as MoneyText
}

function fractionOf(value: string): { numerator: bigint; denominator: bigint } {
  const negative = value.startsWith("-")
  const [integer, fraction = ""] = value.replace(/^-/, "").split(".")
  return {
    numerator: BigInt(integer + fraction) * (negative ? -1n : 1n),
    denominator: 10n ** BigInt(fraction.length),
  }
}

export type DecimalComputation = Readonly<{
  value: DecimalText
  exact: boolean
  precision: number
}>

type ArithmeticOperation = "add" | "subtract" | "multiply" | "divide"

function arithmetic(operation: ArithmeticOperation, a: string, b: string): DecimalComputation {
  const leftText = decimalText(a)
  const rightText = decimalText(b)
  const left = new ArithmeticDecimal(leftText)
  const right = new ArithmeticDecimal(rightText)
  if (operation === "divide" && right.isZero()) {
    throw new FiscalFoundationError("DIVISION_BY_ZERO", "No se permite dividir entre cero.")
  }
  const result = operation === "add" ? left.plus(right)
    : operation === "subtract" ? left.minus(right)
      : operation === "multiply" ? left.times(right) : left.dividedBy(right)
  const value = decimalText(result.toFixed())

  // Exact rational comparison certifies whether the 50-digit decimal result
  // lost precision. It does not reimplement the calculation with binary floats.
  const x = fractionOf(leftText)
  const y = fractionOf(rightText)
  const output = fractionOf(value)
  const numerator = operation === "add" ? x.numerator * y.denominator + y.numerator * x.denominator
    : operation === "subtract" ? x.numerator * y.denominator - y.numerator * x.denominator
      : operation === "multiply" ? x.numerator * y.numerator : x.numerator * y.denominator
  const denominator = operation === "divide" ? x.denominator * y.numerator : x.denominator * y.denominator
  const exact = output.numerator * denominator === numerator * output.denominator
  return Object.freeze({ value, exact, precision: DECIMAL_POLICY.significantDigits })
}

export const addDecimals = (a: string, b: string) => arithmetic("add", a, b)
export const subtractDecimals = (a: string, b: string) => arithmetic("subtract", a, b)
export const multiplyDecimals = (a: string, b: string) => arithmetic("multiply", a, b)
export const divideDecimals = (a: string, b: string) => arithmetic("divide", a, b)

export function compareDecimals(a: string, b: string): -1 | 0 | 1 {
  const comparison = new ArithmeticDecimal(decimalText(a)).comparedTo(new ArithmeticDecimal(decimalText(b)))
  return comparison < 0 ? -1 : comparison > 0 ? 1 : 0
}

const roundingModes = {
  "half-up": Decimal.ROUND_HALF_UP,
  "half-even": Decimal.ROUND_HALF_EVEN,
  "toward-zero": Decimal.ROUND_DOWN,
} as const

export function roundDecimal(value: string, decimalPlaces: number, mode: RoundingMode = "half-up") {
  if (decimalPlaces < 0 || decimalPlaces % 1 !== 0 || decimalPlaces > DECIMAL_POLICY.maxFractionDigits || !Object.hasOwn(roundingModes, mode)) {
    throw new FiscalFoundationError("DECIMAL_RANGE", "La precisión o el modo de redondeo no son válidos.")
  }
  const original = decimalText(value)
  const rounded = new ArithmeticDecimal(original).toDecimalPlaces(decimalPlaces, roundingModes[mode])
  const result = decimalText(rounded.toFixed())
  return Object.freeze({ original, value: result, changed: compareDecimals(original, result) !== 0, mode, decimalPlaces })
}

export function presentMoney(value: string, mode: RoundingMode = "half-up") {
  const rounded = roundDecimal(value, DECIMAL_POLICY.moneyDecimals, mode)
  return Object.freeze({
    raw: rounded.original,
    amount: moneyText(rounded.value),
    rounded: rounded.changed,
    rounding: mode,
  })
}
