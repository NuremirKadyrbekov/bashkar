import { execFileSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { assertManagerSystemIdentity, productionManagerPaths } from './update-manager-runtime';

export type LocalServiceAction = 'verify-backup' | 'restore-data' | 'verify-old-install' | 'verify-pre-migration';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The Task Scheduler principal is LocalService; each entry checks its own SID. */
export function runLocalServiceTask(action: LocalServiceAction, operationId: string) {
  assertManagerSystemIdentity();
  if (!uuid.test(operationId) || !['verify-backup', 'restore-data', 'verify-old-install', 'verify-pre-migration'].includes(action))
    throw new Error('UPDATE_LOCAL_TASK_INVALID');
  const paths = productionManagerPaths();
  const managerDir = dirname(paths.trustPath);
  const managerStat = lstatSync(managerDir);
  if (!managerStat.isDirectory() || managerStat.isSymbolicLink() ||
      realpathSync(managerDir).toLowerCase() !== resolve(managerDir).toLowerCase())
    throw new Error('UPDATE_LOCAL_TASK_PATH_INVALID');
  const node = join(managerDir, 'node.exe');
  const scripts: Record<LocalServiceAction, string> = {
    'verify-backup': join(managerDir, 'update-verify-backup.js'),
    'restore-data': join(managerDir, 'update-restore.js'),
    'verify-old-install': join(managerDir, 'update-verify-restore.js'),
    'verify-pre-migration': join(managerDir, 'update-verify-pre-migration.js')
  };
  for (const path of [node, scripts[action]]) {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
      throw new Error('UPDATE_LOCAL_TASK_PATH_INVALID');
  }
  const script = String.raw`
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$inputData = [Console]::In.ReadToEnd() | ConvertFrom-Json
$taskName = 'BashkarPOS-Update-' + $inputData.operationId + '-' + $inputData.action
$taskPath = '\'
$principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\LOCAL SERVICE' -LogonType ServiceAccount -RunLevel Limited
$arguments = '"' + $inputData.script + '" --operation=' + $inputData.operationId
$expectedAction = New-ScheduledTaskAction -Execute $inputData.node -Argument $arguments
$task = Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath -ErrorAction SilentlyContinue
if ($null -eq $task) {
  Register-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Action $expectedAction -Principal $principal |
    Out-Null
  $task = Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath -ErrorAction Stop
}
if ($task.Principal.UserId -ine 'NT AUTHORITY\LOCAL SERVICE' -or
    $task.Principal.LogonType -ne 'ServiceAccount' -or $task.Principal.RunLevel -ne 'Limited' -or
    $task.Triggers.Count -ne 0 -or $task.Actions.Count -ne 1 -or $task.Actions[0].Execute -ine $inputData.node -or
    $task.Actions[0].Arguments -cne $arguments) { throw 'UPDATE_LOCAL_TASK_MISMATCH' }
$info = Get-ScheduledTaskInfo -TaskName $taskName -TaskPath $taskPath
if ($task.State -ne 'Running' -and $info.LastRunTime.Year -lt 2000) {
  Start-ScheduledTask -TaskName $taskName -TaskPath $taskPath
}
$deadline = (Get-Date).AddMinutes(10)
do {
  Start-Sleep -Milliseconds 500
  $task = Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath
  $info = Get-ScheduledTaskInfo -TaskName $taskName -TaskPath $taskPath
  if ($task.State -ne 'Running' -and $info.LastRunTime.Year -ge 2000) { break }
} while ((Get-Date) -lt $deadline)
if ($task.State -eq 'Running' -or $info.LastRunTime.Year -lt 2000) { throw 'UPDATE_LOCAL_TASK_TIMEOUT' }
if ($info.LastTaskResult -ne 0) { throw 'UPDATE_LOCAL_TASK_FAILED' }
Unregister-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Confirm:$false
[Console]::Out.Write('OK')
`;
  try {
    const output = execFileSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { input: JSON.stringify({ action, operationId, node, script: scripts[action] }), encoding: 'utf8',
        timeout: 660000, maxBuffer: 4096, windowsHide: true });
    if (output !== 'OK') throw new Error('UPDATE_LOCAL_TASK_FAILED');
  } catch { throw new Error('UPDATE_LOCAL_TASK_FAILED'); }
}
