import { describe, expect, it } from 'vitest';

import {
  agentHoursNow,
  AgentHourExceptionSchema,
  DEFAULT_AGENT_HOURS,
  localDate,
  nextFollowUpAllowed,
  nextReplyOpening,
  replyOpenAt,
  replyOpenedAt,
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

describe('replyOpenAt with her exceptions', () => {
  const at = (iso: string) => new Date(iso);

  it('follows her hours on a date without an exception', () => {
    expect(replyOpenAt(NIGHTS, PARIS, at('2026-11-20T09:00:00Z'))).toBe(true);
    expect(replyOpenAt(NIGHTS, PARIS, at('2026-11-20T03:00:00Z'))).toBe(false);
  });

  it('follows the ranges alone on a date with one', () => {
    const exceptions = [{ date: '2026-11-20', ranges: [{ startMinute: 120, endMinute: 360 }] }];
    // 4:00 in Paris: out of her slots, in the exception.
    expect(replyOpenAt(NIGHTS, PARIS, at('2026-11-20T03:00:00Z'), exceptions)).toBe(true);
    // 15:00 in Paris: in her slots, out of the exception.
    expect(replyOpenAt(NIGHTS, PARIS, at('2026-11-20T14:00:00Z'), exceptions)).toBe(false);
  });

  it('cuts the slot of the day before at midnight: the date belongs to its exception', () => {
    const none = [{ date: '2026-11-20', ranges: [] }];
    // 0:30 in Paris on the 20th: her slot of the 19th runs until 1:00, the exception of the 20th says no agent.
    expect(replyOpenAt(NIGHTS, PARIS, at('2026-11-19T23:30:00Z'), none)).toBe(false);
    expect(replyOpenAt(NIGHTS, PARIS, at('2026-11-19T23:30:00Z'))).toBe(true);
  });

  it('closes a day even when she is always open', () => {
    const none = [{ date: '2026-11-20', ranges: [] }];
    expect(replyOpenAt(DEFAULT_AGENT_HOURS, PARIS, at('2026-11-20T12:00:00Z'), none)).toBe(false);
    expect(replyOpenAt(DEFAULT_AGENT_HOURS, PARIS, at('2026-11-21T12:00:00Z'), none)).toBe(true);
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

describe('openings with her exceptions (ADR 0148 § 3, IA-01 lot b)', () => {
  const at = (iso: string) => new Date(iso);

  it('finds the next opening in an exception range, out of her week', () => {
    // Friday 20/11 at 3:00 in Paris: closed (her slots run 9:00 – 1:00); that day opens at 4:00 by its exception.
    const exceptions = [{ date: '2026-11-20', ranges: [{ startMinute: 240, endMinute: 300 }] }];
    expect(nextReplyOpening(NIGHTS, PARIS, at('2026-11-20T02:00:00Z'), exceptions).toISOString()).toBe(
      '2026-11-20T03:00:00.000Z',
    );
  });

  it('skips a day closed by its exception, to the next day of her week', () => {
    const none = [{ date: '2026-11-20', ranges: [] }];
    // Thursday 19/11 at 23:30 Paris is the 19th: open. At 1:30 on the 20th, closed all day: next is the 21st at 9:00.
    expect(nextReplyOpening(NIGHTS, PARIS, at('2026-11-20T00:30:00Z'), none).toISOString()).toBe(
      '2026-11-21T08:00:00.000Z',
    );
  });

  it('opens at midnight when a date she keeps closed hands back to her week', () => {
    const always = DEFAULT_AGENT_HOURS;
    const none = [{ date: '2026-11-20', ranges: [] }];
    expect(nextReplyOpening(always, PARIS, at('2026-11-20T12:00:00Z'), none).toISOString()).toBe(
      '2026-11-20T23:00:00.000Z',
    );
  });

  it('stops a slot of a date with an exception at its midnight, even when it would run into the next day', () => {
    // The 20th has an exception 22:00 – 24:00; her week slot of the 20th (9:00 – 1:00) is replaced, so 0:30 on the
    // 21st is closed, and the 21st opens at 9:00.
    const late = [{ date: '2026-11-20', ranges: [{ startMinute: 1320, endMinute: 1440 }] }];
    expect(replyOpenAt(NIGHTS, PARIS, at('2026-11-20T23:30:00Z'), late)).toBe(false);
    expect(replyOpenAt(NIGHTS, PARIS, at('2026-11-20T22:30:00Z'), late)).toBe(true);
  });

  it('says when the open stretch began, an exception range starting in the middle of the day', () => {
    // An exception that opens at 14:00 (as a shift begins): at 15:00 the stretch began at 14:00.
    const afternoon = [{ date: '2026-11-20', ranges: [{ startMinute: 840, endMinute: 1080 }] }];
    expect(replyOpenedAt(NIGHTS, PARIS, at('2026-11-20T14:00:00Z'), afternoon)?.toISOString()).toBe(
      '2026-11-20T13:00:00.000Z',
    );
    expect(replyOpenedAt(NIGHTS, PARIS, at('2026-11-20T18:00:00Z'), afternoon)).toBeNull();
  });

  it('holds over a change of clock: the last Sunday of March, 2:30 does not exist in Paris', () => {
    const early = [{ date: '2027-03-28', ranges: [{ startMinute: 150, endMinute: 360 }] }];
    // Before the jump (1:00 UTC is 3:00 CEST): the opening lands on the first minute after it, 3:00.
    const opening = nextReplyOpening(NIGHTS, PARIS, at('2027-03-28T00:30:00Z'), early);
    expect(opening.toISOString()).toBe('2027-03-28T01:00:00.000Z');
    expect(replyOpenAt(NIGHTS, PARIS, opening, early)).toBe(true);
  });

  it('plans no follow-up on a date closed by its exception: the next one waits for the day after', () => {
    const none = [{ date: '2026-11-20', ranges: [] }];
    const next = nextFollowUpAllowed(NIGHTS, PARIS, at('2026-11-20T10:00:00Z'), none);
    expect(next?.toISOString()).toBe('2026-11-21T08:00:00.000Z');
  });

  it('plans no follow-up at all when every date ahead is closed', () => {
    const week = Array.from({ length: 10 }, (_, i) => ({
      date: localDate(new Date(Date.parse('2026-11-20T12:00:00Z') + i * 86_400_000), PARIS),
      ranges: [],
    }));
    expect(nextFollowUpAllowed(NIGHTS, PARIS, at('2026-11-20T10:00:00Z'), week)).toBeNull();
  });
});

describe('agentHoursNow (ADR 0148 § 1)', () => {
  it('always open: open, nothing changes', () => {
    expect(agentHoursNow(DEFAULT_AGENT_HOURS, PARIS, new Date('2026-11-20T12:00:00Z'))).toEqual({
      open: true,
      changesAt: null,
    });
  });

  it('open in a slot past midnight: closes at 1:00 her time', () => {
    // Friday 20/11, 23:00 in Paris (UTC+1).
    expect(agentHoursNow(NIGHTS, PARIS, new Date('2026-11-20T22:00:00Z'))).toEqual({
      open: true,
      changesAt: '2026-11-21T00:00:00.000Z',
    });
  });

  it('closed: opens at 9:00 her time', () => {
    expect(agentHoursNow(NIGHTS, PARIS, new Date('2026-11-21T03:00:00Z'))).toEqual({
      open: false,
      changesAt: '2026-11-21T08:00:00.000Z',
    });
  });

  it('an exception ending at midnight closes her at the next 0:00 even inside a week slot', () => {
    const exceptions = [{ date: '2026-11-20', ranges: [{ startMinute: 1200, endMinute: 1440 }] }];
    // The next day has no exception: its own 9:00 slot opens; the night before is cut at midnight.
    expect(agentHoursNow(NIGHTS, PARIS, new Date('2026-11-20T20:00:00Z'), exceptions)).toEqual({
      open: true,
      changesAt: '2026-11-20T23:00:00.000Z',
    });
  });

  it('a date closed by hand: opens the day after', () => {
    const exceptions = [{ date: '2026-11-21', ranges: [] }];
    expect(agentHoursNow(NIGHTS, PARIS, new Date('2026-11-21T10:00:00Z'), exceptions)).toEqual({
      open: false,
      changesAt: '2026-11-22T08:00:00.000Z',
    });
  });
});

describe('replyOpenAt the night the clock goes back (relecture Agent, #865)', () => {
  it('a slot started on a date with an exception stops at its midnight, the second 2:30 included', () => {
    // Saturday 22:00 to 4:00; Saturday 30/10/2027 has an exception with no range.
    const hours: AgentHours = {
      ...DEFAULT_AGENT_HOURS,
      reply: { mode: 'slots', slots: [{ day: 6, startMinute: 1320, endMinute: 240, enabled: true }] },
    };
    const exceptions = [{ date: '2027-10-30', ranges: [] }];
    // 2:30 the second time on Sunday 31/10 in Paris (UTC+1 again): 1:30 UTC.
    expect(replyOpenAt(hours, PARIS, new Date('2027-10-31T01:30:00Z'), exceptions)).toBe(false);
    // Without the exception, Saturday's slot runs on to 4:00.
    expect(replyOpenAt(hours, PARIS, new Date('2027-10-31T01:30:00Z'))).toBe(true);
  });
});
