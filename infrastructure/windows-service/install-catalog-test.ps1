$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run PowerShell as Administrator.' }
if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { throw 'Windows x64 only.' }
$service = 'BashkarPOSCatalogTest'
$app = Join-Path $env:ProgramFiles $service
$root = Join-Path $env:ProgramData $service
$data = Join-Path $root 'data'
$logs = Join-Path $root 'logs'
if ((Get-Service -Name $service -ErrorAction SilentlyContinue) -or (Test-Path $app) -or (Test-Path $root)) { throw 'Test installation already exists. No files changed; this is not an upgrade.' }
function Protect-Directory([string] $Path, [bool] $Desktop) {
    $acl = Get-Acl -LiteralPath $Path
    $acl.SetAccessRuleProtection($true, $false)
    $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
    $propagate = [Security.AccessControl.PropagationFlags]::None
    $allow = [Security.AccessControl.AccessControlType]::Allow
    $entries = @(@('S-1-5-18', 'FullControl'), @('S-1-5-32-544', 'FullControl'), @('S-1-5-19', $(if ($Desktop) { 'ReadAndExecute' } else { 'Modify' })))
    if ($Desktop) { $entries += ,@('S-1-5-32-545', 'ReadAndExecute') }
    foreach ($entry in $entries) {
        $sid = [Security.Principal.SecurityIdentifier]::new($entry[0])
        $rights = [Security.AccessControl.FileSystemRights]$entry[1]
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, $rights, $inherit, $propagate, $allow))
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}
New-Item -ItemType Directory -Path $app, $root | Out-Null
Protect-Directory $app $true
Protect-Directory $root $false
New-Item -ItemType Directory -Path $data, $logs | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'payload\*') $app -Recurse
& (Join-Path $app 'infrastructure\printing\build-helper.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Print helper build failed.' }
$env:BASHKAR_DATA_DIR = $data
& (Join-Path $app 'node.exe') (Join-Path $app 'dist\apps\local-server\src\main.js') init-db
if ($LASTEXITCODE -ne 0) { throw 'Initialization failed. Preserve files and investigate.' }
$escape = { param($value) [Security.SecurityElement]::Escape($value) }
$nodeXml = & $escape (Join-Path $app 'node.exe')
$mainXml = & $escape (Join-Path $app 'dist\apps\local-server\src\main.js')
$workerXml = & $escape (Join-Path $app 'dist\apps\local-server\src\print-worker.js')
$appXml = & $escape $app
$dataXml = & $escape $data
$logsXml = & $escape $logs
$xml = @"
<service>
 <id>BashkarPOSCatalogTest</id><name>Bashkar POS Catalog Test</name>
 <description>Isolated test service for the current source. Not for restaurant use.</description>
 <executable>$nodeXml</executable><arguments>&quot;$mainXml&quot;</arguments><workingdirectory>$appXml</workingdirectory>
 <env name="BASHKAR_DATA_DIR" value="$dataXml"/><env name="BASHKAR_PORT" value="3221"/>
 <env name="BASHKAR_PRINT_WORKER_ENTRY" value="$workerXml"/>
 <logpath>$logsXml</logpath><log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>3</keepFiles></log>
 <onfailure action="restart" delay="5 sec"/><onfailure action="restart" delay="15 sec"/><onfailure action="none"/><resetfailure>1 hour</resetfailure>
 <startmode>Automatic</startmode><stoptimeout>15 sec</stoptimeout><stopparentprocessfirst>true</stopparentprocessfirst>
</service>
"@
[IO.File]::WriteAllText((Join-Path $app 'BashkarPOSCatalogTest.xml'), $xml, (New-Object Text.UTF8Encoding($false)))
& (Join-Path $app 'BashkarPOSCatalogTest.exe') install
if ($LASTEXITCODE -ne 0) { throw 'Service installation failed. Preserve files.' }
& sc.exe config $service obj= 'NT AUTHORITY\LocalService' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Service identity failed; do not start.' }
$programs = [Environment]::GetFolderPath('CommonPrograms')
if ($programs) {
    $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $programs 'Bashkar POS Catalog Test.lnk'))
    $shortcut.TargetPath = (Join-Path $app 'Start-Bashkar-Catalog.cmd')
    $shortcut.WorkingDirectory = $app
    $shortcut.Description = 'Bashkar POS isolated catalog test'
    $shortcut.Save()
}
Write-Host 'Installed an isolated test service. Start-Service BashkarPOSCatalogTest, then open Bashkar POS Catalog Test from Start Menu.'
