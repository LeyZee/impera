import { newId, TeamMemberIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { isPayoutLate, readsPay, statementStateOf, teamSumsFor, workingDaysSince } from '../statement-reads';

import { P1 } from './fixtures';

/** Every number the JSON of a value holds as a value: never digits inside an id, a date or a key. */
const numbersIn = (value: unknown): number[] =>
  (JSON.stringify(value).match(/(?<=[:,[])-?\d+(?:\.\d+)?(?=[,\]}])/gu) ?? []).map(Number);

/** A validated statement, and the rest of a statement, which never leaves (decision A of 14/11). Invented (ADR 0010). */
const validated = {
  memberId: newId(TeamMemberIdSchema),
  window: {
    period: P1,
    startsAt: '2025-02-28T23:00:00.000Z',
    endsAt: '2025-03-15T23:00:00.000Z',
    timeZone: 'Europe/Paris',
  },
  status: 'validated' as const,
  revision: 3,
  computedAt: '2025-03-16T08:00:00.000Z',
  // Monday 17 March 2025, in Paris.
  validatedAt: '2025-03-17T08:00:00.000Z',
  paidAt: null,
  bonusesMinor: 6_000,
  penaltiesMinor: 1_000,
  carryOversInMinor: 500,
  adjustmentsMinor: -200,
  totalMinor: 25_300,
  carryOverOutMinor: 0,
  writtenOffMinor: 0,
  payableMinor: 25_300,
  payoutBlock: null,
  netMinor: 100_000,
  commissionMinor: 20_000,
  teamShare: { baseNetMinor: 400_000, bps: 500, amountMinor: 0 },
  tierBonus: { name: 'Palier 1', thresholdMinor: 80_000, bonusMinor: 5_000 },
  rules: { commission: { rateBps: 2_000 } },
  lines: [{ base: 'platform_net', rateBps: 2_000 }],
  payment: null,
};

/** The agency in Paris, on that day. */
const paris = (today: string) => ({ timeZone: 'Europe/Paris', today });

describe('readsPay', () => {
  it('lets the owner and the team’s accounts read, never a creator', () => {
    expect(readsPay('owner')).toBe(true);
    expect(readsPay('operator')).toBe(true);
    expect(readsPay('creator')).toBe(false);
  });
});

describe('statementStateOf (ADR 0105 § 3 and § 4, decision A)', () => {
  it('gives the state, under these names only', () => {
    expect(statementStateOf(validated, null, paris('2025-03-18'))).toEqual({
      memberId: validated.memberId,
      status: 'validated',
      revision: 3,
      computedAt: '2025-03-16T08:00:00.000Z',
      validatedAt: '2025-03-17T08:00:00.000Z',
      paidAt: null,
      payoutBlocked: false,
      payoutLate: null,
    });
  });

  it('gives no amount of the member: two statements of other amounts and rates read the same', () => {
    const read = statementStateOf(validated, 2, paris('2025-03-18'));
    const other = {
      ...validated,
      netMinor: 200_000,
      commissionMinor: 9_000,
      bonusesMinor: 0,
      totalMinor: 9_999,
      payableMinor: 9_999,
      rules: { commission: { rateBps: 1_000 } },
    };
    expect(statementStateOf(other, 2, paris('2025-03-18'))).toEqual(read);
    for (const amount of [25_300, 100_000, 20_000, 6_000, 1_000, 400_000, 80_000, 2_000])
      expect(numbersIn(read)).not.toContain(amount);
    expect(Object.keys(read).some((key) => key.endsWith('Minor') || key.endsWith('Bps'))).toBe(false);
  });

  it('says a transfer waits without its reason, and never for a statement with nothing to pay', () => {
    const block = { reason: 'tax_residence_missing' as const, year: '2025' };
    const read = statementStateOf({ ...validated, payoutBlock: block }, 1, paris('2025-03-25'));
    expect(read.payoutBlocked).toBe(true);
    expect(read.payoutLate).toBe(false);
    expect(JSON.stringify(read)).not.toContain('tax_residence');
    expect(
      statementStateOf({ ...validated, payoutBlock: block, payableMinor: 0 }, 1, paris('2025-03-25'))
        .payoutBlocked,
    ).toBe(false);
  });
});

