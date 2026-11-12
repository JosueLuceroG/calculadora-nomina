param([Parameter(Mandatory=$true)][string]$LogPath)
$ErrorActionPreference = 'Stop'
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    Start-Transcript -LiteralPath $LogPath
    npm run build:installer:test 2>&1 | Tee-Object -FilePath ($LogPath + '.output.txt')
    if ($LASTEXITCODE -ne 0) { throw "Installer build failed: $LASTEXITCODE" }
} finally {
    Stop-Transcript
    Pop-Location
}
