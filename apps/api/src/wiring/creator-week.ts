import { ContentRequestIdSchema, JOB_PAYLOADS } from '@impera/contracts';
import { withAdmin } from '@impera/db';

import { defineTask } from '../jobs';
import { weekArrivalsUnscoped, weekStockUnscoped } from '../modules/content-drops';
import {
  dispoMinutesByWeekdayUnscoped,
  shootDaysOfWeekUnscoped,
  type CreatorTasksModule,
} from '../modules/creator-tasks';
import {
  createCreatorWeekModule,
  type CreatorWeekModule,
  type WeekFactsReader,
} from '../modules/creator-week';

import type { Routes, Shared, TasksOf } from './shared';

export interface WiredCreatorWeek {
  readonly module: CreatorWeekModule;
  readonly tasks: TasksOf<'creator_week'>;
  readonly routes: readonly Routes[];
}

/**
 * Her week (ADR 0140): computed from her drops' stock and scripts asked (`content-drops`), her shooting days and dispos
 * (`creator-tasks`), read here on the admin connection bounded to her; written in her agenda through its own door.
 */
export function wireCreatorWeek(
  shared: Shared,
  deps: { readonly creatorTasks: CreatorTasksModule },
): WiredCreatorWeek {
  const { adminDb } = shared;
  const facts: WeekFactsReader = {
    facts: (creatorId, dueBy) =>
      withAdmin(adminDb, async (tx) => {
        const read = await weekStockUnscoped(tx, creatorId, dueBy);
        return {
          stock: {
            feed: (read.stock.feed_shoot ?? 0) + (read.stock.feed_video ?? 0),
            stories: read.stock.reveal_story ?? 0,
          },
          scripts: read.scripts.map((script) => ({
            requestId: ContentRequestIdSchema.parse(script.requestId),
            name: script.name,
          })),
        };
      }),
    shootDaysOf: (creatorId, week) =>
      withAdmin(adminDb, (tx) => shootDaysOfWeekUnscoped(tx, creatorId, week)),
    dispoMinutes: (creatorId) => withAdmin(adminDb, (tx) => dispoMinutesByWeekdayUnscoped(tx, creatorId)),
    arrivals: (creatorId, window, requestIds) =>
      withAdmin(adminDb, (tx) => weekArrivalsUnscoped(tx, creatorId, window, requestIds)),
  };
  const module = createCreatorWeekModule({
    db: shared.db,
    adminDb,
    requireRole: shared.requireRole,
    agenda: deps.creatorTasks.week,
    accept: deps.creatorTasks.accept,
    facts,
  });
  return {
    module,
    tasks: {
      'creator_week.plan': defineTask(
        'creator_week.plan',
        JOB_PAYLOADS['creator_week.plan'],
        shared.logger,
        async (_payload, context) => {
          const run = await module.jobs.plan(new Date());
          if (run.failed.length > 0)
            context.logger.warn({ failed: run.failed }, 'creator-week: weeks that could not be computed');
          context.logger.info(run.outcomes, 'creator-week: weeks computed');
        },
      ),
    },
    routes: [module.routes],
  };
}
