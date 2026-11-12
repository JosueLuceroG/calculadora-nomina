export const STORAGE_CODEC = "nomina-json-v1" as const
const tag = "$nomina"
type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** Dinero permanece cadena. Los BigInt, si aparecen fuera de campos monetarios,
 * tienen etiqueta explícita; los objetos que ya contienen esa etiqueta se escapan. */
export function serializeStorageValue(value: unknown): string {
  const active = new WeakSet<object>()
  function encode(v: unknown, depth: number): Json {
    if (depth > 96) throw new Error("SNAPSHOT_TOO_DEEP")
    if (v === null || typeof v === "string" || typeof v === "boolean") return v
    if (typeof v === "number") {
      if (!Number.isFinite(v) || (Number.isInteger(v) && !Number.isSafeInteger(v)) || Object.is(v, -0)) throw new Error("UNSAFE_JSON_NUMBER")
      return v
    }
    if (typeof v === "bigint") return { [tag]: "bigint-v1", value: v.toString() }
    if (typeof v !== "object" || !v) throw new Error("UNSUPPORTED_STORAGE_VALUE")
    if (active.has(v)) throw new Error("CYCLIC_STORAGE_VALUE")
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw new Error("UNSUPPORTED_STORAGE_OBJECT")
    active.add(v)
    try {
      if (Array.isArray(v)) {
        for (let i=0;i<v.length;i++) if (!Object.hasOwn(v,i)) throw new Error("SPARSE_STORAGE_ARRAY")
        return v.map(item => encode(item, depth + 1))
      }
      if (Reflect.ownKeys(v).length !== Object.keys(v).length) throw new Error("UNSUPPORTED_STORAGE_PROPERTY")
      const entries = Object.keys(v).sort().map(key => [key, encode((v as Record<string, unknown>)[key], depth + 1)] as const)
      return Object.hasOwn(v, tag) ? { [tag]: "escaped-object-v1", entries: entries.map(([key, item]) => [key, item]) } : Object.fromEntries(entries)
    } finally { active.delete(v) }
  }
  return JSON.stringify({ codec: STORAGE_CODEC, value: encode(value, 0) })
}

export function deserializeStorageValue(text: string): unknown {
  const envelope = JSON.parse(text) as Record<string, unknown>
  if (!envelope || envelope.codec !== STORAGE_CODEC || Object.keys(envelope).sort().join() !== "codec,value") throw new Error("UNSUPPORTED_STORAGE_CODEC")
  function decode(v: Json, depth: number): unknown {
    if (depth > 96) throw new Error("SNAPSHOT_TOO_DEEP")
    if (v === null || typeof v !== "object") {
      if (typeof v === "number" && (!Number.isFinite(v) || (Number.isInteger(v) && !Number.isSafeInteger(v)) || Object.is(v, -0))) throw new Error("UNSAFE_JSON_NUMBER")
      return v
    }
    if (Array.isArray(v)) return v.map(item => decode(item, depth + 1))
    if (Object.hasOwn(v, tag)) {
      if (v[tag] === "bigint-v1" && Object.keys(v).sort().join() === "$nomina,value" && typeof v.value === "string" && /^(?:0|-?[1-9]\d*)$/.test(v.value)) return BigInt(v.value)
      if (v[tag] === "escaped-object-v1" && Object.keys(v).sort().join() === "$nomina,entries" && Array.isArray(v.entries)) {
        const keys = new Set<string>()
        return Object.fromEntries(v.entries.map(entry => {
          if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || keys.has(entry[0])) throw new Error("INVALID_ESCAPED_OBJECT")
          keys.add(entry[0]); return [entry[0], decode(entry[1], depth + 1)]
        }))
      }
      throw new Error("INVALID_STORAGE_TAG")
    }
    return Object.fromEntries(Object.entries(v).map(([key, item]) => [key, decode(item, depth + 1)]))
  }
  return decode(envelope.value as Json, 0)
}

export function freezeStorageValue<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freezeStorageValue); Object.freeze(value) }
  return value
}
