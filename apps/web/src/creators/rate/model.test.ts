import { CreatorAgencyRateSchema } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { bpsOfPercent, confirmSentence, dayLabel, earliestDay, nextDay, percentOf, standing } from './model';

/* An invented creator and percentages: never the agency's own. */
const CREATOR = '0192f3a0-0000-7000-8000-0000000000c1';
const rate = (id: string, fromDay: string, agencyBps: number) =>
  CreatorAgencyRateSchema.parse({
    id,
    creatorId: CREATOR,
    fromDay,
    agencyBps,
    createdAt: '2026-11-03T10:00:00.000Z',
  });

describe('what the owner types as a percentage (CR-04)', () => {
  it('reads whole and decimal percentages as basis points, a comma or a point', () => {
    expect(bpsOfPercent('35')).toBe(3500);
    expect(bpsOfPercent(' 35,5 ')).toBe(3550);
    expect(bpsOfPercent('35.25')).toBe(3525);
    expect(bpsOfPercent('35 %')).toBe(3500);
    expect(bpsOfPercent('0')).toBe(0);
    expect(bpsOfPercent('100')).toBe(10_000);
  });

  it('refuses anything else: no guess, no rounding', () => {
    for (const text of ['', 'trente', '35,555', '100,01', '101', '-5', '3 5', '1e2', ',5']) {
      expect(bpsOfPercent(text), text).toBeNull();
    }
  });
});

describe('how a percentage and its day are said', () => {
  it('writes the sign after a non-breaking space, the decimals only when there are some', () => {
    expect(percentOf(3500)).toBe('35\u00a0%');
    expect(percentOf(3550)).toBe('35,5\u00a0%');
    expect(percentOf(3525)).toBe('35,25\u00a0%');
    expect(confirmSentence(3500, '2026-11-10')).toBe('35\u00a0% pour l’agence à partir du 10/11/2026.');
  });

  it('writes a day the French way and counts the next on the calendar', () => {
    expect(dayLabel('2026-11-10')).toBe('10/11/2026');
    expect(nextDay('2026-11-30')).toBe('2026-12-01');
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
    expect(nextDay('2028-02-28')).toBe('2028-02-29');
  });
});

describe('where a percentage stands', () => {
  const first = rate('0192f3a0-0000-7000-8000-0000000000e1', '2026-11-01', 3500);
  const next = rate('0192f3a0-0000-7000-8000-0000000000e2', '2026-11-20', 3000);
  const older = rate('0192f3a0-0000-7000-8000-0000000000e0', '2026-10-01', 4000);

  it('lets her first start today, and any later one tomorrow at the earliest', () => {
    expect(earliestDay({ today: '2026-11-03', current: null, rates: [] })).toBe('2026-11-03');
    expect(earliestDay({ today: '2026-11-03', current: first, rates: [first] })).toBe('2026-11-04');
  });

  it('marks the one the server says is in force, those to come, and those replaced', () => {
    const list = { today: '2026-11-03', current: first, rates: [next, first, older] };
    expect(standing(first, list)).toBe('current');
    expect(standing(next, list)).toBe('coming');
    expect(standing(older, list)).toBe('past');
  });
});
