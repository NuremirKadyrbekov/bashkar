import { execFileSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { join } from 'node:path';

/** Fail closed while any node.exe from the switched application is still alive. */
export function assertNoActiveMigrationProcess(appDir: string) {
  if (process.platform !== 'win32') throw new Error('UPDATE_WINDOWS_REQUIRED');
  const node = join(appDir, 'node.exe');
  const stat = lstatSync(node);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
    throw new Error('UPDATE_MIGRATION_EXECUTABLE_INVALID');
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$expected = [Console]::In.ReadToEnd() | ConvertFrom-Json
$running = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
  $_.ExecutablePath -and $_.ExecutablePath -ieq $expected.node
})
[Console]::Out.Write($running.Count)
`;
  let output: string;
  try {
    output = execFileSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { input: JSON.stringify({ node }), encoding: 'utf8', timeout: 15000, maxBuffer: 64, windowsHide: true });
  } catch { throw new Error('UPDATE_MIGRATION_PROCESS_UNCERTAIN'); }
  if (output !== '0') throw new Error('UPDATE_MIGRATION_PROCESS_ACTIVE');
}
