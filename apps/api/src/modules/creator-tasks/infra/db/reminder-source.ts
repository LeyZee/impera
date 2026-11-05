import { and, eq, schema, sql, withAdmin, type Database } from '@impera/db';

import type { ReminderSource } from '../../domain/ports';

import { taskOf } from './rows';

const tasks = schema.creatorTasks;

/**
 * A task of her reminder and her accounts, by the job's role (`withAdmin`, as the other jobs: a job has no account to
 * read under). A task removed answers null. Her accounts are the ones whose role is `creator` and whose only creator
 * is hers (one link per account since CR-02), as for her sales.
 */
export function createReminderSource(adminDb: Database): ReminderSource {
  return {
    reminderOf: (taskId) =>
      withAdmin(adminDb, async (tx) => {
        const [row] = await tx
          .select({ task: tasks, timeZone: schema.creators.timezone })
          .from(tasks)
          .innerJoin(schema.creators, eq(schema.creators.id, tasks.creatorId))
          .where(and(eq(tasks.id, taskId), sql`${tasks.archivedAt} is null`));
        if (row === undefined) return null;
        const accounts = await tx
          .select({ id: schema.user.id })
          .from(schema.user)
          .where(
            and(
              eq(schema.user.role, 'creator'),
              sql`${schema.user.creatorIds} = array[${row.task.creatorId}]::uuid[]`,
            ),
          )
          .orderBy(schema.user.id);
        return {
          task: taskOf(row.task),
          timeZone: row.timeZone,
          accounts: accounts.map((account) => account.id),
        };
      }),
  };
}
