$ErrorActionPreference = "Stop"
$directory = Join-Path $env:LOCALAPPDATA "NegocioVivoBankAgent"
$credentialFile = Join-Path $directory "santander-access-key.dpapi"
$usernameFile = Join-Path $directory "santander-user.dpapi"
New-Item -ItemType Directory -Path $directory -Force | Out-Null

Write-Host "Configuración local de Santander para el agente Negocio Vivo"
Write-Host "El usuario y la clave se cifran para este usuario de Windows y no se envían al HUB."

$username = (Read-Host "Introduce el usuario de Santander Empresas").Trim()
if (-not $username -or $username.Length -gt 80 -or $username -match '\s') {
  throw "El usuario no es válido."
}
$usernameSecure = ConvertTo-SecureString $username -AsPlainText -Force
$username = $null
$usernameEncrypted = $usernameSecure | ConvertFrom-SecureString
Set-Content -LiteralPath $usernameFile -Value $usernameEncrypted -Encoding ASCII -NoNewline

$secure = Read-Host "Introduce la clave de acceso de 8 caracteres" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  if ($plain.Length -ne 8 -or $plain -match '\s') {
    throw "La clave debe tener exactamente 8 caracteres y no contener espacios."
  }
} finally {
  $plain = $null
  if ($ptr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}
$encrypted = $secure | ConvertFrom-SecureString
Set-Content -LiteralPath $credentialFile -Value $encrypted -Encoding ASCII -NoNewline

foreach ($file in @($usernameFile, $credentialFile)) {
  $acl = Get-Acl -LiteralPath $file
  $acl.SetAccessRuleProtection($true, $false)
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($env:USERNAME, "FullControl", "Allow")
  $acl.SetAccessRule($rule)
  Set-Acl -LiteralPath $file -AclObject $acl
}

Write-Host "Usuario y clave cifrados guardados correctamente. Ya puedes cerrar esta ventana."
