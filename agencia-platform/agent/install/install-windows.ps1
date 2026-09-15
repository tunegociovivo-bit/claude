param([switch]$AutoStart)

$ErrorActionPreference = "Stop"
$agentRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $agentRoot

Write-Host "Installing Negocio Vivo bank agent"
$nodeVersion = & node --version
Write-Host "Node: $nodeVersion"

if (Test-Path -LiteralPath "package-lock.json") { & npm ci } else { & npm install }
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

if (-not (Test-Path -LiteralPath ".env")) {
  Copy-Item -LiteralPath ".env.example" -Destination ".env"
  Write-Host "Created .env; configure HUB_URL and AGENT_TOKEN before starting."
}

$aclGrant = $env:USERNAME + ':(F)'
& icacls ".env" "/inheritance:r" "/grant:r" $aclGrant | Out-Null

& npm run build
if ($LASTEXITCODE -ne 0) { throw "Agent build failed" }

if ($AutoStart) {
  $watchdog = Join-Path $PSScriptRoot "run-agent-watchdog.ps1"
  $taskArgument = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $watchdog + '" -AgentRoot "' + $agentRoot + '"'
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $taskArgument
  $logonTrigger = New-ScheduledTaskTrigger -AtLogOn
  $recoveryTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName "NegocioVivoBankAgentWatchdog" -Action $action -Trigger @($logonTrigger, $recoveryTrigger) -Settings $settings -Force | Out-Null
  Disable-ScheduledTask -TaskName "NegocioVivoBankAgent" -ErrorAction SilentlyContinue | Out-Null
  Start-ScheduledTask -TaskName "NegocioVivoBankAgentWatchdog"
  Write-Host "Scheduled task NegocioVivoBankAgentWatchdog installed with automatic recovery."
}

Write-Host "Installation completed."
