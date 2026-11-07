import { ShiftIdSchema, newId, type NotificationRequest, type ShiftId } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type { ReportReminderSource } from '../../domain/ports';
import type { ReportReminderFacts } from '../../domain/report-reminders';
import { remindReports } from '../report-reminders';

const NOW = new Date('2026-11-11T04:20:00Z');

const factsOf = (id: ShiftId, endedMinutesAgo: number): ReportReminderFacts => ({
  shift: {
    id,
    startsAt: new Date(NOW.getTime() - (endedMinutesAgo + 60) * 60_000),
    endsAt: new Date(NOW.getTime() - endedMinutesAgo * 60_000),
  },
  cancelled: false,
  reported: false,
  earningsSource: 'declared',
  member: { userId: `user-${id}`, status: 'active', timeZone: 'Europe/Paris' },
});

/** The shifts as the job reads them twice: the candidates, then each one's facts as they are when it rings. */
function sourceOf(facts: ReadonlyMap<ShiftId, ReportReminderFacts | null>): ReportReminderSource {
  return {
    candidatesUnscoped: () => Promise.resolve([...facts.keys()]),
    factsUnscoped: (id) => Promise.resolve(facts.get(id) ?? null),
  };
}

describe('remindReports (ADR 0077)', () => {
  it('rings each reminder due through notify, read again just before', async () => {
    const due = newId(ShiftIdSchema);
    const reportedSince = newId(ShiftIdSchema);
    const gone = newId(ShiftIdSchema);
    const early = newId(ShiftIdSchema);
    const asked: NotificationRequest[] = [];
    const run = await remindReports(
      {
        source: sourceOf(
          new Map([
            [due, factsOf(due, 20)],
            // A report sent between the two reads: nothing rings.
            [reportedSince, { ...factsOf(reportedSince, 20), reported: true }],
            [gone, null],
            [early, factsOf(early, 5)],
          ]),
        ),
        notify: (request) => {
          asked.push(request);
          return Promise.resolve('rang');
        },
      },
      () => NOW,
    );
    expect(asked.map((one) => one.objectKey)).toEqual([`shift-report:${due}:1`]);
    expect(run).toEqual({ candidates: 4, outcomes: { rang: 1 } });
  });

  it('rings the others when one fails, then fails with it', async () => {
    const broken = newId(ShiftIdSchema);
    const fine = newId(ShiftIdSchema);
    const asked: string[] = [];
    await expect(
      remindReports(
        {
          source: sourceOf(
            new Map([
              [broken, factsOf(broken, 20)],
              [fine, factsOf(fine, 12 * 60 + 5)],
            ]),
          ),
          notify: (request) => {
            if (request.userId === `user-${broken}`) return Promise.reject(new Error('base indisponible'));
            asked.push(request.objectKey);
            return Promise.resolve('held');
          },
        },
        () => NOW,
      ),
    ).rejects.toThrow('1 report reminder(s) failed');
    expect(asked).toEqual([`shift-report:${fine}:2`]);
  });
});
