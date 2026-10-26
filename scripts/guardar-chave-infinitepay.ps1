param([switch]$Substituir, [switch]$ValidarApenas, [switch]$DaAreaDeTransferencia, [string]$DoArquivo)
$ErrorActionPreference = 'Stop'
if ($DaAreaDeTransferencia -and $DoArquivo) { throw 'Escolha apenas uma origem para a chave.' }
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Este comando exige Windows e DPAPI.' }
$taskDirectory = Join-Path $env:LOCALAPPDATA 'LigadoTattoo\LigadoPay'
$taskPath = Join-Path $taskDirectory 'infinitepay.dpapi'
if (-not $ValidarApenas -and (Test-Path -LiteralPath $taskPath) -and -not $Substituir) {
  throw 'Ja existe uma chave protegida. Para rotacao intencional use -Substituir.'
}
$taskPolicy = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\contracts\infinitepay-credential-policy.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$taskSecret = $null
$taskPointer = [IntPtr]::Zero
$taskNormalized = $null
$taskPlain = $null
try {
  if ($DoArquivo) {
    try { $taskPlain = [IO.File]::ReadAllText([IO.Path]::GetFullPath($DoArquivo), [Text.Encoding]::UTF8) }
    catch { throw 'Nao foi possivel ler o arquivo de entrada. Nenhum segredo foi gravado.' }
  } elseif ($DaAreaDeTransferencia) {
    try { $taskPlain = [string](Get-Clipboard -Raw -ErrorAction Stop) }
    catch { throw 'Nao foi possivel ler texto da area de transferencia. Nenhum arquivo foi gravado.' }
  } else {
    $taskSecret = Read-Host 'Cole a API Key InfinitePay (entrada oculta; nao envie pelo chat)' -AsSecureString
    $taskPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecret)
    $taskPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPointer)
  }
  $taskPlain = $taskPlain.Trim()
  if (-not $taskPlain -or $taskPlain.Length -gt $taskPolicy.maxLength -or $taskPlain -notmatch $taskPolicy.pattern) {
    $taskWhitespace = [regex]::Matches($taskPlain, '\s').Count
    $taskControl = [regex]::Matches($taskPlain, '[\x00-\x1F\x7F]').Count
    $taskNonAscii = [regex]::Matches($taskPlain, '[^\x00-\x7F]').Count
    Write-Output "Diagnostico sem segredo: tamanho=$($taskPlain.Length); limite=$($taskPolicy.maxLength); espacos=$taskWhitespace; controles=$taskControl; foraASCII=$taskNonAscii."
    throw 'Entrada vazia, longa demais ou com caracteres nao permitidos. Nenhum arquivo foi gravado.'
  }
  $taskNormalized = ConvertTo-SecureString -String $taskPlain -AsPlainText -Force
  $taskCipher = ConvertFrom-SecureString -SecureString $taskNormalized
} finally {
  if ($taskPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPointer) }
  if ($taskNormalized) { $taskNormalized.Dispose() }
  if ($taskSecret) { $taskSecret.Dispose() }
  $taskPlain = $null
}
if ($ValidarApenas) {
  Write-Output 'Sintaxe aceita. Nenhum arquivo gravado e nenhuma chamada ao provedor realizada.'
  return
}
New-Item -ItemType Directory -Path $taskDirectory -Force | Out-Null
$taskSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $taskDirectory /inheritance:r /grant:r "*$($taskSid):(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel proteger o diretorio.' }
[IO.File]::WriteAllText($taskPath, $taskCipher, [Text.UTF8Encoding]::new($false))
& icacls.exe $taskPath /inheritance:r /grant:r "*$($taskSid):F" '*S-1-5-18:F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel verificar a protecao do arquivo.' }
Write-Output 'Chave protegida com DPAPI do usuario atual. Nenhuma chamada a InfinitePay foi realizada.'
Write-Output "Arquivo: $taskPath"
