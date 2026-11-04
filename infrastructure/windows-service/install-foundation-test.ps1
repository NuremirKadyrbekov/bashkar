$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run as Administrator.' }
if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { throw 'Windows x64 only.' }
$service = 'BashkarPOSFoundationTest'
$app = Join-Path $env:ProgramFiles 'BashkarPOSFoundationTest'
$root = Join-Path $env:ProgramData 'BashkarPOSFoundationTest'
$data = Join-Path $root 'data'
$logs = Join-Path $root 'logs'
if ((Get-Service -Name $service -ErrorAction SilentlyContinue) -or (Test-Path $app) -or (Test-Path $root)) { throw 'Existing installation found. No files changed. This is not an upgrade installer.' }
foreach ($legacy in @('BashkarPOSPrototype', 'BashkarPOSLockTest')) {
    $existing = Get-Service -Name $legacy -ErrorAction SilentlyContinue
    if ($existing -and $existing.Status -ne 'Stopped') { throw "Stop the old TEST service $legacy explicitly before installing this isolated test. Do not delete its lock files." }
}
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
# Application code is read-only to LocalService and ordinary Desktop users.
Protect-Directory $app $true
Protect-Directory $root $false
New-Item -ItemType Directory -Path $data, $logs | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'payload\*') $app -Recurse
$env:BASHKAR_DATA_DIR = $data
& (Join-Path $app 'node.exe') (Join-Path $app 'dist\apps\local-server\src\main.js') init-db
if ($LASTEXITCODE -ne 0) { throw 'Initialization failed. Preserve all artifacts; do not retry/delete locks automatically.' }
$escape = { param($value) [Security.SecurityElement]::Escape($value) }
$nodeXml = & $escape (Join-Path $app 'node.exe')
$mainXml = & $escape (Join-Path $app 'dist\apps\local-server\src\main.js')
$appXml = & $escape $app
$dataXml = & $escape $data
$logsXml = & $escape $logs
$xml = @"
<service>
 <id>BashkarPOSFoundationTest</id><name>Bashkar POS Foundation Test</name>
 <description>Unaccepted cloud activation test. Not for restaurant use.</description>
 <executable>$nodeXml</executable><arguments>&quot;$mainXml&quot;</arguments><workingdirectory>$appXml</workingdirectory>
 <env name="BASHKAR_DATA_DIR" value="$dataXml"/><env name="BASHKAR_PORT" value="3212"/>
 <logpath>$logsXml</logpath><log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>3</keepFiles></log>
 <onfailure action="restart" delay="5 sec"/><onfailure action="restart" delay="15 sec"/><onfailure action="none"/><resetfailure>1 hour</resetfailure>
 <startmode>Automatic</startmode><stoptimeout>15 sec</stoptimeout><stopparentprocessfirst>true</stopparentprocessfirst>
</service>
"@
[IO.File]::WriteAllText((Join-Path $app 'BashkarPOSFoundationTest.xml'), $xml, (New-Object Text.UTF8Encoding($false)))
$wrapper = Join-Path $app 'BashkarPOSFoundationTest.exe'
& $wrapper install
if ($LASTEXITCODE -ne 0) { throw 'WinSW installation failed. Preserve files.' }
& sc.exe config $service obj= 'NT AUTHORITY\LocalService' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Service identity failed; do not start.' }
Write-Host 'Installed isolated test service; NOT an accepted upgrade. Start-Service BashkarPOSFoundationTest'
Write-Host 'Read ITERATION-001-ACCEPTANCE.md. Expected ready=503 / NEEDS_ACTIVATION.'
