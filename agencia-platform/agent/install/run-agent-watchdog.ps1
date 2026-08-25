param([Parameter(Mandatory = $true)][string]$AgentRoot)

$ErrorActionPreference = "Continue"
$agentEntry = Join-Path $AgentRoot "dist\index.js"
$logDir = Join-Path $env:LOCALAPPDATA "NegocioVivoBankAgent"
$logFile = Join-Path $logDir "watchdog.log"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

while ($true) {
  if (-not (Test-Path -LiteralPath $agentEntry)) {
    Add-Content -LiteralPath $logFile -Value "$(Get-Date -Format o) dist/index.js no existe; reintento en 60 s"
    Start-Sleep -Seconds 60
    continue
  }
  Add-Content -LiteralPath $logFile -Value "$(Get-Date -Format o) iniciando agente"
  Push-Location -LiteralPath $AgentRoot
  try {
    & node --use-system-ca $agentEntry
    $exitCode = $LASTEXITCODE
  } catch {
    $exitCode = -1
    Add-Content -LiteralPath $logFile -Value "$(Get-Date -Format o) error: $($_.Exception.Message)"
  } finally {
    Pop-Location
  }
  Add-Content -LiteralPath $logFile -Value "$(Get-Date -Format o) agente detenido (código $exitCode); reinicio en 10 s"
  Start-Sleep -Seconds 10
}
