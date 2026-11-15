import { newId, TeamMemberIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { isPayoutLate, readsPay, statementStateOf, teamSumsFor, workingDaysSince } from '../statement-reads';

import { P1 } from './fixtures';

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

const at = (iso: string): Date => new Date(iso);

describe('readsPay', () => {
  it('lets the owner and the team’s accounts read, never a creator', () => {
    expect(readsPay('owner')).toBe(true);
    expect(readsPay('operator')).toBe(true);
    expect(readsPay('creator')).toBe(false);
  });
});

describe('statementStateOf (ADR 0105 § 3 and § 4, decision A)', () => {
  it('gives the state, under these names only', () => {
    expect(statementStateOf(validated, null, at('2025-03-18T08:00:00.000Z'))).toEqual({
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
    const read = statementStateOf(validated, 2, at('2025-03-18T08:00:00.000Z'));
    const other = {
      ...validated,
      netMinor: 200_000,
      commissionMinor: 9_000,
      bonusesMinor: 0,
      totalMinor: 9_999,
      payableMinor: 9_999,
      rules: { commission: { rateBps: 1_000 } },
    };
    expect(statementStateOf(other, 2, at('2025-03-18T08:00:00.000Z'))).toEqual(read);
    const text = JSON.stringify(read);
    for (const amount of ['25300', '100000', '20000', '6000', '1000', '400000', '80000', '2000'])
      expect(text).not.toContain(amount);
    expect(Object.keys(read).some((key) => key.endsWith('Minor') || key.endsWith('Bps'))).toBe(false);
  });

  it('says a transfer waits without its reason, and never for a statement with nothing to pay', () => {
    const block = { reason: 'tax_residence_missing' as const, year: '2025' };
    const read = statementStateOf({ ...validated, payoutBlock: block }, 1, at('2025-03-25T08:00:00.000Z'));
    expect(read.payoutBlocked).toBe(true);
    expect(read.payoutLate).toBe(false);
    expect(JSON.stringify(read)).not.toContain('tax_residence');
    expect(
      statementStateOf(
        { ...validated, payoutBlock: block, payableMinor: 0 },
        1,
        at('2025-03-25T08:00:00.000Z'),
      ).payoutBlocked,
    ).toBe(false);
  });
});

describe('isPayoutLate (PAIE-32)', () => {
  it('is late once more working days than announced have gone by, today included, in the period’s zone', () => {
    // Validated on Monday with one day announced: due Tuesday, late Wednesday (midnight in Paris).
    expect(isPayoutLate(validated, 1, at('2025-03-18T22:00:00.000Z'))).toBe(false);
    expect(isPayoutLate(validated, 1, at('2025-03-18T23:30:00.000Z'))).toBe(true);
    // Validated on Friday 21 with two days announced: Monday and Tuesday, late on Wednesday 26.
    const friday = { ...validated, validatedAt: '2025-03-21T10:00:00.000Z' };
    expect(isPayoutLate(friday, 2, at('2025-03-23T10:00:00.000Z'))).toBe(false);
    expect(isPayoutLate(friday, 2, at('2025-03-25T10:00:00.000Z'))).toBe(false);
    expect(isPayoutLate(friday, 2, at('2025-03-26T10:00:00.000Z'))).toBe(true);
    // Validated on Thursday 20 with one day: Friday is the day, the weekend adds none, late on Monday 24.
    const thursday = { ...validated, validatedAt: '2025-03-20T10:00:00.000Z' };
    expect(isPayoutLate(thursday, 1, at('2025-03-22T10:00:00.000Z'))).toBe(false);
    expect(isPayoutLate(thursday, 1, at('2025-03-23T10:00:00.000Z'))).toBe(false);
    expect(isPayoutLate(thursday, 1, at('2025-03-24T10:00:00.000Z'))).toBe(true);
  });

  it('is not known without a delay announced', () => {
    expect(isPayoutLate(validated, null, at('2025-04-30T10:00:00.000Z'))).toBeNull();
  });

  it('is never late once paid, held, before validation, or with nothing to pay', () => {
    const later = at('2025-04-30T10:00:00.000Z');
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
  it('sums the team for a person who sees it whole, over two statements at least', () => {
    const two = [validated, { ...validated, totalMinor: 1_000, payableMinor: 0 }];
    expect(teamSumsFor('owner', two)).toEqual({ statements: 2, totalMinor: 26_300, payableMinor: 25_300 });
    expect(teamSumsFor('agency', two)).toEqual({ statements: 2, totalMinor: 26_300, payableMinor: 25_300 });
  });

  it('gives nothing where the sum would be one member’s pay: a member in self, or a single statement', () => {
    expect(teamSumsFor('self', [validated, validated])).toBeNull();
    expect(teamSumsFor('owner', [validated])).toBeNull();
    expect(teamSumsFor('owner', [])).toBeNull();
  });
});
