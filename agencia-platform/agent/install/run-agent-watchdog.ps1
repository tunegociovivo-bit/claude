param(
  [Parameter(Mandatory = $true)][string]$AgentRoot,
  [string]$AgentEntry = ""
)

$ErrorActionPreference = "Continue"
$agentEntry = if ($AgentEntry) { $AgentEntry } else { Join-Path $AgentRoot "dist\index.js" }
$logDir = Join-Path $env:LOCALAPPDATA "NegocioVivoBankAgent"
$logFile = Join-Path $logDir "watchdog.log"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

# The task scheduler also uses IgnoreNew. This mutex additionally prevents a
# manual watchdog launch from creating a competing process.
$mutex = New-Object System.Threading.Mutex($false, "Local\NegocioVivoBankAgentWatchdog")
$ownsMutex = $false
try {
  $ownsMutex = $mutex.WaitOne(0)
} catch [System.Threading.AbandonedMutexException] {
  $ownsMutex = $true
}
if (-not $ownsMutex) { exit 0 }

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
$restartDelay = 5

try {
  while ($true) {
    if (-not $node) {
      Add-Content -LiteralPath $logFile -Value "$(Get-Date -Format o) node no disponible; reintento en 60 s"
      Start-Sleep -Seconds 60
      $node = (Get-Command node -ErrorAction SilentlyContinue).Source
      continue
    }
    if (-not (Test-Path -LiteralPath $agentEntry)) {
      Add-Content -LiteralPath $logFile -Value "$(Get-Date -Format o) dist/index.js no existe; reintento en 60 s"
      Start-Sleep -Seconds 60
      continue
    }

    Add-Content -LiteralPath $logFile -Value "$(Get-Date -Format o) iniciando agente"
    $startedAt = Get-Date
    Push-Location -LiteralPath $AgentRoot
    try {
      & $node --use-system-ca $agentEntry
      $exitCode = $LASTEXITCODE
    } catch {
      $exitCode = -1
      Add-Content -LiteralPath $logFile -Value "$(Get-Date -Format o) error: $($_.Exception.Message)"
    } finally {
      Pop-Location
    }
    if (((Get-Date) - $startedAt).TotalSeconds -ge 60) { $restartDelay = 5 }
    Add-Content -LiteralPath $logFile -Value "$(Get-Date -Format o) agente detenido (codigo $exitCode); reinicio en $restartDelay s"
    Start-Sleep -Seconds $restartDelay
    $restartDelay = [Math]::Min(60, $restartDelay * 2)
  }
} finally {
  if ($ownsMutex) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
