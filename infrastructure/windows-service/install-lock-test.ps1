$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run PowerShell as Administrator.' }
if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { throw 'This test package targets Windows x64 only.' }
$service = 'BashkarPOSLockTest'
$app = Join-Path $env:ProgramFiles 'BashkarPOSLockTest'
$root = Join-Path $env:ProgramData 'BashkarPOSLockTest'
$data = Join-Path $root 'data'
$logs = Join-Path $root 'logs'
if ((Get-Service -Name $service -ErrorAction SilentlyContinue) -or (Test-Path $app) -or (Test-Path $root)) { throw 'Existing prototype service or directory found. Stopping without changes.' }
# Set inheritable ACEs on empty directories before creating children. Use .NET SID
# objects so no localized account name or icacls argument parsing is involved.
function Protect-Directory([string] $Path, [string] $ServiceRights) {
    $acl = Get-Acl -LiteralPath $Path
    $acl.SetAccessRuleProtection($true, $false)
    $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
    $propagate = [Security.AccessControl.PropagationFlags]::None
    $allow = [Security.AccessControl.AccessControlType]::Allow
    foreach ($entry in @(@('S-1-5-18', 'FullControl'), @('S-1-5-32-544', 'FullControl'), @('S-1-5-19', $ServiceRights))) {
        $sid = [Security.Principal.SecurityIdentifier]::new($entry[0])
        $rights = [Security.AccessControl.FileSystemRights]$entry[1]
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, $rights, $inherit, $propagate, $allow))
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}
New-Item -ItemType Directory -Path $app, $root | Out-Null
Protect-Directory $app 'ReadAndExecute'
Protect-Directory $root 'Modify'
New-Item -ItemType Directory -Path $data, $logs | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'payload\*') $app -Recurse
$env:BASHKAR_DATA_DIR = $data
& (Join-Path $app 'node.exe') (Join-Path $app 'dist\apps\local-server\src\main.js') init-db
if ($LASTEXITCODE -ne 0) { throw 'Database initialization failed; preserve files and investigate.' }
$escape = { param($value) [Security.SecurityElement]::Escape($value) }
$nodeXml = & $escape (Join-Path $app 'node.exe')
$mainXml = & $escape (Join-Path $app 'dist\apps\local-server\src\main.js')
$appXml = & $escape $app
$dataXml = & $escape $data
$logsXml = & $escape $logs
$xml = @"
<service>
  <id>BashkarPOSLockTest</id><name>Bashkar POS Lock Test</name>
  <description>Experimental local server. Not for restaurant use.</description>
  <executable>$nodeXml</executable><arguments>&quot;$mainXml&quot;</arguments>
  <workingdirectory>$appXml</workingdirectory>
  <env name="BASHKAR_DATA_DIR" value="$dataXml"/><env name="BASHKAR_PORT" value="3211"/>
  <logpath>$logsXml</logpath><log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>3</keepFiles></log>
  <onfailure action="restart" delay="5 sec"/><onfailure action="restart" delay="15 sec"/><onfailure action="none"/><resetfailure>1 hour</resetfailure>
  <startmode>Manual</startmode><stoptimeout>15 sec</stoptimeout><stopparentprocessfirst>true</stopparentprocessfirst>
</service>
"@
[IO.File]::WriteAllText((Join-Path $app 'BashkarPOSLockTest.xml'), $xml, (New-Object Text.UTF8Encoding($false)))
$wrapper = Join-Path $app 'BashkarPOSLockTest.exe'
& $wrapper install
if ($LASTEXITCODE -ne 0) { throw 'WinSW install failed; preserve files and investigate.' }
& sc.exe config $service obj= 'NT AUTHORITY\LocalService' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Service identity configuration failed; do not start service.' }
Write-Host 'Installed. Review ACLs, then use Start-Service BashkarPOSLockTest.'
