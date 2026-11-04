$ErrorActionPreference = 'Stop'
$app = Join-Path $env:ProgramFiles 'BashkarPOSLatestTest'
$client = Join-Path $app 'desktop-runtime\electron.exe'
$main = Join-Path $app 'desktop\main.cjs'
if (-not (Test-Path $client) -or -not (Test-Path $main)) { throw 'Install the latest test package first.' }
$env:BASHKAR_DESKTOP_PORT = '3220'
$env:BASHKAR_TEST_CLIENT = '1'
$clientData = Join-Path $env:LOCALAPPDATA 'BashkarPOSLatestTest'
& $client ("--user-data-dir=" + $clientData) $main
