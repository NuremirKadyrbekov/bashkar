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
$serverProcess = (Get-CimInstance Win32_Service -Filter "Name='$serviceName'").ProcessId
$started = (Get-Process -Id $serverProcess).StartTime
& $setup /S
if ($LASTEXITCODE -eq 0) { throw 'Installer accepted an existing installation without recovery procedure' }
if ((Get-Content (Join-Path $root 'data\installation.json') -Raw) -ne $marker) { throw 'Rejected reinstall changed installation identity' }
if ((Get-Service $serviceName).Status -ne 'Running') { throw 'Rejected reinstall stopped the service' }
if ((Get-CimInstance Win32_Service -Filter "Name='$serviceName'").ProcessId -ne $serverProcess -or (Get-Process -Id $serverProcess).StartTime -ne $started) { throw 'Rejected reinstall restarted the service' }
$recoveryName = 'BashkarPOSRecoverySmoke'
$recoveryWrapper = Join-Path $root "backups\$recoveryName.exe"
$recoveryXml = Join-Path $root "backups\$recoveryName.xml"
$recoveryWorker = Join-Path $root 'backups\recovery-smoke-worker.ps1'
$recoveryResult = Join-Path $root 'backups\recovery-smoke-result.json'
Stop-Service $serviceName
(Get-Service $serviceName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(45))
Copy-Item (Join-Path $app "$serviceName.exe") $recoveryWrapper
Copy-Item (Join-Path $PSScriptRoot 'recovery-smoke-worker.ps1') $recoveryWorker
$workerXml = [Security.SecurityElement]::Escape($recoveryWorker)
$appXml = [Security.SecurityElement]::Escape($app)
$logsXml = [Security.SecurityElement]::Escape((Join-Path $root 'logs'))
$powershellXml = [Security.SecurityElement]::Escape((Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'))
$xml = @"
<service>
  <id>$recoveryName</id><name>$recoveryName</name>
  <executable>$powershellXml</executable>
  <arguments>-NoProfile -NonInteractive -ExecutionPolicy Bypass -File &quot;$workerXml&quot;</arguments>
  <workingdirectory>$appXml</workingdirectory><logpath>$logsXml</logpath><startmode>Manual</startmode>
</service>
"@
[IO.File]::WriteAllText($recoveryXml, $xml, [Text.UTF8Encoding]::new($false))
try {
  & $recoveryWrapper install
  if ($LASTEXITCODE -ne 0) { throw 'Recovery smoke service install failed' }
  & sc.exe config $recoveryName obj= 'NT AUTHORITY\LocalService' start= demand | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Recovery smoke service identity failed' }
  & sc.exe start $recoveryName | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Recovery smoke service start failed' }
  for ($attempt = 0; $attempt -lt 60 -and -not (Test-Path $recoveryResult); $attempt++) {
    Start-Sleep -Seconds 1
    if ((Get-Service $recoveryName).Status -eq 'Stopped' -and -not (Test-Path $recoveryResult)) { throw 'Recovery smoke worker stopped without a verified result' }
  }
  if (-not (Test-Path $recoveryResult)) { throw 'Recovery smoke timed out' }
  $recovery = Get-Content $recoveryResult -Raw | ConvertFrom-Json
  if ($recovery.verified -ne $true -or $recovery.restored -ne $true -or $recovery.guardBlocked -ne $true -or -not (Test-Path (Join-Path $root "backups\$($recovery.operationId)\manifest.json"))) { throw 'Recovery smoke result invalid' }
} finally {
  if (Get-Service $recoveryName -ErrorAction SilentlyContinue) {
    if ((Get-Service $recoveryName).Status -ne 'Stopped') { Stop-Service $recoveryName }
    & $recoveryWrapper uninstall
    if ($LASTEXITCODE -ne 0) { throw 'Recovery smoke service uninstall failed' }
  }
  Start-Service $serviceName
  (Get-Service $serviceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(45))
}
if ((Invoke-RestMethod 'http://127.0.0.1:3210/api/v1/system/health/live').status -ne 'live') { throw 'Server did not recover after backup smoke' }
& (Join-Path $app 'Uninstall.exe') /S
if ($LASTEXITCODE -ne 0) { throw 'Uninstall failed' }
if (Get-Service $serviceName -ErrorAction SilentlyContinue) { throw 'Service survived uninstall' }
if (-not (Test-Path (Join-Path $root 'data\pos.sqlite'))) { throw 'Uninstall removed restaurant data' }
& $setup /S
if ($LASTEXITCODE -eq 0) { throw 'Installer accepted preserved data after uninstall' }
if (Get-Service $serviceName -ErrorAction SilentlyContinue) { throw 'Rejected reinstall created a service' }
if (-not (Test-Path (Join-Path $root 'data\pos.sqlite'))) { throw 'Rejected reinstall removed restaurant data' }
Write-Host 'PASS disposable runner: clean install, service live, shortcut, registration, upgrade rejection without service restart, uninstall preservation, preserved-data rejection'
