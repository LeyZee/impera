import { DomainError } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import {
  accessWindow,
  assertCanWork,
  assertPlanningRange,
  assertPlans,
  assertShiftRange,
  conflictsOf,
  covers,
  decideUpdate,
  firstStartOf,
  myShiftsOf,
  occurrenceKey,
  occurrences,
  occurrencesAhead,
  type PlanningTemplate,
} from '../shifts';

const at = (value: string): Date => new Date(value);
const iso = (value: Date): string => value.toISOString();
const PARIS = 'Europe/Paris';

/** The code a rule throws on these arguments, or `null`. */
function codeOf<Args extends unknown[]>(rule: (...args: Args) => unknown, ...args: Args): string | null {
  try {
    rule(...args);
  } catch (error) {
    return error instanceof DomainError ? error.code : 'unexpected';
  }
  return null;
}

/** Invented members, accounts and templates only (ADR 0010). */
describe('who plans, who works', () => {
  it('lets the owner and an active manager plan, nobody else', () => {
    expect(codeOf(assertPlans, 'owner')).toBeNull();
    expect(codeOf(assertPlans, 'agency')).toBeNull();
    expect(codeOf(assertPlans, 'self')).toBe('role_forbidden');
  });

  it('gives a shift to an active member of the creator only', () => {
    const member = {
      status: 'active',
      creatorIds: ['c1'],
      joinedOn: '2026-10-01',
      agencyTimeZone: PARIS,
    } as const;
    const startsAt = at('2026-11-02T08:00:00Z');
    expect(codeOf(assertCanWork, member, 'c1', startsAt)).toBeNull();
    expect(codeOf(assertCanWork, { ...member, status: 'sick' }, 'c1', startsAt)).toBe('member_left_conflict');
    expect(codeOf(assertCanWork, { ...member, creatorIds: ['c2'] }, 'c1', startsAt)).toBe(
      'member_creator_conflict',
    );
  });

  it('gives no shift before the member’s first day, read in the agency’s zone, where its report is paid', () => {
    // A chatter in Madagascar (UTC+3) who joins on the 16th, in an agency in Paris (UTC+1 in November).
    const member = {
      status: 'active',
      creatorIds: ['c1'],
      joinedOn: '2026-11-16',
      agencyTimeZone: PARIS,
    } as const;
    expect(codeOf(assertCanWork, member, 'c1', at('2026-10-28T08:00:00Z'))).toBe(
      'member_not_joined_conflict',
    );
    // 21:30 UTC on the 15th is already the 16th in Antananarivo but still the 15th in Paris: its report would fall
    // in the fortnight of the 1st to the 15th, where the member has no rate.
    expect(codeOf(assertCanWork, member, 'c1', at('2026-11-15T21:30:00Z'))).toBe(
      'member_not_joined_conflict',
    );
    // 23:30 UTC on the 15th is the 16th in Paris.
    expect(codeOf(assertCanWork, member, 'c1', at('2026-11-15T23:30:00Z'))).toBeNull();
  });

  it('finds when a template’s first shift starts', () => {
    // From Wednesday 28 October, on Mondays: the first is Monday 2 November, 08:00 in Paris.
    const template = {
      weekday: 1,
      startMinute: 480,
      endMinute: 840,
      validFrom: '2026-10-28',
      validUntil: null,
    };
    expect(iso(firstStartOf(template, PARIS))).toBe('2026-11-02T07:00:00.000Z');
  });
});

