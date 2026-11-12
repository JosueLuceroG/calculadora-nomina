export type FoundationErrorCode =
  | "INVALID_DECIMAL"
  | "DECIMAL_RANGE"
  | "INVALID_MONEY_SCALE"
  | "INVALID_MONEY_SIGN"
  | "DIVISION_BY_ZERO"
  | "INVALID_DATE"
  | "INVALID_INTERVAL"
  | "UNSUPPORTED_DATE"
  | "MISSING_PARAMETER"
  | "COVERAGE_GAP"
  | "OVERLAPPING_INTERVALS"
  | "UNVERIFIED_PARAMETER"
  | "INVALID_METADATA"
  | "INVALID_TARIFF"
  | "INCOMPATIBLE_PARAMETERS"

export class FiscalFoundationError extends Error {
  constructor(public readonly code: FoundationErrorCode, message: string) {
    super(message)
    this.name = "FiscalFoundationError"
  }
}
