import { JOB_PAYLOADS } from '@impera/contracts';

import { defineTask } from '../jobs';
import { createCreatorTasksModule, type CreatorTasksModule } from '../modules/creator-tasks';
import type { NotificationsModule } from '../modules/notifications';

import type { Routes, Shared, TasksNamed } from './shared';

export interface WiredCreatorTasks {
  readonly module: CreatorTasksModule;
  /** `creator_tasks.suggestion_decided` is the trend watch's to handle (`wiring/trends.ts`). */
  readonly tasks: TasksNamed<'creator_tasks.remind'>;
  readonly routes: readonly Routes[];
}

/**
 * Her agenda (CR-05): the time helpers come from `scheduling/pure.ts`; her reminders ring through the `notifications`
 * module's `notify` (lot b3).
 */
export function wireCreatorTasks(
  shared: Shared,
  deps: { readonly notifications: NotificationsModule },
): WiredCreatorTasks {
  const module = createCreatorTasksModule({
    db: shared.db,
    adminDb: shared.adminDb,
    requireRole: shared.requireRole,
    notify: deps.notifications.notify,
  });
  return {
    module,
    tasks: {
      'creator_tasks.remind': defineTask(
        'creator_tasks.remind',
        JOB_PAYLOADS['creator_tasks.remind'],
        shared.logger,
        async (payload, context) => {
          if (module.remind === null) {
            context.logger.warn('creator-tasks: push is off, her reminder stays in her agenda');
            return;
          }
          const outcomes = await module.remind(payload, new Date());
          context.logger.info({ accounts: outcomes.length, outcomes }, 'creator-tasks: reminder');
        },
      ),
    },
    routes: [module.routes],
  };
}
