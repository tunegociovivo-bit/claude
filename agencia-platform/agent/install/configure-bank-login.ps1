$ErrorActionPreference = "Stop"
$directory = Join-Path $env:LOCALAPPDATA "NegocioVivoBankAgent"
$credentialFile = Join-Path $directory "santander-access-key.dpapi"
New-Item -ItemType Directory -Path $directory -Force | Out-Null
Write-Host "Configuración local de Santander para el agente Negocio Vivo"
Write-Host "La clave se cifra para este usuario de Windows y no se envía al HUB."
$secure = Read-Host "Introduce la clave de acceso de 8 caracteres" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  if ($plain.Length -ne 8 -or $plain -match '\s') { throw "La clave debe tener exactamente 8 caracteres y no contener espacios." }
} finally {
  if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
$encrypted = $secure | ConvertFrom-SecureString
Set-Content -LiteralPath $credentialFile -Value $encrypted -Encoding ASCII -NoNewline
$acl = Get-Acl -LiteralPath $credentialFile
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($env:USERNAME, "FullControl", "Allow")
$acl.SetAccessRule($rule)
Set-Acl -LiteralPath $credentialFile -AclObject $acl
Write-Host "Clave cifrada guardada correctamente. Ya puedes cerrar esta ventana."
