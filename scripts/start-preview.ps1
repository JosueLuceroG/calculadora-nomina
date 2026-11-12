$ErrorActionPreference = 'Stop'
# Normal Tauri dev, with a fresh salary/profile sandbox accepted by the native
# debug guard. No QA fiscal feature or alternate fiscal source is enabled.
$base = Join-Path ([IO.Path]::GetTempPath()) 'opencode'
[void][IO.Directory]::CreateDirectory($base)
$env:NOMINA_STORAGE_TEST_ROOT = Join-Path $base ('5b7-v1-preview-' + [guid]::NewGuid().ToString())
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $env:NOMINA_STORAGE_TEST_ROOT 'webview'
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    npm run tauri -- dev
} finally {
    Pop-Location
}
