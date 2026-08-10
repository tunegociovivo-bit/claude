param([Parameter(Mandatory = $true)][string]$CredentialFile)
$ErrorActionPreference = "Stop"
$secure = Get-Content -LiteralPath $CredentialFile -Raw | ConvertTo-SecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr))
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}
