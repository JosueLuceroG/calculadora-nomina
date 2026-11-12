import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "@/app/App"
import { createNativeStorageApi } from "@/features/storage/storage-api"
import { decodeFiscalSnapshot, encodeFiscalSnapshot } from "@/features/storage/snapshot"
import fixtures from "../../src-tauri/src/storage/fixtures.json"
import "@/app/styles.css"
if (!import.meta.env.DEV) throw new Error("Entrada exclusiva de verificación.")
const verification = { api:createNativeStorageApi(), fixtures,
  async save(index:number,generation:string) {return this.api.insert({generation},decodeFiscalSnapshot(fixtures[index].payload))},
  async matches(index:number) {const expected=decodeFiscalSnapshot(fixtures[index].payload);const restored=await this.api.get(expected.executionId);return restored!==null && encodeFiscalSnapshot(restored)===fixtures[index].payload},
}
declare global {interface Window {__storageVerification:typeof verification}}
window.__storageVerification=verification
createRoot(document.getElementById("root")!).render(<StrictMode><App/></StrictMode>)
