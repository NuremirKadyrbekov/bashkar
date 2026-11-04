$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$setup = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path 'artifacts\windows-installer\Bashkar-POS-Setup-0.1.0.exe'
$app = Join-Path $env:ProgramW6432 'Bashkar POS'
$root = Join-Path $env:ProgramData 'BashkarPOS'
$serviceName = 'BashkarPOSLocalServer'
if ((Get-Service $serviceName -ErrorAction SilentlyContinue) -or (Test-Path $root) -or (Test-Path $app)) { throw 'Smoke runner is not clean; refusing to touch existing installation or data.' }
& $setup /S
if ($LASTEXITCODE -ne 0) { throw 'Silent install failed' }
if ((Get-Service $serviceName).Status -ne 'Running') { throw 'Service is not running' }
if (-not (Test-Path (Join-Path $app 'Bashkar POS.exe'))) { throw 'Desktop executable missing' }
if (-not (Test-Path (Join-Path $env:PUBLIC 'Desktop\Bashkar POS.lnk'))) { throw 'Desktop shortcut missing' }
if (-not (Test-Path 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\BashkarPOS')) { throw 'Installed Apps entry missing' }
if ((Invoke-RestMethod 'http://127.0.0.1:3210/api/v1/system/health/live').status -ne 'live') { throw 'Server is not live' }
$marker = Get-Content (Join-Path $root 'data\installation.json') -Raw
& $setup /S
if ($LASTEXITCODE -ne 0) { throw 'Reinstall failed' }
if ((Get-Content (Join-Path $root 'data\installation.json') -Raw) -ne $marker) { throw 'Reinstall changed installation identity' }
& (Join-Path $app 'Uninstall.exe') /S
if ($LASTEXITCODE -ne 0) { throw 'Uninstall failed' }
if (Get-Service $serviceName -ErrorAction SilentlyContinue) { throw 'Service survived uninstall' }
if (-not (Test-Path (Join-Path $root 'data\pos.sqlite'))) { throw 'Uninstall removed restaurant data' }
Write-Host 'PASS disposable runner: install, service live, shortcut, registration, reinstall identity, uninstall preservation'
