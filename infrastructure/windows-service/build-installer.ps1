$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $root
if (-not [Environment]::Is64BitOperatingSystem -or [Environment]::OSVersion.Platform -ne 'Win32NT') { throw 'Build on Windows x64.' }
if ((node -p 'process.versions.node') -ne '24.18.0') { throw 'Use Node.js 24.18.0 for the build.' }
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed' }
pnpm run build
if ($LASTEXITCODE -ne 0) { throw 'TypeScript build failed' }
$stage = Join-Path $root 'artifacts\windows-installer\stage'
$output = Join-Path $root 'artifacts\windows-installer'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null
$server = Join-Path $stage 'server'
$desktop = Join-Path $stage 'desktop'
New-Item -ItemType Directory -Path $server, $desktop -Force | Out-Null
$common = @('--bundle', '--platform=node', '--target=node24', '--external:better-sqlite3', '--external:@resvg/resvg-js', '--external:node-forge/dist/forge.min.js')
pnpm exec esbuild apps/local-server/src/main.ts @common "--outfile=$server\main.js"
if ($LASTEXITCODE -ne 0) { throw 'Server bundle failed' }
pnpm exec esbuild apps/local-server/src/modules/printing/render.ts @common "--outfile=$server\print-worker.js"
if ($LASTEXITCODE -ne 0) { throw 'Print worker bundle failed' }
pnpm exec esbuild apps/pos-desktop/menu-import-file.cjs --bundle --platform=node --target=node24 --format=cjs "--outfile=$desktop\menu-import-file.cjs"
if ($LASTEXITCODE -ne 0) { throw 'Desktop import bundle failed' }
Get-ChildItem apps/pos-desktop -File | Where-Object { $_.Extension -in @('.cjs','.js','.html','.css') -and $_.Name -ne 'menu-import-file.cjs' } | Copy-Item -Destination $desktop
Copy-Item apps/pos-desktop/assets (Join-Path $desktop 'assets') -Recurse
Copy-Item apps/waiter-web (Join-Path $stage 'apps\waiter-web') -Recurse
Copy-Item third-party/fonts (Join-Path $stage 'third-party\fonts') -Recurse
$print = Join-Path $stage 'infrastructure\printing'
New-Item -ItemType Directory -Path $print -Force | Out-Null
Copy-Item infrastructure/printing/RawPrint.cs, infrastructure/printing/build-helper.ps1 $print
& (Join-Path $print 'build-helper.ps1') | Out-Null
if (-not (Test-Path (Join-Path $print 'bin\RawPrint.exe'))) { throw 'Print helper build failed' }
node infrastructure/windows-service/stage-native.cjs $stage
if ($LASTEXITCODE -ne 0) { throw 'Native dependency staging failed' }
$forge = Join-Path $stage 'node_modules\node-forge\dist'
New-Item -ItemType Directory -Path $forge -Force | Out-Null
$forgeRoot = Split-Path (node -p "require.resolve('node-forge/package.json')")
Copy-Item (Join-Path $forgeRoot 'package.json') (Split-Path $forge)
Copy-Item (Join-Path $forgeRoot 'dist\forge.min.js') $forge
$nodeZip = Join-Path $output 'node-v24.18.0-win-x64.zip'
if (-not (Test-Path $nodeZip)) { Invoke-WebRequest 'https://nodejs.org/dist/v24.18.0/node-v24.18.0-win-x64.zip' -OutFile $nodeZip }
if ((Get-FileHash $nodeZip -Algorithm SHA256).Hash.ToLowerInvariant() -ne '0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821') { throw 'Node runtime checksum mismatch' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($nodeZip)
try {
  foreach ($name in @('node.exe','LICENSE')) {
    $entry = $archive.GetEntry("node-v24.18.0-win-x64/$name")
    if (-not $entry) { throw "Missing Node $name" }
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $stage $(if ($name -eq 'LICENSE') { 'NODE-LICENSE' } else { $name })), $true)
  }
} finally { $archive.Dispose() }
$winsw = Join-Path $stage 'BashkarPOSLocalServer.exe'
Invoke-WebRequest 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe' -OutFile $winsw
if ((Get-FileHash $winsw -Algorithm SHA256).Hash.ToLowerInvariant() -ne '05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da') { throw 'WinSW checksum mismatch' }
$electronExe = (node -p "require('electron')").Trim()
$electronDir = Split-Path $electronExe
Copy-Item (Join-Path $electronDir '*') $stage -Recurse -Force
Rename-Item (Join-Path $stage 'electron.exe') 'Bashkar POS.exe'
$appDir = Join-Path $stage 'resources\app'
New-Item -ItemType Directory -Path $appDir -Force | Out-Null
Copy-Item (Join-Path $desktop '*') $appDir -Recurse -Force
Set-Content (Join-Path $appDir 'package.json') '{"name":"bashkar-pos-desktop","version":"0.1.0","main":"main.cjs"}' -Encoding ascii
Remove-Item $desktop -Recurse -Force
Copy-Item infrastructure/windows-service/service.ps1 (Join-Path $stage 'service.ps1')
$makensis = (Get-Command makensis.exe -ErrorAction SilentlyContinue).Source
if (-not $makensis) { $makensis = 'C:\Program Files (x86)\NSIS\makensis.exe' }
if (-not (Test-Path $makensis)) { throw 'NSIS makensis.exe not found' }
& $makensis "/DSTAGE=$stage" "/DOUTPUT=$output" (Join-Path $PSScriptRoot 'installer.nsi')
if ($LASTEXITCODE -ne 0) { throw 'NSIS build failed' }
Get-FileHash (Join-Path $output 'Bashkar-POS-Setup-0.1.0.exe') -Algorithm SHA256
