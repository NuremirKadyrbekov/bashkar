"""Build an isolated Windows x64 test ZIP from the current checkout.

Usage: python3 infrastructure/windows-service/package-catalog-test.py RUNTIME_ZIP PREVIOUS_ZIP OUTPUT_ZIP
The pinned Windows runtimes and native modules are reused from verified historical test ZIPs.
"""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import zipfile

root = Path(__file__).resolve().parents[2]
if len(sys.argv) != 4:
    raise SystemExit(__doc__)
old_zip, previous_zip, output_zip = map(lambda x: Path(x).resolve(), sys.argv[1:])
if output_zip.exists():
    raise SystemExit('Output already exists; refusing overwrite.')
old_digest = '47d90f2aeac92e8675d908a4b0a888a95567588616e8c83b5b0e973b6c4f1eee'
previous_digest = 'bd56c4ba1212440333ed7a73ff9d0dee73c555fd030c91b43fd9c4fb02be89c6'
if hashlib.sha256(old_zip.read_bytes()).hexdigest() != old_digest:
    raise SystemExit('Historical runtime ZIP checksum mismatch.')
if hashlib.sha256(previous_zip.read_bytes()).hexdigest() != previous_digest:
    raise SystemExit('Previous package checksum mismatch.')
with tempfile.TemporaryDirectory(prefix='bashkar-win-catalog-') as tmp:
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
    (payload / 'BashkarPOSFoundationTest.exe').rename(payload / 'BashkarPOSCatalogTest.exe')
    resvg = payload / 'node_modules/@resvg/resvg-js'
    resvg.mkdir(parents=True)
    source = root / 'node_modules/.pnpm/@resvg+resvg-js@2.6.2/node_modules/@resvg/resvg-js'
    for name in ['index.js', 'js-binding.js', 'package.json', 'LICENSE']:
        if (source / name).exists():
            shutil.copy2(source / name, resvg / name)
    with zipfile.ZipFile(previous_zip) as archive:
        if archive.testzip():
            raise SystemExit('Previous package CRC failure.')
        name = 'payload/node_modules/@resvg/resvg-js/resvgjs.win32-x64-msvc.node'
        binary = archive.read(name)
        if hashlib.sha256(binary).hexdigest() != 'a762c7c3d34a0083e50e44a88b6bb95bbc156386ae473e6eb7231c27cb23c04d':
            raise SystemExit('Windows resvg binary checksum mismatch.')
        (resvg / 'resvgjs.win32-x64-msvc.node').write_bytes(binary)
    server = payload / 'dist/apps/local-server/src'
    server.mkdir(parents=True)
    esbuild = root / 'node_modules/.bin/esbuild'
    forge = payload / 'node_modules/node-forge'
    (forge / 'dist').mkdir(parents=True)
    forge_source = root / 'node_modules/.pnpm/node-forge@1.4.0/node_modules/node-forge'
    shutil.copy2(forge_source / 'package.json', forge / 'package.json')
    shutil.copy2(forge_source / 'dist/forge.min.js', forge / 'dist/forge.min.js')
    shared = [str(esbuild), '--bundle', '--platform=node', '--target=node24', '--external:better-sqlite3', '--external:@resvg/resvg-js', '--external:node-forge/dist/forge.min.js']
    subprocess.run(shared + ['apps/local-server/src/main.ts', '--outfile=' + str(server / 'main.js')], cwd=root, check=True)
    subprocess.run(shared + ['apps/local-server/src/modules/printing/render.ts', '--outfile=' + str(server / 'print-worker.js')], cwd=root, check=True)
    desktop = payload / 'desktop'
    desktop.mkdir()
    for file in (root / 'apps/pos-desktop').iterdir():
        if file.is_file() and file.suffix in ('.cjs', '.js', '.html', '.css'):
            shutil.copy2(file, desktop / file.name)
    # ExcelJS is a desktop-main dependency; bundle it with the import module.
    subprocess.run(shared + ['apps/pos-desktop/menu-import-file.cjs', '--format=cjs', '--outfile=' + str(desktop / 'menu-import-file.cjs')], cwd=root, check=True)
    shutil.copytree(root / 'apps/pos-desktop/assets', desktop / 'assets')
    shutil.copytree(root / 'apps/waiter-web', payload / 'apps/waiter-web')
    shutil.copytree(root / 'third-party/fonts', payload / 'third-party/fonts')
    printing = payload / 'infrastructure/printing'
    printing.mkdir(parents=True)
    for name in ['RawPrint.cs', 'build-helper.ps1']:
        shutil.copy2(root / 'infrastructure/printing' / name, printing / name)
    for name in ['install-catalog-test.ps1', 'Start-Desktop-Catalog-Test.ps1']:
        shutil.copy2(root / 'infrastructure/windows-service' / name, stage / name)
    (payload / 'Start-Bashkar-Catalog.cmd').write_text(
        '@echo off\r\nset "BASHKAR_DESKTOP_PORT=3221"\r\nset "BASHKAR_TEST_CLIENT=1"\r\n'
        '"%ProgramFiles%\\BashkarPOSCatalogTest\\desktop-runtime\\electron.exe" '
        '"--user-data-dir=%LOCALAPPDATA%\\BashkarPOSCatalogTest" '
        '"%ProgramFiles%\\BashkarPOSCatalogTest\\desktop\\main.cjs"\r\n', encoding='ascii')
    (stage / 'README.txt').write_text(
        'Bashkar POS: отдельная тестовая установка для Windows x64.\n'
        'Существующие MANGO и другие установки не обновляются.\n'
        '1. Распакуйте архив в отдельную папку.\n'
        '2. Откройте PowerShell от имени администратора в этой папке и выполните:\n'
        '   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\install-catalog-test.ps1\n'
        '3. Запустите службу: Start-Service BashkarPOSCatalogTest\n'
        '4. Откройте «Bashkar POS Catalog Test» через меню Пуск под обычным пользователем.\n'
        'Порт: 3221. Данные: %ProgramData%\\BashkarPOSCatalogTest.\n'
        'Профиль Desktop: %LOCALAPPDATA%\\BashkarPOSCatalogTest.\n'
        'База создаётся без активации и без готового Owner. Для проверки входа нужен отдельный тестовый филиал.\n'
        'Проверка на настоящем Windows и принтере выполняется отдельно.\n', encoding='utf8')
    files = {str(p.relative_to(stage)).replace('\\', '/'): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(stage.rglob('*')) if p.is_file()}
    schema = int(subprocess.check_output(['node', '-e', "console.log(require('./dist/apps/local-server/src/migrations').latestSchema)"], cwd=root, text=True).strip())
    (stage / 'manifest.json').write_text(json.dumps({'schema': schema, 'source': 'current checkout', 'runtime_archive_sha256': old_digest, 'previous_archive_sha256': previous_digest, 'files': files}, indent=2) + '\n')
    output_zip.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output_zip, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
        for file in sorted(stage.rglob('*')):
            if file.is_file():
                archive.write(file, file.relative_to(stage))
print(output_zip)
