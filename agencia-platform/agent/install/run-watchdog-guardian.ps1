param(
  [string]$TaskName = "NegocioVivoBankAgentWatchdog",
  [int]$CheckSeconds = 30
)

$ErrorActionPreference = "Continue"
$mutex = New-Object System.Threading.Mutex($false, "Local\NegocioVivoBankAgentGuardian")
$ownsMutex = $false
try { $ownsMutex = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $ownsMutex = $true }
if (-not $ownsMutex) { exit 0 }

$logDir = Join-Path $env:LOCALAPPDATA "NegocioVivoBankAgent"
$logFile = Join-Path $logDir "guardian.log"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

try {
  while ($true) {
    try {
      $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
      if ($task.State -ne "Running") {
        Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
        Add-Content -LiteralPath $logFile -Value "$(Get-Date -Format o) supervisor reiniciado"
      }
    } catch {
      Add-Content -LiteralPath $logFile -Value "$(Get-Date -Format o) no se pudo verificar/reiniciar el supervisor: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds ([Math]::Max(10, $CheckSeconds))
  }
} finally {
  if ($ownsMutex) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
