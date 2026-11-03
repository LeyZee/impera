import type { NotificationOutcome, NotificationRequest } from '@impera/contracts';

import type { ReminderSource } from '../domain/ports';
import { reminderMessage } from '../domain/reminder';

export interface RemindDeps {
  readonly source: ReminderSource;
  /** The `notifications` module's `notify` (CR-01): once per account, reason and object, under her quiet hours. */
  readonly notify: (request: NotificationRequest, at: Date) => Promise<NotificationOutcome>;
}

/**
 * `creator_tasks.remind` (CR-05 lot b3): each of her accounts told once that a task is coming, if it still is at the
 * start the job was scheduled for. A task removed, moved or started rings nothing, and a replayed job rings nothing
 * twice: the object is the task and its start.
 */
export async function remind(
  deps: RemindDeps,
  payload: { readonly taskId: string; readonly startsAt: string },
  at: Date,
): Promise<readonly NotificationOutcome[]> {
  const found = await deps.source.reminderOf(payload.taskId);
  if (found === null) return [];
  const message = reminderMessage(found.task, payload.startsAt, found.timeZone, at);
  if (message === null) return [];
  const outcomes: NotificationOutcome[] = [];
  for (const userId of found.accounts)
    outcomes.push(
      await deps.notify(
        {
          userId,
          reason: 'reminder',
          objectKey: `task:${payload.taskId}:${payload.startsAt}`,
          timeZone: found.timeZone,
          message,
        },
        at,
      ),
    );
  return outcomes;
}
