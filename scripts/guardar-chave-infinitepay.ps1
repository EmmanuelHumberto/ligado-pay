param([switch]$Substituir)
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Este comando exige Windows e DPAPI.' }
$taskDirectory = Join-Path $env:LOCALAPPDATA 'LigadoTattoo\LigadoPay'
$taskPath = Join-Path $taskDirectory 'infinitepay.dpapi'
if ((Test-Path -LiteralPath $taskPath) -and -not $Substituir) {
  throw 'Já existe uma chave protegida. Para rotação intencional use -Substituir.'
}
New-Item -ItemType Directory -Path $taskDirectory -Force | Out-Null
$taskSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $taskDirectory /inheritance:r /grant:r "*$($taskSid):(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível proteger o diretório.' }
$taskSecret = Read-Host 'Cole a API Key InfinitePay (entrada oculta; não envie pelo chat)' -AsSecureString
$taskPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecret)
try {
  $taskPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPointer)
  if ($taskPlain -notmatch '^inchk_[A-Za-z0-9_-]{16,240}$') {
    throw 'Formato da chave não corresponde ao formato documentado. Nenhum arquivo foi gravado.'
  }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPointer)
  $taskPlain = $null
}
$taskCipher = ConvertFrom-SecureString -SecureString $taskSecret
[IO.File]::WriteAllText($taskPath, $taskCipher, [Text.UTF8Encoding]::new($false))
& icacls.exe $taskPath /inheritance:r /grant:r "*$($taskSid):F" '*S-1-5-18:F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível verificar a proteção do arquivo.' }
$taskSecret.Dispose()
Write-Output 'Chave protegida com DPAPI do usuário atual. Nenhuma chamada à InfinitePay foi realizada.'
Write-Output "Arquivo: $taskPath"
