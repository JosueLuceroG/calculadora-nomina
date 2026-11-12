param([Parameter(Mandatory=$true)][string]$CandidatePath,[Parameter(Mandatory=$true)][string]$LogPath)
$ErrorActionPreference = 'Stop'
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    Start-Transcript -LiteralPath $LogPath
    node scripts/check-real-upgrade.mjs $CandidatePath
    if ($LASTEXITCODE -ne 0) { throw "Upgrade verification failed: $LASTEXITCODE" }
} finally {
    Stop-Transcript
    Pop-Location
}
