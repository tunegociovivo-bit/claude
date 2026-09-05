param(
  [int]$Port = 9222,
  [string]$UserDataDir = "$env:LOCALAPPDATA\NVAgentChrome"
)

$ErrorActionPreference = "Stop"
$resolvedProfile = [System.IO.Path]::GetFullPath($UserDataDir)
if (-not $resolvedProfile.EndsWith("NVAgentChrome", [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "El perfil a reiniciar no es NVAgentChrome"
}

$dedicated = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" | Where-Object {
  $_.CommandLine -and
  $_.CommandLine.IndexOf($resolvedProfile, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
}
foreach ($process in $dedicated) {
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}

$deadline = (Get-Date).AddSeconds(10)
while ((Get-Date) -lt $deadline) {
  $alive = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" | Where-Object {
    $_.CommandLine -and
    $_.CommandLine.IndexOf($resolvedProfile, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
  }
  if (-not $alive) { break }
  Start-Sleep -Milliseconds 250
}

$startScript = Join-Path $PSScriptRoot "start-chrome.ps1"
& $startScript -Port $Port -UserDataDir $resolvedProfile

$readyBy = (Get-Date).AddSeconds(20)
do {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2
    if ($response.StatusCode -eq 200) { exit 0 }
  } catch {}
  Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $readyBy)

throw "Chrome dedicado no recuperó el puerto CDP $Port"
