import { describe, expect, it } from 'vitest';

import {
  AgentHourExceptionSchema,
  DEFAULT_AGENT_HOURS,
  localDate,
  replyOpenWithExceptions,
  SetAgentHourExceptionBodySchema,
  type AgentHours,
} from './agent-hours';
import { SetAgentModeBodySchema } from './dashboard';

const PARIS = 'Europe/Paris';
const CREATOR = '0193b1d2-7c1e-7000-8000-000000000001';

/** Her weekdays 9:00 to 1:00 the next day, every day. */
const NIGHTS: AgentHours = {
  ...DEFAULT_AGENT_HOURS,
  reply: {
    mode: 'slots',
    slots: [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, startMinute: 540, endMinute: 60, enabled: true })),
  },
};

describe('AgentHourExceptionSchema (ADR 0148 § 3)', () => {
  it('takes a date and ranges inside the day, midnight as an end', () => {
    const parsed = AgentHourExceptionSchema.parse({
      date: '2026-11-20',
      ranges: [
        { startMinute: 0, endMinute: 240 },
        { startMinute: 1320, endMinute: 1440 },
      ],
    });
    expect(parsed.ranges).toHaveLength(2);
  });

  it('takes no range: no agent that day', () => {
    expect(SetAgentHourExceptionBodySchema.parse({ ranges: [] }).ranges).toEqual([]);
  });

  it('refuses a range that ends before it starts, or two that overlap, naming the other', () => {
    expect(
      SetAgentHourExceptionBodySchema.safeParse({ ranges: [{ startMinute: 600, endMinute: 600 }] }).success,
    ).toBe(false);
    const overlap = SetAgentHourExceptionBodySchema.safeParse({
      ranges: [
        { startMinute: 1200, endMinute: 1440 },
        { startMinute: 1380, endMinute: 1410 },
      ],
    });
    expect(overlap.success).toBe(false);
    expect(overlap.error?.issues[0]?.message).toBe('Chevauche la plage 20 h – minuit');
    expect(overlap.error?.issues[0]?.path).toEqual(['ranges', 1, 'startMinute']);
  });

  it('refuses a date that is not one', () => {
    expect(AgentHourExceptionSchema.safeParse({ date: '2026-13-01', ranges: [] }).success).toBe(false);
  });
});

describe('localDate', () => {
  it('reads the date on her clock, not in UTC', () => {
    // 23:30 UTC on the 19th is already the 20th in Paris.
    expect(localDate(new Date('2026-11-19T23:30:00Z'), PARIS)).toBe('2026-11-20');
    expect(localDate(new Date('2026-11-19T22:30:00Z'), PARIS)).toBe('2026-11-19');
  });
});

describe('replyOpenWithExceptions', () => {
  const at = (iso: string) => new Date(iso);

  it('follows her hours on a date without an exception', () => {
    expect(replyOpenWithExceptions(NIGHTS, [], PARIS, at('2026-11-20T09:00:00Z'))).toBe(true);
    expect(replyOpenWithExceptions(NIGHTS, [], PARIS, at('2026-11-20T03:00:00Z'))).toBe(false);
  });

  it('follows the ranges alone on a date with one', () => {
    const exceptions = [{ date: '2026-11-20', ranges: [{ startMinute: 120, endMinute: 360 }] }];
    // 4:00 in Paris: out of her slots, in the exception.
    expect(replyOpenWithExceptions(NIGHTS, exceptions, PARIS, at('2026-11-20T03:00:00Z'))).toBe(true);
    // 15:00 in Paris: in her slots, out of the exception.
    expect(replyOpenWithExceptions(NIGHTS, exceptions, PARIS, at('2026-11-20T14:00:00Z'))).toBe(false);
  });

  it('cuts the slot of the day before at midnight: the date belongs to its exception', () => {
    const none = [{ date: '2026-11-20', ranges: [] }];
    // 0:30 in Paris on the 20th: her slot of the 19th runs until 1:00, the exception of the 20th says no agent.
    expect(replyOpenWithExceptions(NIGHTS, none, PARIS, at('2026-11-19T23:30:00Z'))).toBe(false);
    expect(replyOpenWithExceptions(NIGHTS, [], PARIS, at('2026-11-19T23:30:00Z'))).toBe(true);
  });

  it('closes a day even when she is always open', () => {
    const none = [{ date: '2026-11-20', ranges: [] }];
    expect(replyOpenWithExceptions(DEFAULT_AGENT_HOURS, none, PARIS, at('2026-11-20T12:00:00Z'))).toBe(false);
    expect(replyOpenWithExceptions(DEFAULT_AGENT_HOURS, none, PARIS, at('2026-11-21T12:00:00Z'))).toBe(true);
  });
});

describe('SetAgentModeBodySchema: the pause (ADR 0148 § 1)', () => {
  it('takes an end with Arrêt only', () => {
    expect(
      SetAgentModeBodySchema.safeParse({
        creatorId: CREATOR,
        mode: 'stop',
        until: '2026-11-20T08:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(
      SetAgentModeBodySchema.safeParse({
        creatorId: CREATOR,
        mode: 'copilot',
        until: '2026-11-20T08:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(SetAgentModeBodySchema.safeParse({ creatorId: CREATOR, mode: 'stop' }).success).toBe(true);
  });
});
