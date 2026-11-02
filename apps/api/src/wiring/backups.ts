import { JOB_PAYLOADS } from '@nirvana/contracts';

import { defineTask } from '../jobs';
import { startBackupsModule, type BackupsModule } from '../modules/backups';

import type { Routes, Shared, TasksOf } from './shared';

export interface WiredBackups {
  readonly module: BackupsModule;
  readonly tasks: TasksOf<'backups'>;
  readonly routes: readonly Routes[];
}

export function wireBackups(shared: Shared): WiredBackups {
  const { db, adminDb, logger, requireRole, recentLogin } = shared;
  const module = startBackupsModule({ db, adminDb });
  return {
    module,
    tasks: {
      'backups.check': defineTask(
        'backups.check',
        JOB_PAYLOADS['backups.check'],
        logger,
        async (_payload, context) => {
          const outcome = await module.jobs.check();
          if (outcome === 'alerted')
            context.logger.warn('backups: no export succeeded for 26 hours, owner alerted');
        },
      ),
    },
    routes: [module.routes({ guard: requireRole('owner'), recentLogin })],
  };
}
