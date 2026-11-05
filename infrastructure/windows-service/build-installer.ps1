param(
  [switch]$Production,
  [switch]$TestSigned,
  [string]$CertificateThumbprint,
  [string]$TimestampUrl,
  [string]$SignToolPath,
  [string]$ManifestDraftPath,
  [string]$ManifestPrivateKeyPath,
  [string]$ManifestPublicKeyPath,
  [string]$CloudGrantKeyId,
  [string]$CloudGrantPublicKeyPath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $root
$appVersion = '0.1.0'
if (-not [Environment]::Is64BitOperatingSystem -or [Environment]::OSVersion.Platform -ne 'Win32NT') { throw 'Build on Windows x64.' }
if ((node -p 'process.versions.node') -ne '24.18.0') { throw 'Use Node.js 24.18.0 for the build.' }
$staleManifest = Join-Path $root 'artifacts\windows-installer\release-manifest.signed.json'
if (Test-Path -LiteralPath $staleManifest) { Remove-Item -LiteralPath $staleManifest -Force }
if ($Production -and $TestSigned) { throw 'Choose Production or TestSigned, never both.' }
$signed = $Production -or $TestSigned
if ($signed) {
  if ($CertificateThumbprint -notmatch '^[0-9a-fA-F]{40}$') { throw 'Production signing requires a 40-character certificate thumbprint.' }
  if ($Production -and $TimestampUrl -notmatch '^https://') { throw 'Production signing requires an HTTPS timestamp URL.' }
  if (-not $SignToolPath) {
    $signToolCommand = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($signToolCommand) { $SignToolPath = $signToolCommand.Source }
  }
  if (-not $SignToolPath -or -not (Test-Path -LiteralPath $SignToolPath -PathType Leaf)) { throw 'Production signing requires SignTool.exe.' }
  foreach ($path in @($ManifestDraftPath, $ManifestPrivateKeyPath, $ManifestPublicKeyPath)) {
    if (-not $path -or -not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'Production signing requires the release manifest draft and separate Ed25519 key files.' }
  }
  $ManifestDraftPath = (Resolve-Path -LiteralPath $ManifestDraftPath).Path
  $ManifestPrivateKeyPath = (Resolve-Path -LiteralPath $ManifestPrivateKeyPath).Path
  $ManifestPublicKeyPath = (Resolve-Path -LiteralPath $ManifestPublicKeyPath).Path
  if ($CloudGrantKeyId -cnotmatch '^[a-z0-9_-]{1,80}$' -or -not (Test-Path -LiteralPath $CloudGrantPublicKeyPath -PathType Leaf)) { throw 'Production signing requires a separate Cloud install-grant public key and key ID.' }
  $CloudGrantPublicKeyPath = (Resolve-Path -LiteralPath $CloudGrantPublicKeyPath).Path
  if ($Production) {
    $gitStatus = @(& git status --porcelain --untracked-files=all)
    if ($LASTEXITCODE -ne 0 -or $gitStatus.Count -ne 0) { throw 'Production release requires a clean Git checkout.' }
  }
  $gitCommit = (& git rev-parse HEAD).Trim().ToLowerInvariant()
  if ($LASTEXITCODE -ne 0 -or $gitCommit -notmatch '^[0-9a-f]{40}$') { throw 'Production release requires a fixed Git commit.' }
  $draftCommit = (Get-Content -LiteralPath $ManifestDraftPath -Raw | ConvertFrom-Json).gitCommit
  if ($draftCommit -ne $gitCommit) { throw 'Release manifest Git commit does not match the build checkout.' }
  $appVersion = (Get-Content -LiteralPath $ManifestDraftPath -Raw | ConvertFrom-Json).version
  if ($appVersion -cnotmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$') { throw 'Release manifest version is invalid.' }
  if ($TestSigned -and (Get-Content -LiteralPath $ManifestDraftPath -Raw | ConvertFrom-Json).releaseId -cnotmatch '^test_[a-z0-9_-]+$') {
    throw 'TestSigned requires a test_ release ID.'
  }
}
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed' }
pnpm exec install-electron
if ($LASTEXITCODE -ne 0) { throw 'Electron runtime download failed' }
node infrastructure/windows-service/check-dependencies.cjs
if ($LASTEXITCODE -ne 0) { throw 'Windows dependency check failed' }
pnpm run build
if ($LASTEXITCODE -ne 0) { throw 'TypeScript build failed' }
$stage = Join-Path $root 'artifacts\windows-installer\stage'
$output = Join-Path $root 'artifacts\windows-installer'
$managerStage = Join-Path $output 'manager-stage'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
if (Test-Path $managerStage) { Remove-Item $managerStage -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null
New-Item -ItemType Directory -Path $managerStage -Force | Out-Null
$server = Join-Path $stage 'server'
$desktop = Join-Path $stage 'desktop'
New-Item -ItemType Directory -Path $server, $desktop -Force | Out-Null
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path $vswhere)) { throw 'Visual Studio C++ Build Tools are required for the in-memory SQLite backup helper.' }
$vsInstallation = (& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1)
if (-not $vsInstallation) { throw 'Visual Studio C++ Build Tools are required for the in-memory SQLite backup helper.' }
$vcvars = Join-Path $vsInstallation 'VC\Auxiliary\Build\vcvars64.bat'
if (-not (Test-Path $vcvars)) { throw 'Visual Studio x64 compiler environment not found.' }
$sqlitePackage = Split-Path ((node -p "require.resolve('better-sqlite3/package.json')").Trim())
$sqliteDir = Join-Path $sqlitePackage 'deps\sqlite3'
$sqliteC = Join-Path $sqliteDir 'sqlite3.c'
$helperSource = Join-Path $root 'infrastructure\sqlite-memory-backup\memory-backup.c'
$helperOutput = Join-Path $server 'memory-backup.exe'
$helperBuild = Join-Path $stage 'build-memory-backup.cmd'
@(
  '@echo off',
  "call `"$vcvars`" >nul",
  'if errorlevel 1 exit /b 1',
  "cd /d `"$stage`"",
  "cl /nologo /O2 /MT /D_CRT_SECURE_NO_WARNINGS /DSQLITE_THREADSAFE=1 /I`"$sqliteDir`" `"$helperSource`" `"$sqliteC`" /Fe:`"$helperOutput`"",
  'exit /b %errorlevel%'
) | Set-Content -LiteralPath $helperBuild -Encoding Ascii
try { & $env:ComSpec /d /c $helperBuild; if ($LASTEXITCODE -ne 0 -or -not (Test-Path $helperOutput)) { throw 'In-memory SQLite backup helper build failed.' } }
finally { Remove-Item -LiteralPath $helperBuild -ErrorAction SilentlyContinue }
$common = @('--bundle', '--platform=node', '--target=node24', '--external:better-sqlite3', '--external:@resvg/resvg-js', '--external:node-forge/dist/forge.min.js')
pnpm exec esbuild apps/local-server/src/main.ts @common "--outfile=$server\main.js"
if ($LASTEXITCODE -ne 0) { throw 'Server bundle failed' }
Set-Content -LiteralPath (Join-Path $server 'version.json') -Value "{`"format`":1,`"version`":`"$appVersion`"}" -Encoding Ascii
Set-Content -LiteralPath (Join-Path $server 'recovery-quarantine.json') -Value '{"format":1,"capability":"recovery-quarantine-v1"}' -Encoding Ascii
pnpm exec esbuild apps/local-server/src/recovery/backup-cli.ts @common "--outfile=$server\backup-cli.js"
if ($LASTEXITCODE -ne 0) { throw 'Recovery bundle failed' }
pnpm exec esbuild apps/local-server/src/recovery/update-migrate-entry.ts @common "--outfile=$server\update-migrate.js"
if ($LASTEXITCODE -ne 0) { throw 'Update migration bundle failed' }
pnpm exec esbuild apps/local-server/src/recovery/update-restore-entry.ts @common "--outfile=$server\update-restore.js"
if ($LASTEXITCODE -ne 0) { throw 'Update restore bundle failed' }
pnpm exec esbuild apps/local-server/src/recovery/update-restore-entry.ts @common "--outfile=$managerStage\update-restore.js"
if ($LASTEXITCODE -ne 0) { throw 'Stable Update Manager restore bundle failed' }
pnpm exec esbuild apps/local-server/src/recovery/update-verify-backup-entry.ts @common "--outfile=$managerStage\update-verify-backup.js"
if ($LASTEXITCODE -ne 0) { throw 'Backup acceptance bundle failed' }
pnpm exec esbuild apps/local-server/src/recovery/update-manager-entry.ts @common "--outfile=$managerStage\update-manager.js"
if ($LASTEXITCODE -ne 0) { throw 'Update Manager bundle failed' }
pnpm exec esbuild apps/local-server/src/recovery/service-bootstrap.ts @common "--outfile=$managerStage\service-bootstrap.js"
if ($LASTEXITCODE -ne 0) { throw 'Stable service bootstrap bundle failed' }
pnpm exec esbuild apps/local-server/src/recovery/update-service-probe-entry.ts @common "--outfile=$managerStage\update-service-probe.js"
if ($LASTEXITCODE -ne 0) { throw 'Controlled service probe bundle failed' }
pnpm exec esbuild apps/local-server/src/recovery/update-verify-new-entry.ts @common "--outfile=$managerStage\update-verify-new.js"
if ($LASTEXITCODE -ne 0) { throw 'New install prestart verification bundle failed' }
pnpm exec esbuild apps/local-server/src/recovery/update-new-service-probe-entry.ts @common "--outfile=$managerStage\update-new-service-probe.js"
if ($LASTEXITCODE -ne 0) { throw 'New install service probe bundle failed' }
pnpm exec esbuild apps/local-server/src/recovery/update-finalize-recovery-entry.ts @common "--outfile=$managerStage\update-finalize-recovery.js"
if ($LASTEXITCODE -ne 0) { throw 'Recovery finalization bundle failed' }
pnpm exec esbuild apps/local-server/src/recovery/update-finalize-new-entry.ts @common "--outfile=$managerStage\update-finalize-new.js"
if ($LASTEXITCODE -ne 0) { throw 'New install finalization bundle failed' }
pnpm exec esbuild apps/local-server/src/recovery/update-restore-binary-entry.ts @common "--outfile=$managerStage\update-restore-binary.js"
if ($LASTEXITCODE -ne 0) { throw 'Old binary restore bundle failed' }
pnpm exec esbuild apps/local-server/src/recovery/update-verify-restore-entry.ts @common "--outfile=$managerStage\update-verify-restore.js"
if ($LASTEXITCODE -ne 0) { throw 'Restored install prestart verification bundle failed' }
pnpm exec esbuild apps/local-server/src/recovery/update-verify-pre-migration-entry.ts @common "--outfile=$managerStage\update-verify-pre-migration.js"
if ($LASTEXITCODE -ne 0) { throw 'Pre-migration data verification bundle failed' }
pnpm exec esbuild apps/local-server/src/modules/printing/render.ts @common "--outfile=$server\print-worker.js"
if ($LASTEXITCODE -ne 0) { throw 'Print worker bundle failed' }
pnpm exec esbuild apps/pos-desktop/menu-import-file.cjs --bundle --platform=node --target=node24 --format=cjs "--outfile=$desktop\menu-import-file.cjs"
if ($LASTEXITCODE -ne 0) { throw 'Desktop import bundle failed' }
Get-ChildItem apps/pos-desktop -File | Where-Object { $_.Extension -in @('.cjs','.js','.html','.css') -and $_.Name -ne 'menu-import-file.cjs' } | Copy-Item -Destination $desktop
$assets = Join-Path $desktop 'assets'
$waiter = Join-Path $stage 'apps\waiter-web'
$fonts = Join-Path $stage 'third-party\fonts'
New-Item -ItemType Directory -Path $assets, $waiter, $fonts -Force | Out-Null
Copy-Item (Join-Path 'apps/pos-desktop/assets' '*') $assets -Recurse -Force
Copy-Item (Join-Path 'apps/waiter-web' '*') $waiter -Recurse -Force
Copy-Item (Join-Path 'third-party/fonts' '*') $fonts -Recurse -Force
$print = Join-Path $stage 'infrastructure\printing'
New-Item -ItemType Directory -Path $print -Force | Out-Null
Copy-Item infrastructure/printing/RawPrint.cs, infrastructure/printing/build-helper.ps1 $print
& (Join-Path $print 'build-helper.ps1') | Out-Null
if (-not (Test-Path (Join-Path $print 'bin\RawPrint.exe'))) { throw 'Print helper build failed' }
node infrastructure/windows-service/stage-native.cjs $stage
if ($LASTEXITCODE -ne 0) { throw 'Native dependency staging failed' }
foreach ($name in @('better-sqlite3','bindings','file-uri-to-path')) {
  $from = Join-Path $stage "node_modules\$name"
  $to = Join-Path $managerStage "node_modules\$name"
  New-Item -ItemType Directory -Path (Split-Path $to) -Force | Out-Null
  Copy-Item -LiteralPath $from -Destination $to -Recurse
}
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
Copy-Item -LiteralPath (Join-Path $stage 'node.exe') -Destination (Join-Path $managerStage 'node.exe')
Copy-Item -LiteralPath (Join-Path $stage 'NODE-LICENSE') -Destination (Join-Path $managerStage 'NODE-LICENSE')
$winsw = Join-Path $stage 'BashkarPOSLocalServer.exe'
Invoke-WebRequest 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe' -OutFile $winsw
if ((Get-FileHash $winsw -Algorithm SHA256).Hash.ToLowerInvariant() -ne '05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da') { throw 'WinSW checksum mismatch' }
if ($signed) {
  $certificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$CertificateThumbprint" -ErrorAction SilentlyContinue
  if (-not $certificate) { $certificate = Get-Item -LiteralPath "Cert:\LocalMachine\My\$CertificateThumbprint" -ErrorAction SilentlyContinue }
  if (-not $certificate -or -not $certificate.RawData) { throw 'Production signing certificate not found for Update Manager pin.' }
  $certificateFile = Join-Path $stage 'update-signer.der'
  try {
    [IO.File]::WriteAllBytes($certificateFile, $certificate.RawData)
    $releaseKeyId = (Get-Content -LiteralPath $ManifestDraftPath -Raw | ConvertFrom-Json).keyId
    node infrastructure/windows-service/write-update-trust.cjs $ManifestPublicKeyPath $releaseKeyId $CloudGrantPublicKeyPath $CloudGrantKeyId $certificateFile (Join-Path $managerStage 'update-trust.json')
    if ($LASTEXITCODE -ne 0) { throw 'Update Manager trust configuration failed' }
  } finally { Remove-Item -LiteralPath $certificateFile -ErrorAction SilentlyContinue }
}
$electronPackage = (node -p "require.resolve('electron/package.json')").Trim()
if ($LASTEXITCODE -ne 0) { throw 'Electron package not found' }
$electronDir = Join-Path (Split-Path $electronPackage) 'dist'
if (-not (Test-Path (Join-Path $electronDir 'electron.exe'))) { throw 'Electron executable missing from locked dependency' }
Copy-Item (Join-Path $electronDir '*') $stage -Recurse -Force
Rename-Item (Join-Path $stage 'electron.exe') 'Bashkar POS.exe'
$appDir = Join-Path $stage 'resources\app'
New-Item -ItemType Directory -Path $appDir -Force | Out-Null
Copy-Item (Join-Path $desktop '*') $appDir -Recurse -Force
Set-Content (Join-Path $appDir 'package.json') "{`"name`":`"bashkar-pos-desktop`",`"version`":`"$appVersion`",`"main`":`"main.cjs`"}" -Encoding ascii
Remove-Item $desktop -Recurse -Force
Copy-Item infrastructure/windows-service/service.ps1 (Join-Path $stage 'service.ps1')
Copy-Item infrastructure/windows-service/extract-update-preflight.ps1 (Join-Path $stage 'extract-update-preflight.ps1')
if ($signed) {
  $draft = Get-Content -LiteralPath $ManifestDraftPath -Raw | ConvertFrom-Json
  node (Join-Path $root 'dist\apps\local-server\src\recovery\payload-manifest-entry.js') sign $stage $draft.releaseId $draft.version $ManifestPrivateKeyPath $ManifestPublicKeyPath
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $stage 'payload-manifest.signed.json') -PathType Leaf)) { throw 'Signed payload inventory failed.' }
}
$makensisCommand = Get-Command makensis.exe -ErrorAction SilentlyContinue
$makensis = if ($makensisCommand) { $makensisCommand.Source } else { $null }
if (-not $makensis) { $makensis = 'C:\Program Files (x86)\NSIS\makensis.exe' }
if (-not (Test-Path $makensis)) { throw 'NSIS makensis.exe not found' }
& $makensis "/DSTAGE=$stage" "/DMANAGER_STAGE=$managerStage" "/DAPP_VERSION=$appVersion" "/DOUTPUT=$output" (Join-Path $PSScriptRoot 'installer.nsi')
if ($LASTEXITCODE -ne 0) { throw 'NSIS build failed' }
$setup = Join-Path $output "Bashkar-POS-Setup-$appVersion.exe"
if (-not (Test-Path -LiteralPath $setup -PathType Leaf)) { throw "NSIS did not create installer: $setup" }
if ((Get-Item -LiteralPath $setup).Length -eq 0) { throw "NSIS created an empty installer: $setup" }
if ($signed) {
  if ($Production) { & $SignToolPath sign /sha1 $CertificateThumbprint /fd SHA256 /tr $TimestampUrl /td SHA256 $setup }
  else { & $SignToolPath sign /sha1 $CertificateThumbprint /fd SHA256 $setup }
  if ($LASTEXITCODE -ne 0) { throw 'Installer signing failed.' }
  & $SignToolPath verify /pa $setup
  if ($LASTEXITCODE -ne 0) { throw 'Installer Authenticode verification failed.' }
  $signature = Get-AuthenticodeSignature -LiteralPath $setup
  if ($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate -or $signature.SignerCertificate.Thumbprint -ne $CertificateThumbprint) {
    throw 'Installer signature or signer does not match the configured certificate.'
  }
  $manifestOutput = Join-Path $output 'release-manifest.signed.json'
  node (Join-Path $root 'dist\apps\local-server\src\recovery\sign-release-manifest.js') $ManifestDraftPath $setup $ManifestPrivateKeyPath $ManifestPublicKeyPath $manifestOutput
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $manifestOutput -PathType Leaf)) { throw 'Signed release manifest generation failed.' }
}
Get-FileHash -LiteralPath $setup -Algorithm SHA256
