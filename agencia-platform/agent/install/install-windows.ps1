# Instalador del agente bancario LOCAL de Negocio Vivo para Windows.
#
#   powershell -ExecutionPolicy Bypass -File install\install-windows.ps1
#
# Qué hace:
#   1. Comprueba Node.js (>=18) y lo indica si falta.
#   2. Instala dependencias (npm ci / npm install) y el navegador de Playwright.
#   3. Crea .env a partir de .env.example si no existe (para que pongas HUB_URL y AGENT_TOKEN).
#   4. Opcional: crea una tarea programada de auto-arranque al iniciar sesión.
#
# NO configura credenciales del banco: el agente no las usa.

param(
  [switch]$AutoStart
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "== Instalador del agente bancario Negocio Vivo =="

# 1) Node
try {
  $nodev = (& node --version)
  Write-Host "Node detectado: $nodev"
} catch {
  Write-Error "Node.js no está instalado. Instala Node 18+ desde https://nodejs.org y reejecuta."
  exit 1
}

# 2) Dependencias
if (Test-Path "package-lock.json") { npm ci } else { npm install }
Write-Host "Instalando navegador de Playwright (Chromium para playwright-core)…"
npx playwright install chromium

# 3) .env
if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Creado .env — EDÍTALO y pon HUB_URL y AGENT_TOKEN (enrola el agente en el HUB)."
} else {
  Write-Host ".env ya existe; no se sobrescribe."
}

# Restringe permisos del .env al usuario actual (defensa: contiene el token del agente).
try {
  icacls ".env" /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
  Write-Host "Permisos de .env restringidos al usuario actual."
} catch { Write-Warning "No se pudieron restringir permisos de .env: $_" }

# 4) Auto-arranque opcional (tarea programada al iniciar sesión).
if ($AutoStart) {
  $node = (Get-Command node).Source
  $entry = Join-Path $root "src\index.ts"
  # En producción se recomienda 'npm run build' y usar dist\index.js; aquí usamos tsx para simplicidad.
  $action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c cd /d `"$root`" && npx tsx src/index.ts"
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName "NegocioVivoBankAgent" -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
  Write-Host "Tarea programada 'NegocioVivoBankAgent' creada (auto-arranque al iniciar sesión)."
  Write-Host "Recuerda: el agente necesita tu Chrome abierto con start-chrome.ps1 y tu sesión de Santander iniciada."
}

Write-Host ""
Write-Host "Instalación completada."
Write-Host "Siguientes pasos:"
Write-Host "  1) Edita .env con HUB_URL y AGENT_TOKEN."
Write-Host "  2) Ejecuta: npm run doctor   (comprueba conexión y token, sin operar)."
Write-Host "  3) Abre Chrome:  powershell -ExecutionPolicy Bypass -File install\start-chrome.ps1"
Write-Host "  4) Mapea el portal (sesión real supervisada):  npm run record"
Write-Host "  5) Arranca en pruebas:  npm run dev   (SANTANDER_MODE=mock)"