describe('isPayoutLate (PAIE-32)', () => {
  it('is late once more working days than announced have gone by, today included', () => {
    // Validated on Monday with one day announced: due Tuesday, late Wednesday.
    expect(isPayoutLate(validated, 1, paris('2025-03-18'))).toBe(false);
    expect(isPayoutLate(validated, 1, paris('2025-03-19'))).toBe(true);
    // Validated on Friday 21 with two days announced: Monday and Tuesday, late on Wednesday 26.
    const friday = { ...validated, validatedAt: '2025-03-21T10:00:00.000Z' };
    expect(isPayoutLate(friday, 2, paris('2025-03-23'))).toBe(false);
    expect(isPayoutLate(friday, 2, paris('2025-03-25'))).toBe(false);
    expect(isPayoutLate(friday, 2, paris('2025-03-26'))).toBe(true);
    // Validated on Thursday 20 with one day: Friday is the day, the weekend adds none, late on Monday 24.
    const thursday = { ...validated, validatedAt: '2025-03-20T10:00:00.000Z' };
    expect(isPayoutLate(thursday, 1, paris('2025-03-22'))).toBe(false);
    expect(isPayoutLate(thursday, 1, paris('2025-03-23'))).toBe(false);
    expect(isPayoutLate(thursday, 1, paris('2025-03-24'))).toBe(true);
  });

  it('reads the day of validation in the agency’s zone now, not in the zone the period was written in', () => {
    // 20:00 UTC on Monday 17 is Monday in Paris (the period's zone) but Tuesday 18 in Auckland, the agency's now.
    const evening = { ...validated, validatedAt: '2025-03-17T20:00:00.000Z' };
    expect(evening.window.timeZone).toBe('Europe/Paris');
    expect(isPayoutLate(evening, 1, { timeZone: 'Pacific/Auckland', today: '2025-03-19' })).toBe(false);
    expect(isPayoutLate(evening, 1, paris('2025-03-19'))).toBe(true);
  });

  it('is not known without a delay announced', () => {
    expect(isPayoutLate(validated, null, paris('2025-04-30'))).toBeNull();
  });

  it('is never late once paid, held, before validation, or with nothing to pay', () => {
    const later = paris('2025-04-30');
    expect(isPayoutLate({ ...validated, status: 'paid' }, 1, later)).toBe(false);
    expect(
      isPayoutLate({ ...validated, payoutBlock: { reason: 'documents_not_issued', year: null } }, 1, later),
    ).toBe(false);
    expect(isPayoutLate({ ...validated, status: 'draft', validatedAt: null }, 1, later)).toBe(false);
    expect(isPayoutLate({ ...validated, payableMinor: 0 }, 1, later)).toBe(false);
  });

  it('counts Monday to Friday strictly after the first day, the last one included', () => {
    expect(workingDaysSince('2025-03-17', '2025-03-17')).toBe(0);
    expect(workingDaysSince('2025-03-17', '2025-03-18')).toBe(1);
    expect(workingDaysSince('2025-03-21', '2025-03-23')).toBe(0);
    expect(workingDaysSince('2025-03-21', '2025-03-24')).toBe(1);
    expect(workingDaysSince('2025-03-21', '2025-03-26')).toBe(3);
  });
});

describe('teamSumsFor', () => {
  const at = (totalMinor: number, payableMinor: number) => ({ ...validated, totalMinor, payableMinor });

  it('sums the team for a person who sees it whole, when two statements bring an amount', () => {
    const two = [at(25_300, 25_300), at(9_000, 9_000)];
    expect(teamSumsFor('owner', two)).toEqual({ statements: 2, totalMinor: 34_300, payableMinor: 34_300 });
    expect(teamSumsFor('agency', two)).toEqual({ statements: 2, totalMinor: 34_300, payableMinor: 34_300 });
  });

  it('gives no sum a single member makes: two statements of which one is zero, three of which two are', () => {
    expect(teamSumsFor('owner', [at(25_300, 25_300), at(0, 0)])).toEqual({
      statements: 2,
      totalMinor: null,
      payableMinor: null,
    });
    expect(teamSumsFor('owner', [at(25_300, 25_300), at(0, 0), at(0, 0)])).toEqual({
      statements: 3,
      totalMinor: null,
      payableMinor: null,
    });
  });

  it('counts the total and the payable apart: a statement under the minimum has a total, nothing payable', () => {
    expect(teamSumsFor('owner', [at(25_300, 25_300), at(1_000, 0)])).toEqual({
      statements: 2,
      totalMinor: 26_300,
      payableMinor: null,
    });
  });

  it('gives nothing to a member who sees only themselves, nor sums over one statement or none', () => {
    expect(teamSumsFor('self', [at(25_300, 25_300), at(9_000, 9_000)])).toBeNull();
    expect(teamSumsFor('owner', [at(25_300, 25_300)])).toEqual({
      statements: 1,
      totalMinor: null,
      payableMinor: null,
    });
    expect(teamSumsFor('owner', [])).toEqual({ statements: 0, totalMinor: null, payableMinor: null });
  });
});
