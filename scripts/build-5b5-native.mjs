// Build debug necesario para la apertura de documentos en WebView2. Respalda el
// ejecutable encontrado y registra antes/después; no crea release ni instalador.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
const root = fileURLToPath(new URL("../", import.meta.url))
const out = join(root, "docs/evidence/5b5")
const recordPath = join(out, "native-debug-build.json")
assert(!existsSync(recordPath), "No sobrescribir evidencia del artefacto encontrado")
assert.equal(execFileSync("pwsh", ["-NoProfile", "-Command", "@(Get-Process -Name 'calculadora-nomina' -ErrorAction SilentlyContinue).Count"], { encoding: "utf8" }).trim(), "0", "Cerrar solo la instancia propia antes de compilar")
const exe = join(root, "src-tauri/target/debug/calculadora-nomina.exe")
const backupFolder = join(tmpdir(), "opencode", "calculadora-nomina-verification", "5b5-native-backup")
mkdirSync(backupFolder, { recursive: true })
const backup = join(backupFolder, "calculadora-nomina-before-5b5.exe")
assert(!existsSync(backup), "No sobrescribir respaldo existente")
const sha = path => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase()
const before = sha(exe)
copyFileSync(exe, backup)
assert.equal(sha(backup), before)
writeFileSync(recordPath, JSON.stringify({ startedOn: new Date().toISOString(), beforeSha256: before, backup, status: "building" }, null, 2))
try {
  execFileSync("cargo", ["build", "--manifest-path", "src-tauri/Cargo.toml"], { cwd: root, stdio: "inherit", timeout: 300000 })
  const result = { completedOn: new Date().toISOString(), command: 'cargo build --manifest-path "src-tauri/Cargo.toml"', beforeSha256: before, backup, afterSha256: sha(exe), status: "passed", kind: "debug-development-with-vite-no-installer" }
  writeFileSync(recordPath, JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  writeFileSync(recordPath, JSON.stringify({ beforeSha256: before, backup, status: "failed", error: error.message }, null, 2))
  throw error
}
