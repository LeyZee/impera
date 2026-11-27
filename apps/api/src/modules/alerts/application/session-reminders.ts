import type { NotificationOutcome, NotificationRequest } from '@impera/contracts';

import { sessionRemindersDue, type SessionReminderClock } from '../domain/agency/session-reminder';

import type { RouterReads } from './route';

export interface SessionReminderDeps {
  /** The owners, each with their own clock for the quiet hours. */
  readonly owners: RouterReads['owners'];
  /** Every account holding a session, with its token's expiry (`connectors`). */
  readonly clocks: () => Promise<readonly SessionReminderClock[]>;
  /** The agency's minute for the reminder and its clock (`scheduling`). */
  readonly reminder: () => Promise<{ readonly minute: number; readonly timeZone: string }>;
  readonly notify: (request: NotificationRequest, at: Date) => Promise<NotificationOutcome>;
  readonly onFailure?: (step: string, error: unknown) => void;
}

/**
 * `alerts.remind_sessions` (every 5 minutes, décision du 27/11/2026): each reminder due to reconnect an AI's platform
 * session, to every owner (Charles and Luca), as an agency alert (`agency_alert`: outside the daily cap, held in the
 * quiet hours, never a wake-up). An owner not told is logged, the others are told all the same, the next run tries
 * again (the key is the account and the day, or the token). Returns the notifications asked.
 */
export async function remindSessions(deps: SessionReminderDeps, now: Date): Promise<number> {
  const clocks = await deps.clocks();
  if (clocks.length === 0) return 0;
  const { minute, timeZone } = await deps.reminder();
  const due = sessionRemindersDue({ clocks, minute, timeZone, now });
  if (due.length === 0) return 0;
  const owners = await deps.owners();
  let asked = 0;
  for (const reminder of due) {
    for (const owner of owners) {
      try {
        await deps.notify(
          {
            userId: owner.userId,
            reason: 'agency_alert',
            objectKey: reminder.objectKey,
            timeZone: owner.timeZone,
            message: reminder.message,
          },
          now,
        );
        asked += 1;
      } catch (error) {
        deps.onFailure?.('notify', error);
      }
    }
  }
  return asked;
}
