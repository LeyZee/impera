import { describe, expect, it } from 'vitest';

import {
  caseOpens,
  faultTone,
  missedTotals,
  occurrenceCounts,
  type FaultOccurrence,
} from '../chatter-review';

/** Invented values only (ADR 0010). */
const day = (d: number): Date => new Date(Date.UTC(2026, 10, d, 21));
const seen = (d: number, contest: FaultOccurrence['contest'] = 'none'): FaultOccurrence => ({
  at: day(d),
  contest,
});

describe('chatter review', () => {
  it('counts an occurrence only after the explanation, never advice nor an open or dropped contest', () => {
    expect(occurrenceCounts('standard', seen(10), null)).toBe(false);
    expect(occurrenceCounts('standard', seen(10), day(9))).toBe(true);
    expect(occurrenceCounts('standard', seen(9), day(9))).toBe(false);
    expect(occurrenceCounts('advice', seen(10), day(1))).toBe(false);
    expect(occurrenceCounts('firm', seen(10, 'pending'), day(1))).toBe(false);
    expect(occurrenceCounts('firm', seen(10, 'dropped'), day(1))).toBe(false);
    expect(occurrenceCounts('firm', seen(10, 'upheld'), day(1))).toBe(true);
    expect(occurrenceCounts('firm', { ...seen(10), author: 'deduced' }, day(1))).toBe(false);
  });

  it('takes its tone from the level and the explanation, never from the model', () => {
    expect(faultTone('advice', null)).toBe('advice');
    expect(faultTone('standard', null)).toBe('explain');
    expect(faultTone('standard', day(1))).toBe('firm');
    expect(faultTone('firm', null)).toBe('grave');
    expect(faultTone('owner_alert', null)).toBe('grave');
  });

  it('opens a case for an owner alert at once, even while mentoring', () => {
    expect(
      caseOpens({
        level: 'owner_alert',
        now: day(3),
        inMentoring: true,
        explainedAt: null,
        occurrences: [seen(3)],
      }),
    ).toBe(true);
  });

  it('opens nothing else while mentoring, and never for advice', () => {
    const occurrences = [seen(4), seen(5), seen(6), seen(7)];
    expect(
      caseOpens({ level: 'firm', now: day(7), inMentoring: true, explainedAt: day(2), occurrences }),
    ).toBe(false);
    expect(
      caseOpens({ level: 'advice', now: day(7), inMentoring: false, explainedAt: day(2), occurrences }),
    ).toBe(false);
  });

  it('opens a standard case at three counted times in two weeks after the explanation', () => {
    const explainedAt = day(2);
    const base = { level: 'standard', inMentoring: false, explainedAt } as const;
    expect(caseOpens({ ...base, now: day(8), occurrences: [seen(1), seen(5), seen(8)] })).toBe(false);
    expect(caseOpens({ ...base, now: day(9), occurrences: [seen(1), seen(5), seen(8), seen(9)] })).toBe(true);
    expect(caseOpens({ ...base, now: day(9), occurrences: [seen(5), seen(8, 'pending'), seen(9)] })).toBe(
      false,
    );
  });

  it('forgets what falls out of the two weeks', () => {
    const base = { level: 'standard', inMentoring: false, explainedAt: day(1) } as const;
    expect(caseOpens({ ...base, now: day(20), occurrences: [seen(3), seen(10), seen(20)] })).toBe(false);
    expect(caseOpens({ ...base, now: day(20), occurrences: [seen(7), seen(10), seen(20)] })).toBe(true);
  });

  it('opens a firm case at the second time after the remark', () => {
    const base = { level: 'firm', inMentoring: false } as const;
    expect(caseOpens({ ...base, now: day(5), explainedAt: null, occurrences: [seen(5)] })).toBe(false);
    expect(caseOpens({ ...base, now: day(9), explainedAt: day(5), occurrences: [seen(5), seen(9)] })).toBe(
      true,
    );
  });

  it('adds up only what the code priced, per currency, contests left out', () => {
    const totals = missedTotals([
      { missed: { minor: 2500, currency: 'EUR' }, contest: 'none' },
      { missed: { minor: 4000, currency: 'EUR' }, contest: 'upheld' },
      { missed: { minor: 3000, currency: 'EUR' }, contest: 'pending' },
      { missed: { minor: 1000, currency: 'USD' }, contest: 'none' },
      { missed: null, contest: 'none' },
    ]);
    expect([...totals]).toEqual([
      ['EUR', 6500],
      ['USD', 1000],
    ]);
  });
});
