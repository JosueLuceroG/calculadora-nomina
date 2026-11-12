param([Parameter(Mandatory=$true)][string]$InstallerPath,[Parameter(Mandatory=$true)][string]$LogPath,[string]$MaintenanceSource)
$ErrorActionPreference = 'Stop'
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    Start-Transcript -LiteralPath $LogPath
    if ($MaintenanceSource) {
        node scripts/check-local-installer.mjs $InstallerPath --maintenance-only $MaintenanceSource
    } else {
        node scripts/check-local-installer.mjs $InstallerPath
    }
    if ($LASTEXITCODE -ne 0) { throw "Installed verification failed: $LASTEXITCODE" }
} finally {
    Stop-Transcript
    Pop-Location
}
