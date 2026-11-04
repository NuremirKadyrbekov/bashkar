"""Assemble a test package from a built bundle and downloaded release artifacts."""
import hashlib
import os
from pathlib import Path
import shutil
import sys
import tarfile
import zipfile

if len(sys.argv) != 4:
    raise SystemExit('Usage: python3 package.py STAGING_DEPENDENCIES DOWNLOADS OUTPUT_DIR')
stage, downloads, output = map(Path, sys.argv[1:])
expected = {'node.zip': '0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821', 'sqlite.tar.gz': 'c5e81040cc13c44404d9b033d01ed4b246de9908404c13218e31d7e2db44fd78', 'winsw.exe': '05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da'}
for name, digest in expected.items():
    if hashlib.sha256((downloads / name).read_bytes()).hexdigest() != digest:
        raise SystemExit('Unexpected checksum: ' + name)
payload = output / 'payload'
if not (payload / 'dist/apps/local-server/src/main.js').is_file():
    raise SystemExit('First bundle main.ts into payload/dist/apps/local-server/src/main.js using esbuild.')
with zipfile.ZipFile(downloads / 'node.zip') as z:
    for src, dest in [('node-v24.18.0-win-x64/node.exe', 'node.exe'), ('node-v24.18.0-win-x64/LICENSE', 'NODE-LICENSE')]:
        (payload / dest).write_bytes(z.read(src))
shutil.copy2(downloads / 'winsw.exe', payload / 'BashkarPOSPrototype.exe')
modules = payload / 'node_modules'
for folder, name in [('better-sqlite3@12.4.1', 'better-sqlite3'), ('bindings@1.5.0', 'bindings'), ('file-uri-to-path@1.0.0', 'file-uri-to-path')]:
    dest = modules / name
    if dest.exists(): shutil.rmtree(dest)
    shutil.copytree(stage / '.pnpm' / folder / 'node_modules' / name, dest, ignore=shutil.ignore_patterns('node_modules', 'deps', 'src', '*.gyp', 'build'))
with tarfile.open(downloads / 'sqlite.tar.gz', 'r:gz') as t:
    binary = t.extractfile('build/Release/better_sqlite3.node')
    if binary is None: raise SystemExit('Missing SQLite binary')
    dest = modules / 'better-sqlite3/build/Release/better_sqlite3.node'
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(binary.read())
script = Path(__file__).resolve().parent
for name in ['install.ps1', 'WINDOWS-TEST.md']:
    shutil.copy2(script / name, output / name)
licenses = output / 'licenses'
licenses.mkdir(exist_ok=True)
for pkg in (stage / '.pnpm').glob('*/node_modules/*'):
    if pkg.is_symlink() or not pkg.is_dir() or pkg.name.startswith('@'): continue
    for license_file in pkg.glob('LICENSE*'):
        if license_file.is_file(): shutil.copy2(license_file, licenses / (pkg.name + '-' + license_file.name))