describe('a shift’s range', () => {
  it('falls on the minute, ends after it starts and lasts a day at most', () => {
    expect(codeOf(assertShiftRange, at('2026-11-02T00:00:00Z'), at('2026-11-03T00:00:00Z'))).toBeNull();
    expect(codeOf(assertShiftRange, at('2026-11-02T00:00:00Z'), at('2026-11-03T00:01:00Z'))).toBe(
      'shift_range_invalid',
    );
    expect(codeOf(assertShiftRange, at('2026-11-02T06:00:30Z'), at('2026-11-02T12:00:30Z'))).toBe(
      'shift_range_invalid',
    );
    expect(codeOf(assertShiftRange, at('2026-11-02T06:00:00Z'), at('2026-11-02T06:00:00Z'))).toBe(
      'shift_range_invalid',
    );
  });

  it('reads six weeks at most', () => {
    expect(codeOf(assertPlanningRange, at('2026-11-02T00:00:00Z'), at('2026-12-14T00:00:00Z'))).toBeNull();
    expect(codeOf(assertPlanningRange, at('2026-11-02T00:00:00Z'), at('2026-12-14T00:01:00Z'))).toBe(
      'planning_range_invalid',
    );
    expect(codeOf(assertPlanningRange, at('2026-11-02T00:00:00Z'), at('2026-11-02T00:00:00Z'))).toBe(
      'planning_range_invalid',
    );
  });
});

describe('on shift and the access window (ADR 0025)', () => {
  const shift = { startsAt: at('2026-11-02T23:00:00Z'), endsAt: at('2026-11-03T05:00:00Z'), stoppedAt: null };

  it('covers its start and not its end', () => {
    expect(covers(shift, at('2026-11-02T23:00:00Z'))).toBe(true);
    expect(covers(shift, at('2026-11-03T04:59:59Z'))).toBe(true);
    expect(covers(shift, at('2026-11-03T05:00:00Z'))).toBe(false);
    expect(covers(shift, at('2026-11-02T22:59:59Z'))).toBe(false);
  });

  it('opens the margin before and after, and closes with a stopped shift', () => {
    const window = accessWindow(shift, 15);
    expect(iso(window.startsAt)).toBe('2026-11-02T22:45:00.000Z');
    expect(iso(window.endsAt)).toBe('2026-11-03T05:15:00.000Z');
    const stopped = { ...shift, endsAt: at('2026-11-03T01:12:00Z'), stoppedAt: at('2026-11-03T01:12:40Z') };
    expect(iso(accessWindow(stopped, 15).endsAt)).toBe('2026-11-03T01:12:00.000Z');
  });
});

describe('my shifts, for Aujourd’hui', () => {
  const night = {
    id: 'night',
    startsAt: at('2026-11-02T23:00:00Z'),
    endsAt: at('2026-11-03T05:00:00Z'),
    stoppedAt: null,
  };
  const morning = {
    id: 'morning',
    startsAt: at('2026-11-03T05:00:00Z'),
    endsAt: at('2026-11-03T11:00:00Z'),
    stoppedAt: null,
  };
  const later = {
    id: 'later',
    startsAt: at('2026-11-04T05:00:00Z'),
    endsAt: at('2026-11-04T11:00:00Z'),
    stoppedAt: null,
  };
  const ids = (picked: {
    current: { id: string } | null;
    next: { id: string } | null;
    ended: { id: string } | null;
  }) => ({
    current: picked.current?.id ?? null,
    next: picked.next?.id ?? null,
    ended: picked.ended?.id ?? null,
  });

  it('keeps a shift only in its start margin in `next`, never in `current`', () => {
    expect(ids(myShiftsOf([night, later], at('2026-11-02T22:50:00Z'), 15))).toEqual({
      current: null,
      next: 'night',
      ended: null,
    });
  });

  it('names the ended shift whose end margin is still open, beside the one that follows', () => {
    expect(ids(myShiftsOf([night, morning, later], at('2026-11-03T05:10:00Z'), 15))).toEqual({
      current: 'morning',
      next: 'later',
      ended: 'night',
    });
    expect(ids(myShiftsOf([night, later], at('2026-11-03T05:15:00Z'), 15)).ended).toBeNull();
  });

  it('never names a stopped shift as ended: its window closed with it', () => {
    const stopped = { ...night, endsAt: at('2026-11-03T01:12:00Z'), stoppedAt: at('2026-11-03T01:12:40Z') };
    expect(ids(myShiftsOf([stopped, later], at('2026-11-03T01:13:00Z'), 15)).ended).toBeNull();
  });
});

