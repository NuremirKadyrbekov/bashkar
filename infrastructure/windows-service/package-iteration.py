"""Build a NEW isolated Windows test package. Never updates an installation.
Usage: python3 package-iteration.py STAGING_DEPENDENCIES DOWNLOADS ELECTRON_WIN_ZIP OUTPUT
The caller supplies an Electron archive verified by @electron/get/SHASUMS256.
"""
from pathlib import Path
import hashlib
import json
import shutil
import sqlite3
import subprocess
import sys
import uuid
import zipfile

if len(sys.argv) != 5:
    raise SystemExit(__doc__)
stage, downloads, electron_zip, output = map(lambda p: Path(p).resolve(), sys.argv[1:])
root = Path(__file__).resolve().parents[2]
if output.exists():
    raise SystemExit('Output exists; refusing to overwrite it.')
if electron_zip.name != 'electron-v45.0.0-win32-x64.zip':
    raise SystemExit('Unexpected Electron version/platform.')
output.mkdir(parents=True)
payload = output / 'payload'
main = payload / 'dist/apps/local-server/src/main.js'
main.parent.mkdir(parents=True)
subprocess.run([str(root / 'node_modules/.bin/esbuild'), 'apps/local-server/src/main.ts', '--bundle', '--platform=node', '--target=node24', '--external:better-sqlite3', '--outfile=' + str(main)], cwd=root, check=True)
# Existing helper verifies pinned Node/WinSW/SQLite SHA-256 and copies licenses.
subprocess.run([sys.executable, str(root / 'infrastructure/windows-service/package.py'), str(stage), str(downloads), str(output)], cwd=root, check=True)
for directory in sorted((payload / 'node_modules').rglob('*'), key=lambda p:len(p.parts), reverse=True):
    if directory.is_dir() and directory.name in ('test', 'tests', 'example', 'examples'):
        shutil.rmtree(directory)
(payload / 'BashkarPOSPrototype.exe').rename(payload / 'BashkarPOSFoundationTest.exe')
(output / 'install.ps1').unlink()
(output / 'WINDOWS-TEST.md').unlink()
for name in ['install-foundation-test.ps1', 'Start-Desktop-Test.ps1', 'ITERATION-001-ACCEPTANCE.md', 'smoke-bundle.cjs']:
    shutil.copy2(root / 'infrastructure/windows-service' / name, output / name)
shutil.copy2(root / 'PROGRESS.md', output / 'PROGRESS.md')
shutil.copy2(root / 'documents/ITERATION-001.md', output / 'ITERATION-001.md')
shutil.copy2(root / 'documents/API-ITERATION-001.md', output / 'API-ITERATION-001.md')
shutil.copy2(root / 'documents/CLOUD-ACTIVATION-001.md', output / 'CLOUD-ACTIVATION-001.md')
shutil.copy2(root / 'documents/API-TABLES-004.md', output / 'API-TABLES-004.md')
shutil.copy2(root / 'documents/API-ORDERS-005.md', output / 'API-ORDERS-005.md')
client = payload / 'desktop'
client.mkdir()
for name in ['main.cjs', 'preload.cjs', 'renderer.js', 'tables.js', 'orders.js', 'draft-store.cjs', 'index.html', 'style.css']:
    shutil.copy2(root / 'apps/pos-desktop' / name, client / name)
with zipfile.ZipFile(electron_zip) as archive:
    for info in archive.infolist():
        if Path(info.filename).is_absolute() or '..' in Path(info.filename).parts:
            raise SystemExit('Unsafe archive member.')
    archive.extractall(payload / 'desktop-runtime')
for name in ['SecLists-LICENSE', 'SecLists-PROVENANCE.md']:
    shutil.copy2(root / 'third-party' / name, output / 'licenses' / name)
fixture = output / 'fixtures/bootstrap-v1'
fixture.mkdir(parents=True)
identity = str(uuid.uuid4())
(fixture / 'installation.json').write_text(json.dumps({'format': 1, 'id': identity}), encoding='utf8')
sql = subprocess.check_output(['node', '-e', "process.stdout.write(require('./dist/apps/local-server/src/migrations/001-bootstrap.js').migration)"], cwd=root).decode()
with sqlite3.connect(fixture / 'pos.sqlite') as db:
    db.executescript(sql)
    db.execute('INSERT INTO bootstrap_instance VALUES(?,?)', (identity, 'UNACTIVATED'))
    db.execute('INSERT INTO schema_migrations VALUES(?,?)', (1, hashlib.sha256(sql.encode()).hexdigest()))
(output / 'README.txt').write_text('ISOLATED UNACCEPTED CLOUD ACTIVATION TEST PACKAGE. No default Owner.\nRead ITERATION-001-ACCEPTANCE.md and CLOUD-ACTIVATION-001.md. Install is NEW ONLY, never an upgrade.\nBefore activation readiness is 503 NEEDS_ACTIVATION. Activation really reserves the selected cloud branch.\nWindows LocalService/DPAPI/ACL/offline acceptance has NOT been run. Existing test services must be stopped explicitly.\nfixtures/bootstrap-v1 is empty synthetic data for explicit migration tests only; current schema is 5.\nNode 24.18.0 / Electron 45.0.0 / better-sqlite3 12.4.1 / WinSW checksum pinned by package.py.\n', encoding='utf8')
files = {str(p.relative_to(output)).replace('\\', '/'): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(output.rglob('*')) if p.is_file()}
manifest = {'status': 'UNACCEPTED_CLOUD_TEST_PACKAGE', 'schema': 5, 'electron_archive_sha256': hashlib.sha256(electron_zip.read_bytes()).hexdigest(), 'files': files}
(output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf8')
print('Prepared new isolated test package:', output)
