# Arranca el Chrome visible y dedicado que controla el agente bancario.
param(
  [int]$Port = 9222,
  [string]$UserDataDir = "$env:LOCALAPPDATA\NVAgentChrome"
)

$ErrorActionPreference = "Stop"
$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $chrome) { throw "No se encontro Google Chrome" }

$resolvedProfile = [System.IO.Path]::GetFullPath($UserDataDir)
if (-not $resolvedProfile.EndsWith("NVAgentChrome", [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "El perfil bancario debe ser NVAgentChrome"
}
if (-not (Test-Path -LiteralPath $resolvedProfile)) {
  New-Item -ItemType Directory -Path $resolvedProfile | Out-Null
}

Start-Process -FilePath $chrome -ArgumentList @(
  "--remote-debugging-port=$Port",
  "--user-data-dir=$resolvedProfile",
  "https://empresas3.gruposantander.es"
) -WindowStyle Normal

$readyBy = (Get-Date).AddSeconds(20)
do {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2
    if ($response.StatusCode -eq 200) { exit 0 }
  } catch {}
  Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $readyBy)

throw "Chrome no abrio el puerto CDP $Port"
