param([Parameter(Mandatory=$true)][string]$Stage)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -cne 'S-1-5-18') { throw 'UPDATE_MANAGER_IDENTITY_INVALID' }
if (-not $env:ProgramW6432 -or -not $env:ProgramData) { throw 'UPDATE_WINDOWS_REQUIRED' }
$stagePath = [IO.Path]::GetFullPath($Stage).TrimEnd('\')
$name = [IO.Path]::GetFileName($stagePath)
if ($name -cmatch '^Bashkar POS\.incoming\.([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$') { $operationId = $Matches[1] }
else { throw 'UPDATE_STAGE_PATH_INVALID' }
$expected = Join-Path $env:ProgramW6432 $name
if ($stagePath -ine $expected) { throw 'UPDATE_STAGE_PATH_INVALID' }
$config = Join-Path $env:ProgramData 'BashkarPOS\config'
$journal = Get-Content -LiteralPath (Join-Path $config 'update-operation.json') -Raw | ConvertFrom-Json
$intent = Get-Content -LiteralPath (Join-Path $config 'update-intent.json') -Raw | ConvertFrom-Json
$guard = Get-Content -LiteralPath (Join-Path $config 'update-guard.json') -Raw | ConvertFrom-Json
if ($journal.operationId -cne $operationId -or $journal.phase -cne 'SERVICE_QUIESCED' -or
    $null -eq $journal.backup -or $intent.operationId -cne $operationId -or
    $intent.backupOperationId -cne $journal.backup.operationId -or $guard.operationId -cne $operationId) { throw 'UPDATE_STAGE_GUARD_INVALID' }
$service = Get-CimInstance Win32_Service -Filter "Name='BashkarPOSLocalServer'"
if ($null -eq $service -or $service.StartMode -ne 'Disabled' -or $service.State -ne 'Stopped' -or $service.ProcessId -ne 0 -or
    $service.StartName -ine 'NT AUTHORITY\LocalService' -or
    $service.PathName.Trim('"') -ine (Join-Path $env:ProgramW6432 'Bashkar POS\BashkarPOSLocalServer.exe')) { throw 'UPDATE_SERVICE_NOT_QUIESCED' }
if (-not (Test-Path -LiteralPath (Join-Path $env:ProgramW6432 'Bashkar POS') -PathType Container)) { throw 'UPDATE_OLD_BINARY_MISSING' }
if (Test-Path -LiteralPath $stagePath) {
  $item = Get-Item -LiteralPath $stagePath -Force
  if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'UPDATE_STAGE_PATH_INVALID' }
  $links = @(Get-ChildItem -LiteralPath $stagePath -Recurse -Force -Attributes ReparsePoint)
  if ($links.Count -ne 0) { throw 'UPDATE_STAGE_REPARSE_POINT' }
  # This directory is never the installed app or a Backup Set. It belongs to the
  # current, still-quiesced operation and can be rebuilt from the signed EXE.
  Remove-Item -LiteralPath $stagePath -Recurse -Force
  if (Test-Path -LiteralPath $stagePath) { throw 'UPDATE_STAGE_RESET_FAILED' }
}
