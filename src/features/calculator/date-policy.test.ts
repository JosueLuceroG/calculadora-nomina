import { afterEach, describe, expect, it } from "vitest"
import { automaticDateIsStale, changeManualDate, chooseAutomaticDate, chooseManualDate, createDateSession, finishFiscalExecution, localCivilDate, preserveResultDate, readableCivilDate, startFiscalExecution } from "./date-policy"
import { createFiscalAdapter, queryFiscalDateCoverage } from "./fiscal-adapter"
import { createCalculationController } from "./calculation-controller"
import { createInitialForm } from "./form"

const originalZone = process.env.TZ
afterEach(() => { if (originalZone === undefined) delete process.env.TZ; else process.env.TZ = originalZone })

describe("fecha civil local y sesión, reloj determinista", () => {
  it.each([
    ["America/Mexico_City", "2026-02-01T02:30:00Z", "2026-01-31"],
    ["America/Los_Angeles", "2027-01-01T02:30:00Z", "2026-12-31"],
    ["Asia/Tokyo", "2026-01-31T18:30:00Z", "2026-02-01"],
    ["Pacific/Kiritimati", "2025-12-31T12:30:00Z", "2026-01-01"],
    ["UTC", "2027-01-01T00:00:00Z", "2027-01-01"],
  ])("%s: %s corresponde a %s, no al día UTC por recorte", (zone, instant, expected) => {
    process.env.TZ = zone
    const session = createDateSession(new Date(instant))
    expect(localCivilDate(new Date(instant))).toBe(expected)
    expect(session.referenceDate).toBe(expected)
    expect(session.consultationLocalDate).toBe(expected)
    expect(session.mode).toBe("automatic")
    expect(session.preparedAt).toBe(new Date(instant).toISOString())
  })
  it("manual opcional, vuelta a No resuelve hoy y conserva última fecha manual", () => {
    process.env.TZ = "UTC"
    const initial = createDateSession(new Date("2026-10-16T12:00:00Z"))
    const manual = changeManualDate(chooseManualDate(initial, true), "2026-01-31")
    const auto = chooseAutomaticDate(manual, new Date("2026-10-17T12:00:00Z"))
    expect(auto.referenceDate).toBe("2026-10-17")
    expect(auto.mode).toBe("automatic")
    expect(chooseManualDate(auto, true).referenceDate).toBe("2026-01-31")
    expect(initial.referenceDate).toBe("2026-10-16")
    expect(Object.isFrozen(initial)).toBe(true)
  })
  it("sin cobertura, Sí no inventa una fecha histórica", () => {
    process.env.TZ = "UTC"
    const session = createDateSession(new Date("2027-01-01T12:00:00Z"))
    expect(session.referenceDate).toBe("2027-01-01")
    expect(chooseManualDate(session, false).referenceDate).toBe("")
  })
  it("medianoche bloquea automático no ejecutado, incluida transición a 2027", () => {
    process.env.TZ = "UTC"
    const session = createDateSession(new Date("2026-12-31T23:59:59Z"))
    const tomorrow = new Date("2027-01-01T00:00:01Z")
    expect(automaticDateIsStale(session, tomorrow)).toBe(true)
    const refreshed = chooseAutomaticDate(session, tomorrow)
    expect(refreshed.referenceDate).toBe("2027-01-01")
    expect(queryFiscalDateCoverage(refreshed.referenceDate).available).toBe(false)
    expect(session.referenceDate).toBe("2026-12-31")
  })
  it("editar resultado conserva fecha y modo incluso tras cambiar el día/año", () => {
    process.env.TZ = "UTC"
    const resultDate = preserveResultDate(createDateSession(new Date("2026-12-31T12:00:00Z")))
    expect(automaticDateIsStale(resultDate, new Date("2027-01-01T12:00:00Z"))).toBe(false)
    expect(resultDate.referenceDate).toBe("2026-12-31")
    expect(resultDate.mode).toBe("automatic")
    expect(chooseAutomaticDate(resultDate, new Date("2027-01-01T12:00:00Z")).preservedFromResult).toBe(false)
  })
  it("modo manual no depende de que cambie el reloj", () => {
    const manual = changeManualDate(createDateSession(new Date("2026-01-01T12:00:00Z")), "2026-02-01")
    expect(automaticDateIsStale(manual, new Date("2027-01-01T12:00:00Z"))).toBe(false)
  })
  it("separa consulta, realización, fecha fiscal y paquete con snapshots inmutables", () => {
    process.env.TZ = "America/Los_Angeles"
    const session = changeManualDate(createDateSession(new Date("2026-10-17T02:00:00Z")), "2026-02-01")
    const started = startFiscalExecution(session, 7, session.referenceDate, new Date("2026-10-17T02:01:00Z"), "mx-fiscal-2026-source-v3")
    const complete = finishFiscalExecution(started, new Date("2026-10-17T02:01:03Z"), "mx-fiscal-2026-source-v3")
    expect(complete.consultationLocalDate).toBe("2026-10-16")
    expect(complete.fiscalDate).toBe("2026-02-01")
    expect(complete.completedLocalDate).toBe("2026-10-16")
    expect(complete.completedLocalTime).toBe("19:01:03")
    expect(complete.utcOffsetMinutes).toBe(-420)
    expect(complete.referenceMode).toBe("manual")
    expect(complete.packageId).toBe("mx-fiscal-2026-source-v3")
    expect(started.completedAt).toBeNull()
    expect(Object.isFrozen(complete)).toBe(true)
    process.env.TZ = "Asia/Tokyo"
    expect(complete.completedLocalDate).toBe("2026-10-16")
  })
  it("presenta fechas civiles sin interpretar YYYY-MM-DD como UTC", () => {
    expect(readableCivilDate("2026-02-01")).toBe("1 de febrero de 2026")
    expect(readableCivilDate("")).toBe("Fecha pendiente")
  })
})

