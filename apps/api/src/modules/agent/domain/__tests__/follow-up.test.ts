import { DEFAULT_AGENT_HOURS, type AgentHours } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { followUpDecision, type FollowUpMoment } from '../follow-up';

// Paris is UTC+1 after the last Sunday of October: 14:00 UTC is 15:00 her time.
const AFTERNOON = new Date('2026-10-27T14:00:00.000Z');
const base: FollowUpMoment = { step: 0, steps: 2, flags: {}, now: AFTERNOON, timeZone: 'Europe/Paris' };

describe('followUpDecision', () => {
  it('writes a follow-up in her day, whatever his sales limits', () => {
    expect(followUpDecision(base)).toEqual({ kind: 'write' });
    expect(
      followUpDecision({
        ...base,
        step: 1,
        flags: { salesFrozen: { reason: 'money_trouble', since: '2026-10-20T10:00:00.000Z' }, fragile: true },
      }),
    ).toEqual({ kind: 'write' });
  });

  it('never writes to a fan nobody may write to, nor to one in distress', () => {
    expect(followUpDecision({ ...base, flags: { doNotContact: true } })).toEqual({
      kind: 'skip',
      reason: 'follow_up_do_not_contact',
    });
    expect(
      followUpDecision({
        ...base,
        flags: { salesFrozen: { reason: 'distress', since: '2026-10-20T10:00:00.000Z' } },
      }),
    ).toEqual({ kind: 'skip', reason: 'follow_up_distress' });
  });

  it('stops past her last delay', () => {
    expect(followUpDecision({ ...base, step: 2 })).toEqual({ kind: 'skip', reason: 'follow_up_plan_over' });
    expect(followUpDecision({ ...base, steps: 0 })).toEqual({ kind: 'skip', reason: 'follow_up_plan_over' });
  });

  it('puts it off to 9:00 her time in her quiet hours', () => {
    // 00:30 and 23:10 in Paris, then 08:59: the next 9:00 is 08:00 UTC.
    for (const now of ['2026-10-27T23:30:00.000Z', '2026-10-27T22:10:00.000Z', '2026-10-28T07:59:00.000Z']) {
      expect(followUpDecision({ ...base, now: new Date(now) })).toEqual({
        kind: 'later',
        reason: 'follow_up_quiet_hours',
        at: new Date('2026-10-28T08:00:00.000Z'),
      });
    }
    expect(followUpDecision({ ...base, now: new Date('2026-10-28T08:00:00.000Z') })).toEqual({
      kind: 'write',
    });
  });

  it('follows her hours (P3-14): out of her slots, at the next opening out of her quiet hours', () => {
    // Tuesday only, 10:00 to 12:00, and quiet from 22:00 to 10:30.
    const hours: AgentHours = {
      ...DEFAULT_AGENT_HOURS,
      reply: { mode: 'slots', slots: [{ day: 2, startMinute: 600, endMinute: 720, enabled: true }] },
      followUpQuiet: { startMinute: 1320, endMinute: 630 },
    };
    // 15:00 Tuesday: closed until next Tuesday 10:30 (10:00 is still quiet).
    expect(followUpDecision({ ...base, hours })).toEqual({
      kind: 'later',
      reason: 'follow_up_outside_hours',
      at: new Date('2026-11-03T09:30:00.000Z'),
    });
    // 10:10 Tuesday: open, but quiet until 10:30.
    expect(followUpDecision({ ...base, hours, now: new Date('2026-10-27T09:10:00.000Z') })).toEqual({
      kind: 'later',
      reason: 'follow_up_quiet_hours',
      at: new Date('2026-10-27T09:30:00.000Z'),
    });
    expect(followUpDecision({ ...base, hours, now: new Date('2026-10-27T09:45:00.000Z') })).toEqual({
      kind: 'write',
    });
  });

  it('writes none when her slots all fall in her quiet hours', () => {
    const hours: AgentHours = {
      ...DEFAULT_AGENT_HOURS,
      reply: { mode: 'slots', slots: [{ day: 2, startMinute: 1380, endMinute: 60, enabled: true }] },
    };
    for (const now of ['2026-10-27T14:00:00.000Z', '2026-10-27T22:30:00.000Z']) {
      expect(followUpDecision({ ...base, hours, now: new Date(now) })).toEqual({
        kind: 'skip',
        reason: 'follow_up_no_allowed_hour',
      });
    }
  });
});
