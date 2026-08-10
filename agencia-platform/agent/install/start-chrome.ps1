# Arranca tu Chrome VISIBLE con depuración remota (CDP) para que el agente pueda
# CONECTARSE a tu sesión. NO abre un navegador oculto ni headless. Tú sigues
# usando este Chrome con normalidad: aquí inicias sesión en Santander y firmas.
#
# Uso:  powershell -ExecutionPolicy Bypass -File install\start-chrome.ps1
#
# El perfil separado (NVAgentChrome) evita interferir con tu perfil habitual.

param(
  [int]$Port = 9222,
  [string]$UserDataDir = "$env:LOCALAPPDATA\NVAgentChrome"
)

$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $chrome) {
  Write-Error "No se encontró Chrome. Instálalo o edita la ruta en este script."
  exit 1
}

if (-not (Test-Path $UserDataDir)) { New-Item -ItemType Directory -Path $UserDataDir | Out-Null }

Write-Host "Abriendo Chrome con depuración remota en el puerto $Port…"
Write-Host "Inicia sesión TÚ en Santander Empresas en esta ventana. El agente solo la conducirá; nunca firma."
Start-Process -FilePath $chrome -ArgumentList "--remote-debugging-port=$Port", "--user-data-dir=$UserDataDir", "https://empresas3.gruposantander.es" -WindowStyle Normal
