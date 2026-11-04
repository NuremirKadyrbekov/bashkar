"""Build an isolated Windows x64 test ZIP from the current checkout.

Usage: python3 infrastructure/windows-service/package-latest-test.py OLD_ZIP RESVG_TGZ OUTPUT_ZIP
The pinned Windows runtimes are reused from the verified historical test ZIP.
"""
from pathlib import Path
import base64
import hashlib
import json
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile

root = Path(__file__).resolve().parents[2]
if len(sys.argv) != 4:
    raise SystemExit(__doc__)
old_zip, resvg_tgz, output_zip = map(lambda x: Path(x).resolve(), sys.argv[1:])
if output_zip.exists():
    raise SystemExit('Output already exists; refusing overwrite.')
old_digest = '47d90f2aeac92e8675d908a4b0a888a95567588616e8c83b5b0e973b6c4f1eee'
resvg_integrity = 'ZXtYhtUr5SSaBrUDq7DiyjOFJqBVL/dOBN7N/qmi/pO0IgiWW/f/ue3nbvu9joWE5aAKDoIzy/CxsY0suwGosQ=='
if hashlib.sha256(old_zip.read_bytes()).hexdigest() != old_digest:
    raise SystemExit('Historical runtime ZIP checksum mismatch.')
if base64.b64encode(hashlib.sha512(resvg_tgz.read_bytes()).digest()).decode() != resvg_integrity:
    raise SystemExit('Windows resvg package integrity mismatch.')
with tempfile.TemporaryDirectory(prefix='bashkar-win-latest-') as tmp:
    stage = Path(tmp)
    payload = stage / 'payload'
    with zipfile.ZipFile(old_zip) as archive:
        if archive.testzip():
            raise SystemExit('Historical runtime ZIP CRC failure.')
        for member in archive.infolist():
            name = Path(member.filename)
            if name.is_absolute() or '..' in name.parts:
                raise SystemExit('Unsafe historical ZIP member.')
            if member.is_dir() or not (member.filename.startswith('payload/desktop-runtime/') or member.filename.startswith('payload/node_modules/better-sqlite3/') or member.filename.startswith('payload/node_modules/bindings/') or member.filename.startswith('payload/node_modules/file-uri-to-path/') or member.filename == 'payload/node.exe' or member.filename == 'payload/BashkarPOSFoundationTest.exe'):
                continue
            target = stage / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(member))
    (payload / 'BashkarPOSFoundationTest.exe').rename(payload / 'BashkarPOSLatestTest.exe')
    resvg = payload / 'node_modules/@resvg/resvg-js'
    resvg.mkdir(parents=True)
    source = root / 'node_modules/.pnpm/@resvg+resvg-js@2.6.2/node_modules/@resvg/resvg-js'
    for name in ['index.js', 'js-binding.js', 'package.json', 'LICENSE']:
        if (source / name).exists():
            shutil.copy2(source / name, resvg / name)
    with tarfile.open(resvg_tgz, 'r:gz') as archive:
        binary = archive.extractfile('package/resvgjs.win32-x64-msvc.node')
        if binary is None:
            raise SystemExit('Missing Windows resvg binary.')
        (resvg / 'resvgjs.win32-x64-msvc.node').write_bytes(binary.read())
    server = payload / 'dist/apps/local-server/src'
    server.mkdir(parents=True)
    esbuild = root / 'node_modules/.bin/esbuild'
    shared = [str(esbuild), '--bundle', '--platform=node', '--target=node24', '--external:better-sqlite3', '--external:@resvg/resvg-js']
    subprocess.run(shared + ['apps/local-server/src/main.ts', '--outfile=' + str(server / 'main.js')], cwd=root, check=True)
    subprocess.run(shared + ['apps/local-server/src/modules/printing/render.ts', '--outfile=' + str(server / 'print-worker.js')], cwd=root, check=True)
    desktop = payload / 'desktop'
    desktop.mkdir()
    for file in (root / 'apps/pos-desktop').iterdir():
        if file.is_file() and file.suffix in ('.cjs', '.js', '.html', '.css'):
            shutil.copy2(file, desktop / file.name)
    shutil.copytree(root / 'apps/pos-desktop/assets', desktop / 'assets')
    shutil.copytree(root / 'apps/waiter-web', payload / 'apps/waiter-web')
    shutil.copytree(root / 'third-party/fonts', payload / 'third-party/fonts')
    printing = payload / 'infrastructure/printing'
    printing.mkdir(parents=True)
    for name in ['RawPrint.cs', 'build-helper.ps1']:
        shutil.copy2(root / 'infrastructure/printing' / name, printing / name)
    for name in ['install-latest-test.ps1', 'Start-Desktop-Latest-Test.ps1']:
        shutil.copy2(root / 'infrastructure/windows-service' / name, stage / name)
    (stage / 'README.txt').write_text(
        'Bashkar POS current-source Windows x64 isolated test package.\n'
        'This is a new test installation, not an update of MANGO or another profile.\n'
        '1. Extract the ZIP. Run install-latest-test.ps1 in elevated PowerShell.\n'
        '2. Start-Service BashkarPOSLatestTest. Run Start-Desktop-Latest-Test.ps1 as the cashier user.\n'
        'Port 3220. Data: %ProgramData%\\BashkarPOSLatestTest; Desktop profile: %LOCALAPPDATA%\\BashkarPOSLatestTest.\n'
        'A fresh database starts unactivated. Use a separate test branch for cloud activation.\n'
        'The Windows runtime and native modules are pinned. Real Windows, printer and upgrade acceptance remains to be run.\n', encoding='utf8')
    files = {str(p.relative_to(stage)).replace('\\', '/'): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(stage.rglob('*')) if p.is_file()}
    (stage / 'manifest.json').write_text(json.dumps({'schema': 18, 'source': 'current checkout', 'runtime_archive_sha256': old_digest, 'resvg_integrity_sha512': resvg_integrity, 'files': files}, indent=2) + '\n')
    output_zip.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output_zip, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
        for file in sorted(stage.rglob('*')):
            if file.is_file():
                archive.write(file, file.relative_to(stage))
print(output_zip)
