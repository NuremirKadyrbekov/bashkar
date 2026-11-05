import { UpdateJournal } from './update-journal';
import { readUpdateJob, type UpdateJob } from './update-job';
import { planManagerResume, runManagerStep, type ManagerAction } from './manager-coordinator';
import { withManagerExecutionLock } from './manager-execution-lock';

/** Execute one journal operation under the OS lock; every step re-reads durable state. */
export async function runManagerOperation(input: {
  journal: UpdateJournal;
  configDir: string;
  job: UpdateJob;
  handlers: Partial<Record<ManagerAction, (operationId: string) => void | Promise<void>>>;
  lockPath?: string;
  maxSteps?: number;
}) {
  return withManagerExecutionLock(input.job.operationId, async () => {
    const persistedJob = readUpdateJob(input.configDir);
    if (!persistedJob || JSON.stringify(persistedJob) !== JSON.stringify(input.job))
      throw new Error('UPDATE_MANAGER_JOB_CHANGED');
    const maxSteps = input.maxSteps ?? 80;
    if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 200) throw new Error('UPDATE_MANAGER_STEP_LIMIT_INVALID');
    let next = planManagerResume(input);
    for (let step = 0; step < maxSteps; step++) {
      if (next.action === 'NEW_UPDATE_COMPLETED' || next.action === 'RECOVERY_COMPLETED') return next;
      if (next.action === 'MANUAL_RECONCILIATION_REQUIRED') throw new Error('UPDATE_MANAGER_MANUAL_RECONCILIATION_REQUIRED');
      const before = input.journal.read();
      try { next = await runManagerStep(input); }
      catch (error) {
        // A handler may have durably written an intent just before failing.
        // Re-plan only when that exact operation advanced to another phase.
        const after = input.journal.read();
        if (!after || after.operationId !== input.job.operationId || after.phase === before?.phase) throw error;
        next = planManagerResume(input);
        if (next.action === 'MANUAL_RECONCILIATION_REQUIRED') throw error;
      }
    }
    throw new Error('UPDATE_MANAGER_STEP_LIMIT');
  }, input.lockPath);
}
