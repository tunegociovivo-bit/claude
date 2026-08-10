param([Parameter(Mandatory = $true)][string]$CredentialFile)
$ErrorActionPreference = "Stop"
$encrypted = (Get-Content -LiteralPath $CredentialFile -Raw).Trim()
$secure = $encrypted | ConvertTo-SecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr))
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}