describe("frontera de cobertura: repositorio y núcleo existentes", () => {
  it.each(["2026-01-01", "2026-01-31", "2026-02-01", "2026-12-31"])("%s tiene cobertura y paquete explícito", date => {
    expect(queryFiscalDateCoverage(date)).toMatchObject({ available: true, packageId: "mx-fiscal-2026-source-v3", referenceDate: date })
  })
  it.each(["2025-12-31", "2027-01-01", "2028-02-29"])("%s no cae silenciosamente en 2026", date => {
    expect(queryFiscalDateCoverage(date)).toMatchObject({ available: false, packageId: null, reason: "outside-coverage", referenceDate: date })
  })
  it.each(["", "2026-02-29", "2026-13-01"])("%s no es fecha válida", date => {
    expect(queryFiscalDateCoverage(date).reason).toBe("invalid-date")
  })
  it.each([["2026-01-31", "9556.74"], ["2026-02-01", "9557.42"]])("fecha equivalente automática/manual %s conserva resultado fiscal %s", (date, net) => {
    process.env.TZ = "UTC"
    const session = createDateSession(new Date(`${date}T12:00:00Z`))
    const manual = changeManualDate(session, date)
    const form = { ...createInitialForm(), mode: "gross-to-net" as const, amount: "10000.00", period: "monthly" as const, bonusDays: "15", vacationDays: "12", vacationPremium: "25" }
    const adapter = createFiscalAdapter()
    const outputs = [session, manual].map(s => {
      const prepared = adapter.prepare({ form: { ...form, effectiveDate: s.referenceDate }, area: "general-zone" })
      if (!prepared.ok || prepared.prepared.mode !== "gross-to-net") throw new Error("Captura rechazada")
      expect(Object.keys(prepared.prepared.snapshot.form).sort()).toEqual(Object.keys(createInitialForm()).sort())
      return adapter.direct(prepared.prepared).report
    })
    expect(outputs[0]).toEqual(outputs[1])
    expect(outputs[0].net.amount).toBe(net)
  })
  it("cambiar fecha invalida resultado y declaración del mínimo mediante el controlador", () => {
    const controller = createCalculationController()
    const capture = { form: { ...createInitialForm(), mode: "gross-to-net" as const, amount: "9451.20", period: "monthly" as const, effectiveDate: "2026-01-31", bonusDays: "15", vacationDays: "12", vacationPremium: "25" }, area: "general-zone" as const }
    controller.submit(capture)
    const oldId = controller.getState().requestId
    controller.confirmMinimum(oldId, { kind: "only-general-minimum-assumed-for-reference-month", referenceMonth: "2026-01", noOtherSalaryPayments: true, acknowledgement: "explicit-standard-simulation-assumption-not-payroll-verification" })
    expect(controller.getState().outcome?.presentation.values.netSalary).toBe("9451.20")
    const changed = { ...capture, form: { ...capture.form, effectiveDate: "2026-02-01" } }
    controller.edit(changed)
    expect(controller.getState().outcome).toBeNull()
    controller.submit(changed)
    expect(controller.getState().outcome?.presentation.confirmation?.referenceMonth).toBe("2026-02")
    expect(controller.getState().outcome?.presentation.values.netSalary).toBeNull()
    controller.dispose()
  })
})
