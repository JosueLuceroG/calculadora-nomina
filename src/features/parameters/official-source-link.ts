type NativeSourceRuntime = { invoke: (command: string, args: { url: string }) => Promise<unknown> }

/** Puente mínimo al runtime existente; no instala SDK/plugin ni abre nada al
 * renderizar. Solo se obtiene y ejecuta desde el clic explícito del enlace. */
export function nativeOfficialSourceOpener(): ((url: string) => Promise<void>) | undefined {
  if (typeof window === "undefined") return undefined
  const runtime = (window as Window & { __TAURI_INTERNALS__?: NativeSourceRuntime }).__TAURI_INTERNALS__
  if (!runtime) return undefined
  return async url => { await runtime.invoke("open_official_source", { url }) }
}
