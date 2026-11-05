import type { ManagerAction } from './manager-coordinator';
import { runLocalServiceTask, type LocalServiceAction } from './local-service-task';

const taskForAction = {
  VERIFY_BACKUP_WITH_LOCAL_SERVICE: 'verify-backup',
  VERIFY_PRE_MIGRATION_DATA_WITH_LOCAL_SERVICE: 'verify-pre-migration',
  RESTORE_DATA_WITH_LOCAL_SERVICE: 'restore-data',
  VERIFY_OLD_INSTALL_WITH_LOCAL_SERVICE: 'verify-old-install'
} as const satisfies Partial<Record<ManagerAction, LocalServiceAction>>;

/** SYSTEM dispatches fixed commands; each child independently verifies the LocalService SID. */
export function localServiceManagerHandlers(runTask: (action: LocalServiceAction, operationId: string) => void | Promise<void> = runLocalServiceTask) {
  return Object.fromEntries(Object.entries(taskForAction).map(([action, task]) =>
    [action, (operationId: string) => runTask(task, operationId)])) as {
    [K in keyof typeof taskForAction]: (operationId: string) => void | Promise<void>
  };
}
