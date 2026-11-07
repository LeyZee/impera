import type { NotificationOutcome } from '@impera/contracts';

import type { Notify, ReportReminderSource } from '../domain/ports';
import { reportReminder, reportReminderDue } from '../domain/report-reminders';

export interface ReportRemindersRun {
  /** The shifts read in a window, before their facts were read again. */
  readonly candidates: number;
  /** What `notify` made of each reminder due. */
  readonly outcomes: Readonly<Partial<Record<NotificationOutcome, number>>>;
}

/**
 * `scheduling.remind_reports` (ADR 0077): each shift ended in a window without its report, read again just before it
 * rings (a report sent in between, a shift cancelled, rules changed: nothing rings), then told to its member through
 * `notify`, which rings each reminder once. One shift that fails never keeps the others from ringing: the run goes to
 * the end, then fails with the first error, and the next run takes the rest again.
 */
export async function remindReports(
  deps: { readonly source: ReportReminderSource; readonly notify: Notify },
  now: () => Date,
): Promise<ReportRemindersRun> {
  const candidates = await deps.source.candidatesUnscoped(now());
  const outcomes: Partial<Record<NotificationOutcome, number>> = {};
  const failures: unknown[] = [];
  for (const shiftId of candidates) {
    try {
      const facts = await deps.source.factsUnscoped(shiftId);
      if (facts === null) continue;
      const at = now();
      const rank = reportReminderDue(facts, at);
      if (rank === null) continue;
      const outcome = await deps.notify(reportReminder(rank, facts, at), at);
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new Error(`${String(failures.length)} report reminder(s) failed`, { cause: failures[0] });
  }
  return { candidates: candidates.length, outcomes };
}
