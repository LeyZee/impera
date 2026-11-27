import { PlatformAccountIdSchema, type NotificationRequest } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type { SessionReminderClock } from '../../domain/agency/session-reminder';
import { remindSessions } from '../session-reminders';

/** 18 h in Paris in November is 17:00Z. An invented account of a demo creator. */
const SIX_PM_PARIS = new Date('2026-11-27T17:00:00Z');
const account = PlatformAccountIdSchema.parse('018f0000-0000-7000-8000-0000000000c1');
const dying: SessionReminderClock = {
  platformAccountId: account,
  platform: 'reveal',
  creatorName: 'Créatrice Démo',
  state: 'valid',
  expiresAt: new Date('2026-11-27T17:05:00Z'),
};

function harness(options: { clocks?: readonly SessionReminderClock[]; failFor?: string } = {}) {
  const asked: NotificationRequest[] = [];
  const failures: string[] = [];
  let reminderRead = 0;
  const deps = {
    owners: () =>
      Promise.resolve([
        { userId: 'owner-1', timeZone: 'Europe/Paris' },
        { userId: 'owner-2', timeZone: 'Europe/Paris' },
      ]),
    clocks: () => Promise.resolve(options.clocks ?? [dying]),
    reminder: () => {
      reminderRead += 1;
      return Promise.resolve({ minute: 18 * 60, timeZone: 'Europe/Paris' });
    },
    notify: (request: NotificationRequest) => {
      if (request.userId === options.failFor) return Promise.reject(new Error('push service away'));
      asked.push(request);
      return Promise.resolve('rang' as const);
    },
    onFailure: (step: string) => {
      failures.push(step);
    },
  };
  return { deps, asked, failures, reminderRead: () => reminderRead };
}

describe('alerts.remind_sessions (décision du 27/11/2026)', () => {
  it('tells every owner, as an agency alert held in the quiet hours, never a wake-up', async () => {
    const { deps, asked } = harness();
    expect(await remindSessions(deps, SIX_PM_PARIS)).toBe(2);
    expect(asked.map((request) => request.userId)).toEqual(['owner-1', 'owner-2']);
    expect(asked.every((request) => request.reason === 'agency_alert')).toBe(true);
    expect(asked[0]?.objectKey).toBe(`session_reminder:${account}:2026-11-27:daily`);
  });

  it('tells the other owner when one cannot be told, and says which step failed', async () => {
    const { deps, asked, failures } = harness({ failFor: 'owner-1' });
    expect(await remindSessions(deps, SIX_PM_PARIS)).toBe(1);
    expect(asked.map((request) => request.userId)).toEqual(['owner-2']);
    expect(failures).toEqual(['notify']);
  });

  it('reads nothing more without a session to watch, and rings nothing outside its hours', async () => {
    const none = harness({ clocks: [] });
    expect(await remindSessions(none.deps, SIX_PM_PARIS)).toBe(0);
    expect(none.reminderRead()).toBe(0);
    const noon = harness();
    expect(await remindSessions(noon.deps, new Date('2026-11-27T11:00:00Z'))).toBe(0);
    expect(noon.asked).toEqual([]);
  });
});
