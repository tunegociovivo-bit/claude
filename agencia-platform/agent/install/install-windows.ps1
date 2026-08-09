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
  $taskArgument = '/c cd /d "' + $agentRoot + '" && node dist/index.js'
  $action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument $taskArgument
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName "NegocioVivoBankAgent" -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
  Write-Host "Scheduled task NegocioVivoBankAgent installed."
}

Write-Host "Installation completed."
