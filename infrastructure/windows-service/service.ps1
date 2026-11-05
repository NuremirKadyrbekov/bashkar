param([ValidateSet('Preflight','Stop','Install','Uninstall')][string]$Mode)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$name = 'BashkarPOSLocalServer'
$app = Join-Path $env:ProgramW6432 'Bashkar POS'
$managerApp = Join-Path $env:ProgramW6432 'Bashkar POS Update Manager'
$managerTask = 'BashkarPOSUpdateManager'
$root = Join-Path $env:ProgramData 'BashkarPOS'
$data = Join-Path $root 'data'
$wrapper = Join-Path $app "$name.exe"
function ExistingService { Get-Service -Name $name -ErrorAction SilentlyContinue }
function AssertNoPreviousInstallation {
  $uninstall = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\BashkarPOS'
  if ((ExistingService) -or (Get-ScheduledTask -TaskName $managerTask -ErrorAction SilentlyContinue) -or
      (Test-Path -LiteralPath $root) -or (Test-Path -LiteralPath $uninstall)) {
    throw 'EXISTING_INSTALLATION_REQUIRES_ACCEPTED_RECOVERY_PROCEDURE'
  }
}
function AssertCleanInstall {
  AssertNoPreviousInstallation
  if ((Test-Path -LiteralPath $app) -and @(Get-ChildItem -LiteralPath $app -Force).Count -ne 0) {
    throw 'EXISTING_APPLICATION_FILES_REQUIRE_INSPECTION'
  }
  if ((Test-Path -LiteralPath $managerApp) -and @(Get-ChildItem -LiteralPath $managerApp -Force).Count -ne 0) {
    throw 'EXISTING_UPDATE_MANAGER_FILES_REQUIRE_INSPECTION'
  }
}
function StopServer {
  $service = ExistingService
  if ($service -and $service.Status -ne 'Stopped') {
    Stop-Service -Name $name
    $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(45))
  }
}
function ProtectRoot {
  $acl = Get-Acl -LiteralPath $root
  $acl.SetAccessRuleProtection($true, $false)
  $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
  $allow = [Security.AccessControl.AccessControlType]::Allow
  foreach ($entry in @(@('S-1-5-18','FullControl'),@('S-1-5-32-544','FullControl'),@('S-1-5-19','Modify'))) {
    $sid = [Security.Principal.SecurityIdentifier]::new($entry[0])
    $right = [Security.AccessControl.FileSystemRights]$entry[1]
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,$right,$inherit,'None',$allow))
  }
  Set-Acl -LiteralPath $root -AclObject $acl
}
function ProtectManager {
  $acl = Get-Acl -LiteralPath $managerApp
  $acl.SetAccessRuleProtection($true, $false)
  $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
  $allow = [Security.AccessControl.AccessControlType]::Allow
  foreach ($entry in @(@('S-1-5-18','FullControl'),@('S-1-5-32-544','FullControl'),@('S-1-5-19','ReadAndExecute'))) {
    $sid = [Security.Principal.SecurityIdentifier]::new($entry[0])
    $right = [Security.AccessControl.FileSystemRights]$entry[1]
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,$right,$inherit,'None',$allow))
  }
  Set-Acl -LiteralPath $managerApp -AclObject $acl
}
function InstallManagerTask {
  $node = Join-Path $managerApp 'node.exe'
  $entry = Join-Path $managerApp 'update-manager.js'
  if (-not (Test-Path -LiteralPath $node -PathType Leaf) -or -not (Test-Path -LiteralPath $entry -PathType Leaf)) {
    throw 'UPDATE_MANAGER_BINARY_MISSING'
  }
  $action = New-ScheduledTaskAction -Execute $node -Argument ('"' + $entry + '" --run')
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
  $principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)
  Register-ScheduledTask -TaskName $managerTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
  $task = Get-ScheduledTask -TaskName $managerTask -ErrorAction Stop
  if ($task.Principal.UserId -ine 'NT AUTHORITY\SYSTEM' -or $task.Actions.Count -ne 1 -or
      $task.Actions[0].Execute -ine $node -or $task.Actions[0].Arguments -cne ('"' + $entry + '" --run')) {
    throw 'UPDATE_MANAGER_TASK_MISMATCH'
  }
}
function Xml([string]$value) { [Security.SecurityElement]::Escape($value) }
switch ($Mode) {
  'Preflight' { AssertCleanInstall; break }
  'Stop' { StopServer; break }
  'Uninstall' {
    StopServer
    if (Get-ScheduledTask -TaskName $managerTask -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $managerTask -Confirm:$false
    }
    if (ExistingService) {
      & $wrapper uninstall
      if ($LASTEXITCODE -ne 0) { throw 'SERVICE_UNINSTALL_FAILED' }
    }
    break
  }
  'Install' {
    AssertNoPreviousInstallation
    ProtectManager
    New-Item -ItemType Directory -Path $root | Out-Null
    ProtectRoot
    foreach ($dir in @($data,(Join-Path $root 'logs'),(Join-Path $root 'config'),(Join-Path $root 'backups'),(Join-Path $root 'updates'))) {
      New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    $marker = Join-Path $data 'installation.json'
    $db = Join-Path $data 'pos.sqlite'
    if (-not (Test-Path $marker) -and -not (Test-Path $db)) {
      if (@(Get-ChildItem -LiteralPath $data -Force).Count -ne 0) { throw 'DATA_DIRECTORY_NOT_EMPTY; preserve and inspect it' }
      $env:BASHKAR_DATA_DIR = $data
      & (Join-Path $app 'node.exe') (Join-Path $app 'server\main.js') init-db
      if ($LASTEXITCODE -ne 0) { throw 'DATABASE_INITIALIZATION_FAILED' }
    } elseif (-not (Test-Path $marker) -or -not (Test-Path $db)) { throw 'DATABASE_OR_MARKER_MISSING; preserve and inspect data' }
    $xml = @"
<service>
  <id>$name</id><name>Bashkar POS Local Server</name>
  <description>Local restaurant server; runs independently of the cash register window.</description>
  <executable>$(Xml (Join-Path $managerApp 'node.exe'))</executable>
  <arguments>&quot;$(Xml (Join-Path $managerApp 'service-bootstrap.js'))&quot;</arguments>
  <workingdirectory>$(Xml $app)</workingdirectory>
  <env name="BASHKAR_DATA_DIR" value="$(Xml $data)"/>
  <env name="BASHKAR_PORT" value="3210"/>
  <env name="BASHKAR_PRINT_WORKER_ENTRY" value="$(Xml (Join-Path $app 'server\print-worker.js'))"/>
  <logpath>$(Xml (Join-Path $root 'logs'))</logpath>
  <log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>5</keepFiles></log>
  <onfailure action="restart" delay="5 sec"/><onfailure action="restart" delay="15 sec"/><onfailure action="none"/><resetfailure>1 hour</resetfailure>
  <startmode>Automatic</startmode><stoptimeout>30 sec</stoptimeout><stopparentprocessfirst>true</stopparentprocessfirst><hidewindow>true</hidewindow>
</service>
"@
    [IO.File]::WriteAllText((Join-Path $app "$name.xml"),$xml,[Text.UTF8Encoding]::new($false))
    if (-not (ExistingService)) {
      & $wrapper install
      if ($LASTEXITCODE -ne 0) { throw 'SERVICE_INSTALL_FAILED' }
    }
    & sc.exe config $name obj= 'NT AUTHORITY\LocalService' start= auto | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'SERVICE_IDENTITY_FAILED' }
    InstallManagerTask
    Start-Service -Name $name
    (ExistingService).WaitForStatus('Running',[TimeSpan]::FromSeconds(45))
    $live = $null
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
      try { $live = Invoke-RestMethod 'http://127.0.0.1:3210/api/v1/system/health/live' -TimeoutSec 2; break }
      catch { Start-Sleep -Seconds 1 }
    }
    if (-not $live -or $live.status -ne 'live') { throw 'SERVICE_HEALTH_FAILED' }
    break
  }
}
