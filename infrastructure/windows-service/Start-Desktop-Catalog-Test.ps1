$ErrorActionPreference = 'Stop'
$app = Join-Path $env:ProgramFiles 'BashkarPOSCatalogTest'
$client = Join-Path $app 'desktop-runtime\electron.exe'
$main = Join-Path $app 'desktop\main.cjs'
if (-not (Test-Path $client) -or -not (Test-Path $main)) { throw 'Install the catalog test package first.' }
$env:BASHKAR_DESKTOP_PORT = '3221'
$env:BASHKAR_TEST_CLIENT = '1'
$clientData = Join-Path $env:LOCALAPPDATA 'BashkarPOSCatalogTest'
& $client ("--user-data-dir=" + $clientData) $main
