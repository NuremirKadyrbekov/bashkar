"""Prepare an immutable source/runtime staging folder, never an installation.
Usage: python3 infrastructure/windows-service/prepare-block-c.py NEW_OUTPUT
Windows dependencies, Node/Electron runtime and USB helper build remain separate.
"""
from pathlib import Path
import hashlib
import json
import shutil
import sys
root = Path(__file__).resolve().parents[2]
if len(sys.argv) != 2:
    raise SystemExit(__doc__)
output = Path(sys.argv[1]).resolve()
if output.exists() or output == root or root in output.parents:
    raise SystemExit('Use a NEW folder outside the source checkout.')
compiled = root / 'dist/apps/local-server/src'
if not (compiled / 'modules/printing/render.js').exists():
    raise SystemExit('Run pnpm run build first.')
output.mkdir(parents=True)
for relative in ['dist/apps/local-server/src', 'apps/waiter-web', 'third-party', 'infrastructure/printing', 'infrastructure/waiter']:
    shutil.copytree(root / relative, output / relative, ignore=shutil.ignore_patterns('bin', '__pycache__'))
client = output / 'apps/pos-desktop'
client.mkdir(parents=True)
for path in (root / 'apps/pos-desktop').iterdir():
    if path.is_file() and path.suffix in ['.cjs', '.js', '.html', '.css']:
        shutil.copy2(path, client / path.name)
for relative in ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']:
    shutil.copy2(root / relative, output / relative)
for relative in ['documents/API-WAITER-009.md', 'documents/API-PRINT-010.md', 'documents/BLOCK-C-ACCEPTANCE-001.md', 'documents/BLOCK-C-TECH-UI-SPEC-001.md']:
    target = output / relative
    target.parent.mkdir(exist_ok=True)
    shutil.copy2(root / relative, target)
files = {str(p.relative_to(output)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(output.rglob('*')) if p.is_file()}
(output / 'manifest.json').write_text(json.dumps({'version':'0.9.0-service-clients','schema':10,'status':'UNACCEPTED_STAGING_NO_WINDOWS_RUNTIME','files':files}, indent=2)+'\n')
print('Prepared staging only:', output)