describe('changing a shift (the past is kept)', () => {
  const shift = { memberId: 'm1', startsAt: at('2026-11-02T23:00:00Z'), endsAt: at('2026-11-03T05:00:00Z') };

  it('moves a shift that has not started, under the rules of a new one', () => {
    const before = at('2026-11-02T20:00:00Z');
    expect(decideUpdate(shift, { memberId: 'm2' }, before)).toEqual({
      kind: 'plan',
      ...shift,
      memberId: 'm2',
    });
    expect(codeOf(() => decideUpdate(shift, { endsAt: at('2026-11-03T23:30:00Z') }, before))).toBe(
      'shift_range_invalid',
    );
    expect(
      codeOf(() =>
        decideUpdate(
          shift,
          { startsAt: at('2026-11-02T18:00:00Z'), endsAt: at('2026-11-02T19:00:00Z') },
          before,
        ),
      ),
    ).toBe('shift_ended_conflict');
  });

  it('under way, only shortens or stops it', () => {
    const during = at('2026-11-03T01:12:40Z');
    expect(decideUpdate(shift, { endsAt: at('2026-11-03T03:00:00Z') }, during)).toEqual({
      kind: 'shorten',
      endsAt: at('2026-11-03T03:00:00Z'),
    });
    expect(decideUpdate(shift, { endsAt: at('2026-11-03T00:00:00Z') }, during)).toEqual({
      kind: 'stop',
      endsAt: at('2026-11-03T01:12:00Z'),
      stoppedAt: during,
    });
    expect(codeOf(() => decideUpdate(shift, { memberId: 'm2' }, during))).toBe('shift_started_conflict');
    expect(codeOf(() => decideUpdate(shift, { endsAt: at('2026-11-03T06:00:00Z') }, during))).toBe(
      'shift_started_conflict',
    );
    expect(
      codeOf(() =>
        decideUpdate(
          shift,
          { startsAt: at('2026-11-02T22:00:00Z'), endsAt: at('2026-11-03T03:00:00Z') },
          during,
        ),
      ),
    ).toBe('shift_started_conflict');
  });

  it('cancels a shift stopped in its first minute, and refuses to change one that has ended', () => {
    expect(decideUpdate(shift, { endsAt: shift.startsAt }, at('2026-11-02T23:00:20Z'))).toEqual({
      kind: 'cancel',
    });
    expect(
      codeOf(() => decideUpdate(shift, { endsAt: at('2026-11-03T04:00:00Z') }, at('2026-11-03T05:00:00Z'))),
    ).toBe('shift_ended_conflict');
  });
});

describe('templates', () => {
  const nightOnSunday = {
    weekday: 7,
    startMinute: 1080,
    endMinute: 0,
    validFrom: '2026-10-01',
    validUntil: null,
  };

  it('makes a night slot that ends the next day, at its wall-clock hours', () => {
    const made = occurrences(nightOnSunday, '2026-11-01', '2026-11-07', PARIS);
    expect(made.map((one) => [iso(one.startsAt), iso(one.endsAt)])).toEqual([
      ['2026-11-01T17:00:00.000Z', '2026-11-01T23:00:00.000Z'],
    ]);
  });

  it('keeps the wall-clock hours across a change of time: a 6-hour night slot lasts 7 hours in October', () => {
    const night = { weekday: 7, startMinute: 0, endMinute: 360, validFrom: '2026-01-01', validUntil: null };
    const [autumn] = occurrences(night, '2026-10-25', '2026-10-25', PARIS);
    const [spring] = occurrences(night, '2026-03-29', '2026-03-29', PARIS);
    expect(autumn && (autumn.endsAt.getTime() - autumn.startsAt.getTime()) / 3_600_000).toBe(7);
    expect(spring && (spring.endsAt.getTime() - spring.startsAt.getTime()) / 3_600_000).toBe(5);
  });

  it('starts at its first day and stops at its last', () => {
    const ended = { ...nightOnSunday, validFrom: '2026-11-08', validUntil: '2026-11-21' };
    expect(occurrences(ended, '2026-11-01', '2026-11-30', PARIS).map((one) => iso(one.startsAt))).toEqual([
      '2026-11-08T17:00:00.000Z',
      '2026-11-15T17:00:00.000Z',
    ]);
  });

  it('makes the same shifts when run again, four weeks ahead, none already ended', () => {
    const now = at('2026-11-01T20:00:00Z');
    const first = occurrencesAhead(nightOnSunday, now, PARIS).map((one) => iso(one.startsAt));
    expect(occurrencesAhead(nightOnSunday, now, PARIS).map((one) => iso(one.startsAt))).toEqual(first);
    expect(first).toEqual([
      '2026-11-01T17:00:00.000Z',
      '2026-11-08T17:00:00.000Z',
      '2026-11-15T17:00:00.000Z',
      '2026-11-22T17:00:00.000Z',
    ]);
    expect(occurrencesAhead(nightOnSunday, at('2026-11-01T23:00:00Z'), PARIS).at(0)?.startsAt).toEqual(
      at('2026-11-08T17:00:00Z'),
    );
  });
});

