$ErrorActionPreference = 'Stop'
$printingRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$printingOutput = Join-Path $printingRoot 'bin'
New-Item -ItemType Directory -Path $printingOutput -Force | Out-Null
$printingCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$printingTarget = Join-Path $printingOutput 'RawPrint.exe'
& $printingCompiler /nologo /target:exe /platform:x64 /reference:System.Management.dll /reference:System.Web.Extensions.dll /reference:System.Core.dll "/out:$printingTarget" (Join-Path $printingRoot 'RawPrint.cs')
if ($LASTEXITCODE -ne 0) { throw 'PRINT_HELPER_BUILD_FAILED' }
Get-FileHash (Join-Path $printingOutput 'RawPrint.exe') -Algorithm SHA256
