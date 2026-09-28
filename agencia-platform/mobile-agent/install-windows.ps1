$ErrorActionPreference = 'Stop'
$source = $PSScriptRoot
$runtime = Join-Path $source 'node_modules\electron\dist'
if (!(Test-Path -LiteralPath (Join-Path $runtime 'electron.exe'))) {
  throw 'Falta el runtime. Ejecuta npm ci en mobile-agent antes de instalar.'
}
$destination = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs\NegocioVivoMoviles'
if (Get-Process -Name NegocioVivoMoviles -ErrorAction SilentlyContinue) {
  throw 'Cierra el agente desde su icono de bandeja antes de actualizarlo.'
}
New-Item -ItemType Directory -Force -Path $destination | Out-Null
Get-ChildItem -LiteralPath $runtime | Copy-Item -Destination $destination -Recurse -Force
$executable = Join-Path $destination 'NegocioVivoMoviles.exe'
Copy-Item -LiteralPath (Join-Path $runtime 'electron.exe') -Destination $executable -Force
$appDirectory = Join-Path $destination 'resources\app'
New-Item -ItemType Directory -Force -Path $appDirectory | Out-Null
foreach ($file in @('package.json', 'main.cjs', 'access-policy.cjs', 'icon.png')) {
  Copy-Item -LiteralPath (Join-Path $source $file) -Destination $appDirectory -Force
}
$shell = New-Object -ComObject WScript.Shell
foreach ($folder in @('Desktop', 'Startup')) {
  $shortcutPath = Join-Path ([Environment]::GetFolderPath($folder)) 'Negocio Vivo Moviles.lnk'
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $executable
  $shortcut.WorkingDirectory = $destination
  $shortcut.Description = 'Ejecutor de móviles del Hub Negocio Vivo'
  if ($folder -eq 'Startup') { $shortcut.Arguments = '--hidden' }
  $shortcut.Save()
}
Write-Output "Agente instalado: $executable"
Write-Output 'Inicio automático configurado al iniciar sesión en Windows.'