describe('conflicts of the templates', () => {
  const template: PlanningTemplate = {
    id: 't1',
    memberId: 'm1',
    platformAccountId: 'a1',
    weekday: 1,
    startMinute: 360,
    endMinute: 720,
    validFrom: '2026-11-01',
    validUntil: null,
  };
  const range = { from: at('2026-11-02T00:00:00Z'), to: at('2026-11-16T00:00:00Z') };
  const now = at('2026-11-01T12:00:00Z');

  it('shows an occurrence kept out by its member’s other shift, or by someone on its account', () => {
    const shifts = [
      {
        id: 's-busy',
        memberId: 'm1',
        platformAccountId: 'a2',
        startsAt: at('2026-11-02T04:00:00Z'),
        endsAt: at('2026-11-02T06:00:00Z'),
      },
      {
        id: 's-taken',
        memberId: 'm2',
        platformAccountId: 'a1',
        startsAt: at('2026-11-09T10:00:00Z'),
        endsAt: at('2026-11-09T12:00:00Z'),
      },
    ];
    expect(conflictsOf([template], new Set(), shifts, range, now, PARIS, [])).toEqual([
      {
        templateId: 't1',
        startsAt: at('2026-11-02T05:00:00Z'),
        endsAt: at('2026-11-02T11:00:00Z'),
        reason: 'member_busy',
        shiftId: 's-busy',
      },
      {
        templateId: 't1',
        startsAt: at('2026-11-09T05:00:00Z'),
        endsAt: at('2026-11-09T11:00:00Z'),
        reason: 'account_taken',
        shiftId: 's-taken',
      },
    ]);
  });

  it('is quiet about an occurrence already made, cancelled or moved, and about one nothing stands against', () => {
    const made = new Set([occurrenceKey('t1', at('2026-11-02T05:00:00Z'))]);
    const shifts = [
      {
        id: 's-own',
        memberId: 'm1',
        platformAccountId: 'a1',
        startsAt: at('2026-11-02T05:30:00Z'),
        endsAt: at('2026-11-02T11:00:00Z'),
      },
    ];
    expect(conflictsOf([template], made, shifts, range, now, PARIS, [])).toEqual([]);
  });

  it('shows an occurrence during its member’s leave as a shift to fill, before anything else in its way', () => {
    const shifts = [
      {
        id: 's-busy',
        memberId: 'm1',
        platformAccountId: 'a2',
        startsAt: at('2026-11-02T04:00:00Z'),
        endsAt: at('2026-11-02T06:00:00Z'),
      },
    ];
    const leaves = [
      { id: 'l1', memberId: 'm1', startsAt: at('2026-11-01T23:00:00Z'), endsAt: at('2026-11-03T23:00:00Z') },
      { id: 'l2', memberId: 'm2', startsAt: at('2026-11-08T23:00:00Z'), endsAt: at('2026-11-10T23:00:00Z') },
    ];
    expect(conflictsOf([template], new Set(), shifts, range, now, PARIS, leaves)).toEqual([
      {
        templateId: 't1',
        startsAt: at('2026-11-02T05:00:00Z'),
        endsAt: at('2026-11-02T11:00:00Z'),
        reason: 'member_on_leave',
        leaveRequestId: 'l1',
      },
    ]);
  });
});
