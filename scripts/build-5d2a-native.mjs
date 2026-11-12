import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
const root = fileURLToPath(new URL("../", import.meta.url))
const exe = join(root, "src-tauri/target/debug/calculadora-nomina.exe")
const folder = join(tmpdir(), "opencode/5d2a-native-backup"), backup = join(folder, "before-5d2a.exe")
const sha = path => createHash("sha256").update(readFileSync(path)).digest("hex")
assert.equal(execFileSync("pwsh", ["-NoProfile", "-Command", "@(Get-Process -Name 'calculadora-nomina' -ErrorAction SilentlyContinue).Count"], { encoding: "utf8" }).trim(), "0", "Close the existing application before rebuilding")
mkdirSync(folder, { recursive: true })
if (!existsSync(backup)) copyFileSync(exe, backup)
execFileSync("npm.cmd", ["run", "tauri", "--", "build", "--debug", "--no-bundle"], { cwd: root, stdio: "inherit", shell: true, timeout: 360000 })
const report = { checkedOn: new Date().toISOString(), kind: "debug-integrated-assets-no-release-no-installer", backup, beforeSha256: sha(backup), afterSha256: sha(exe) }
writeFileSync(join(root, "docs/evidence/5d2a/native-build.json"), JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify(report))
