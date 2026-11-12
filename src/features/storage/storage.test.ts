import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createCalculationController, type CalculationState } from "../calculator/calculation-controller"
import { createFiscalAdapter, presentInverseFiscalResult, type FiscalAdapter } from "../calculator/fiscal-adapter"
import { createInitialForm, type CaptureForm } from "../calculator/form"
import type { FiscalExecutionMetadata } from "../calculator/date-policy"
import { calculateStandardEstimatedNetToGross } from "../../domain/payroll/net-to-gross"
import { standardGrossToNetContext2026 } from "../../infrastructure/fiscal/2026"
import { createStoredFiscalSnapshot, decodeFiscalSnapshot, encodeFiscalSnapshot, storageBuildIdentity } from "./snapshot"
import { deserializeStorageValue, serializeStorageValue } from "./serialization"
import { createNativeStorageApi, initialLocalPreferences, LocalStorageFailure } from "./storage-api"

beforeEach(() => vi.spyOn(performance, "now").mockReturnValue(0))
afterEach(() => vi.restoreAllMocks())
const fixtures: { name: string; payload: string }[] = []
export const testExecutionId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`
function metadata(state: CalculationState, automatic = false): FiscalExecutionMetadata {
  return { requestId:state.requestId, consultationLocalDate:"2026-02-01", preparedAt:"2026-02-01T12:00:00.000Z", fiscalDate:state.snapshot!.form.effectiveDate, referenceMode:automatic ? "automatic" : "manual", packageId:storageBuildIdentity.fiscalPackage.id, startedAt:"2026-02-01T12:00:01.000Z", completedAt:"2026-02-01T12:00:02.000Z", completedLocalDate:"2026-02-01", completedLocalTime:"12:00:02", utcOffsetMinutes:0 }
}
async function completed(patch: Partial<CaptureForm> = {}, adapter?: FiscalAdapter, conditioned = false) {
  const controller = createCalculationController(adapter)
  await controller.submit({ area:"general-zone", form:{...createInitialForm(),mode:"gross-to-net",amount:"00015000.50",period:"monthly",effectiveDate:"2026-02-01",...patch} }).completion
  if (conditioned) await controller.confirmMinimum(controller.getState().requestId,{kind:"only-general-minimum-assumed-for-reference-month",referenceMonth:"2026-02",noOtherSalaryPayments:true,acknowledgement:"explicit-standard-simulation-assumption-not-payroll-verification"}).completion
  return controller
}
function scoped(kind: "approximate" | "limited"): FiscalAdapter {
  const real = createFiscalAdapter()
  return { ...real, inverse:async request => {
    const report = await calculateStandardEstimatedNetToGross({...request.input,searchOptions:kind === "approximate" ? {grossRange:{from:"6216.15",to:"6216.16"}} : {grossRange:{from:"15000.00",to:"50000.00"},maxEvaluations:3}},standardGrossToNetContext2026())
    return {kind:"inverse",report,presentation:presentInverseFiscalResult(report,"2026-02-01")}
  } }
}
function captureSnapshot(controller: ReturnType<typeof createCalculationController>, n=1, automatic=false) {
  const state=controller.getState()
  return createStoredFiscalSnapshot({getCurrentState:controller.getState,expectedRequestId:state.requestId,executionId:testExecutionId(n),execution:metadata(state,automatic)})
}

describe("5B.7: serialización versionada y exacta", () => {
  it("BigInt y etiquetas colisionantes hacen round-trip sin reinterpretar datos", () => {
    const data={money:"12345678901234567890.50",unknown:null,zero:"0.00",large:123456789012345678901234567890n,negative:-5n,object:{$nomina:"bigint-v1",value:"42"},nested:[0,2.5,true,"",{__proto__:null,own:"ok"}]}
    expect(deserializeStorageValue(serializeStorageValue(data))).toEqual(data)
  })
  it("no interpreta __proto__ como instrucciones o cambio de prototipo", () => {
    const data=JSON.parse('{"__proto__":{"polluted":true}}')
    const decoded=deserializeStorageValue(serializeStorageValue(data)) as object
    expect(Object.hasOwn(decoded,"__proto__")).toBe(true)
    expect(({} as {polluted?:boolean}).polluted).toBeUndefined()
  })
  it.each([undefined,NaN,Infinity,-0,Number.MAX_SAFE_INTEGER+1,new Date(),new Map(),()=>{}])("rechaza valores JSON ambiguos/incompatibles (%s)", value => {
    expect(()=>serializeStorageValue({value})).toThrow()
  })
  it("rechaza ciclos, etiquetas inválidas y codecs futuros", () => {
    const a: unknown[]=[];a.push(a)
    expect(()=>serializeStorageValue(a)).toThrow("CYCLIC")
    expect(()=>deserializeStorageValue('{"codec":"future","value":null}')).toThrow()
    expect(()=>deserializeStorageValue('{"codec":"nomina-json-v1","value":{"$nomina":"bigint-v1","value":"1e3"}}')).toThrow()
    expect(()=>deserializeStorageValue('{"codec":"nomina-json-v1","value":{"$nomina":"escaped-object-v1","entries":[["a",1],["a",2]]}}')).toThrow()
  })
  it("orden de claves no cambia la representación idempotente",()=>{
    expect(serializeStorageValue({a:1,b:"0.00"})).toBe(serializeStorageValue({b:"0.00",a:1}))
  })
  it("no pierde silenciosamente huecos, símbolos o propiedades no enumerables",()=>{
    expect(()=>serializeStorageValue(new Array(2))).toThrow("SPARSE")
    expect(()=>serializeStorageValue({[Symbol("hidden")]:1})).toThrow("PROPERTY")
    expect(()=>serializeStorageValue(Object.defineProperty({},"hidden",{value:1}))).toThrow("PROPERTY")
  })
})

describe("snapshot fiscal original y frontera segura futura", () => {
  it.each([
    {name:"direct-manual",patch:{amount:"00015000.50"},auto:false},
    {name:"direct-imss-off-auto",patch:{amount:"15000.00",includeImss:false},auto:true},
    {name:"inverse-exact",patch:{mode:"net-to-gross",amount:"13202.64"},auto:false},
    {name:"inverse-approximate",patch:{mode:"net-to-gross",amount:"5557.04",period:"fortnightly"},auto:false,scope:"approximate"},
    {name:"inverse-limited",patch:{mode:"net-to-gross",amount:"13202.64"},auto:true,scope:"limited"},
    {name:"direct-conditioned",patch:{amount:"9451.20"},auto:false,conditioned:true},
  ] as const)("$name: round-trip completo sin cálculo al recuperar", async (item) => {
    const scope=item.scope ? scoped(item.scope) : undefined
    const controller=await completed(item.patch,scope,"conditioned" in item && item.conditioned)
    try {
      const original=controller.getState(), snapshot=captureSnapshot(controller,fixtures.length+1,item.auto)
      const payload=encodeFiscalSnapshot(snapshot), recovered=decodeFiscalSnapshot(payload)
      expect(recovered).toEqual(snapshot)
      expect(recovered.outcome).toEqual(original.outcome)
      expect(recovered.capture).toEqual(original.snapshot)
      expect(recovered.execution.referenceMode).toBe(item.auto ? "automatic":"manual")
      expect(recovered.versions.engine).toBe(storageBuildIdentity.engineVersion)
      expect(recovered.fiscalPackage.sha256).toHaveLength(64)
      expect(Object.isFrozen(recovered.outcome.report)).toBe(true)
      expect(controller.getState()).toBe(original)
      fixtures.push({name:item.name,payload})
    } finally {controller.dispose()}
  },20000)
  it("null permanece desconocido y cero calculado conserva 0.00",async()=>{
    const controller=await completed({includeImss:false})
    try {const snapshot=captureSnapshot(controller);expect(snapshot.outcome.presentation.values.integratedVariableIncome).toBeNull();expect(snapshot.outcome.presentation.values.workerImss).toBe("0.00");expect(snapshot.capture.form.amount).toBe("00015000.50")}finally{controller.dispose()}
  })
  it("editar, cancelar o limpiar invalida un estado completado anterior",async()=>{
    const controller=await completed(), old=controller.getState(), execution=metadata(old)
    controller.edit(old.snapshot!)
    expect(()=>createStoredFiscalSnapshot({getCurrentState:controller.getState,expectedRequestId:old.requestId,executionId:testExecutionId(90),execution})).toThrow("STALE_OR_INCOMPLETE")
    controller.clear()
    expect(()=>createStoredFiscalSnapshot({getCurrentState:controller.getState,expectedRequestId:old.requestId,executionId:testExecutionId(90),execution})).toThrow()
    controller.dispose()
  })
  it("resultado bloqueado no se guarda como simulación completa",async()=>{
    const controller=await completed({amount:"9451.19"})
    try{expect(()=>captureSnapshot(controller)).toThrow("UNUSABLE")}finally{controller.dispose()}
  })
  it.each(["calculating","cancelled","error"] as const)("%s no reutiliza un outcome anterior para producir un histórico",async phase=>{
    const controller=await completed(),old=controller.getState()
    try {
      expect(()=>createStoredFiscalSnapshot({getCurrentState:()=>({...old,phase}),expectedRequestId:old.requestId,executionId:testExecutionId(92),execution:metadata(old)})).toThrow("STALE_OR_INCOMPLETE_EXECUTION")
    } finally {controller.dispose()}
  })
  it("metadata de otro request o paquete se rechaza",async()=>{
    const controller=await completed(),state=controller.getState()
    try {
      const input={getCurrentState:controller.getState,expectedRequestId:state.requestId,executionId:testExecutionId(91),execution:{...metadata(state),requestId:state.requestId+1}}
      expect(()=>createStoredFiscalSnapshot(input)).toThrow("STALE")
      expect(()=>createStoredFiscalSnapshot({...input,execution:{...metadata(state),packageId:"otro"}})).toThrow("PACKAGE_MISMATCH")
    }finally{controller.dispose()}
  })
  it("IDs estables deben ser UUID y no se reemplazan en cada intento",async()=>{
    const controller=await completed()
    try{const a=captureSnapshot(controller),b=captureSnapshot(controller);expect(encodeFiscalSnapshot(a)).toBe(encodeFiscalSnapshot(b));expect(()=>createStoredFiscalSnapshot({getCurrentState:controller.getState,expectedRequestId:controller.getState().requestId,executionId:"1",execution:metadata(controller.getState())})).toThrow()}finally{controller.dispose()}
  })
})

describe("cliente Tauri específico, sin auto-guardado",()=>{
  it("crear el cliente no abre la base ni escribe datos",()=>{
    const invoke=vi.fn();createNativeStorageApi(invoke)
    expect(invoke).not.toHaveBeenCalled();expect(initialLocalPreferences).toEqual({theme:"light",historyAutoSave:false})
  })
  it("no renueva automáticamente una escritura invalidada por borrado",async()=>{
    const invoke=vi.fn().mockRejectedValue({code:"STALE_GENERATION",message:"Generación anterior",retryable:false})
    const api=createNativeStorageApi(invoke)
    const snapshot=decodeFiscalSnapshot(fixtures[0].payload)
    await expect(api.insert({generation:testExecutionId(44)},snapshot)).rejects.toMatchObject({code:"STALE_GENERATION"})
    expect(invoke).toHaveBeenCalledTimes(1);expect(invoke.mock.calls[0][0]).toBe("storage_insert")
  })
  it("get devuelve el original y nunca llama al adaptador",async()=>{
    const invoke=vi.fn().mockResolvedValue(fixtures[0].payload),api=createNativeStorageApi(invoke)
    expect(await api.get(testExecutionId(1))).toEqual(decodeFiscalSnapshot(fixtures[0].payload))
    expect(invoke).toHaveBeenCalledExactlyOnceWith("storage_get",{executionId:testExecutionId(1)})
  })
  it("errores nativos son tipados, sin convertir fallo en éxito",async()=>{
    const api=createNativeStorageApi(vi.fn().mockRejectedValue({code:"CORRUPT_DATABASE",message:"Base dañada",retryable:false}))
    await expect(api.info()).rejects.toBeInstanceOf(LocalStorageFailure)
  })
  it("5B.8 conecta Historial mediante su coordinador sin comandos de almacenamiento en App",()=>{
    const app=readFileSync(fileURLToPath(new URL("../../app/App.tsx",import.meta.url)),"utf8")
    expect(app).not.toMatch(/features\/storage|storage_insert|createNativeStorageApi/)
    expect(app).toContain("createHistoryController")
    expect(app).toContain("localHistory.beginRun(state.requestId)")
    expect(app).toContain("localHistory.finishRun(current.getState,state.requestId,next)")
  })
})
afterAll(()=>{
  if(fixtures.length!==6)throw new Error("Faltan fixtures fiscales reales para las pruebas nativas")
  writeFileSync(fileURLToPath(new URL("../../../src-tauri/src/storage/fixtures.json",import.meta.url)),JSON.stringify(fixtures,null,2)+"\n")
})
