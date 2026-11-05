$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$app = Join-Path $env:ProgramW6432 'Bashkar POS'
$root = Join-Path $env:ProgramData 'BashkarPOS'
$env:BASHKAR_DATA_DIR = Join-Path $root 'data'
$env:BASHKAR_BACKUP_DIR = Join-Path $root 'backups'
$env:BASHKAR_SOFTWARE_VERSION = '0.1.0'
$node = Join-Path $app 'node.exe'
$cli = Join-Path $app 'server\backup-cli.js'
$created = & $node $cli create
if ($LASTEXITCODE -ne 0) { throw 'RECOVERY_SMOKE_CREATE_FAILED' }
$createdResult = $created | ConvertFrom-Json
if ($createdResult.event -ne 'backup-created-and-verified' -or $createdResult.operationId -notmatch '^[0-9a-f-]{36}$') { throw 'RECOVERY_SMOKE_CREATE_RESULT_INVALID' }
$env:BASHKAR_BACKUP_OPERATION_ID = $createdResult.operationId
$verified = & $node $cli verify
if ($LASTEXITCODE -ne 0) { throw 'RECOVERY_SMOKE_VERIFY_FAILED' }
$verifiedResult = $verified | ConvertFrom-Json
if ($verifiedResult.event -ne 'backup-verified' -or $verifiedResult.operationId -ne $createdResult.operationId -or $verifiedResult.verified -ne $true) { throw 'RECOVERY_SMOKE_VERIFY_RESULT_INVALID' }
$env:BASHKAR_RECOVERY_DISPOSABLE_TEST = '1'
try {
  $restored = & $node $cli restore-check
  if ($LASTEXITCODE -ne 0) { throw 'RECOVERY_SMOKE_RESTORE_FAILED' }
} finally { Remove-Item Env:BASHKAR_RECOVERY_DISPOSABLE_TEST -ErrorAction SilentlyContinue }
$restoredResult = $restored | ConvertFrom-Json
if ($restoredResult.event -ne 'backup-restore-checked' -or $restoredResult.operationId -ne $createdResult.operationId -or $restoredResult.state -ne 'NEEDS_ACTIVATION') { throw 'RECOVERY_SMOKE_RESTORE_RESULT_INVALID' }
foreach ($markerName in @('update-intent.json', 'update-guard.json')) {
  $marker = Join-Path $root "config\$markerName"
  [IO.File]::WriteAllText($marker, '{"operationId":"disposable-smoke"}', [Text.UTF8Encoding]::new($false))
  try {
    $server = Join-Path $app 'server\main.js'
    $start = [Diagnostics.ProcessStartInfo]::new($node, ('"{0}"' -f $server))
    $start.UseShellExecute = $false
    $start.RedirectStandardError = $true
    $start.CreateNoWindow = $true
    $child = [Diagnostics.Process]::Start($start)
    if (-not $child.WaitForExit(10000)) { $child.Kill(); throw 'RECOVERY_SMOKE_GUARD_TIMEOUT' }
    if ($child.ExitCode -eq 0 -or $child.StandardError.ReadToEnd() -notmatch 'UPDATE_GUARD_ACTIVE') { throw 'RECOVERY_SMOKE_GUARD_FAILED' }
  } finally { Remove-Item -LiteralPath $marker -Force }
}
$result = Join-Path $root 'backups\recovery-smoke-result.json'
[IO.File]::WriteAllText($result, (ConvertTo-Json -Compress @{ operationId = $createdResult.operationId; verified = $true; restored = $true; guardBlocked = $true }), [Text.UTF8Encoding]::new($false))
