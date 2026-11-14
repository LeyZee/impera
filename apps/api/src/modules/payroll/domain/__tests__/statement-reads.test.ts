import { CommissionStatementIdSchema, newId, TeamMemberIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { readsPay, statementAmountsOf } from '../statement-reads';

import { P1 } from './fixtures';

/** What a statement keeps that may leave (`StatementAmounts`), and the rest of a statement, which never does. */
const paid = {
  id: newId(CommissionStatementIdSchema),
  memberId: newId(TeamMemberIdSchema),
  window: {
    period: P1,
    startsAt: '2025-02-28T23:00:00.000Z',
    endsAt: '2025-03-15T23:00:00.000Z',
    timeZone: 'Europe/Paris',
  },
  status: 'paid' as const,
  revision: 3,
  computedAt: '2025-03-16T08:00:00.000Z',
  validatedAt: '2025-03-17T08:00:00.000Z',
  paidAt: '2025-03-18T08:00:00.000Z',
  bonusesMinor: 6_000,
  penaltiesMinor: 1_000,
  carryOversInMinor: 500,
  adjustmentsMinor: -200,
  totalMinor: 25_300,
  carryOverOutMinor: 0,
  writtenOffMinor: 0,
  payableMinor: 25_300,
};

/** The same statement as a rate of 20 % gave it: a net of 100 €, a commission of 20 €, a team share, a tier. */
const atTwenty = {
  ...paid,
  netMinor: 100_000,
  commissionMinor: 20_000,
  teamShare: { baseNetMinor: 400_000, bps: 500, amountMinor: 0 },
  tierBonus: { name: 'Palier 1', thresholdMinor: 80_000, bonusMinor: 5_000 },
  rules: { commission: { rateBps: 2_000 } },
  lines: [{ base: 'platform_net', rateBps: 2_000 }],
  payment: { method: 'transfer', reference: 'VIR-INVENTE-1', sentMinor: 25_300 },
};

/** And as a rate of 10 %: twice the net for the same commission. */
const atTen = {
  ...atTwenty,
  netMinor: 200_000,
  teamShare: { baseNetMinor: 400_000, bps: 1_000, amountMinor: 0 },
  rules: { commission: { rateBps: 1_000 } },
  lines: [{ base: 'platform_net', rateBps: 1_000 }],
};

describe('readsPay', () => {
  it('lets the owner and the team’s accounts read, never a creator', () => {
    expect(readsPay('owner')).toBe(true);
    expect(readsPay('operator')).toBe(true);
    expect(readsPay('creator')).toBe(false);
  });
});

describe('statementAmountsOf (ADR 0105 § 3 and § 4)', () => {
  it('gives the state and the amounts paid, under these names only', () => {
    expect(statementAmountsOf(atTwenty)).toEqual({
      id: paid.id,
      memberId: paid.memberId,
      period: P1,
      status: 'paid',
      revision: 3,
      computedAt: '2025-03-16T08:00:00.000Z',
      validatedAt: '2025-03-17T08:00:00.000Z',
      paidAt: '2025-03-18T08:00:00.000Z',
      bonusesMinor: 6_000,
      penaltiesMinor: 1_000,
      carryOversInMinor: 500,
      adjustmentsMinor: -200,
      totalMinor: 25_300,
      carryOverOutMinor: 0,
      writtenOffMinor: 0,
      payableMinor: 25_300,
    });
  });

  it('tells no rate: two statements whose rates differ read the same, with neither the net nor the commission', () => {
    const read = statementAmountsOf(atTwenty);
    expect(statementAmountsOf(atTen)).toEqual(read);
    for (const closed of [
      'netMinor',
      'commissionMinor',
      'teamShare',
      'tierBonus',
      'rules',
      'lines',
      'payment',
    ])
      expect(Object.keys(read)).not.toContain(closed);
    const text = JSON.stringify(read);
    for (const amount of ['100000', '200000', '20000', '80000', 'VIR-INVENTE'])
      expect(text).not.toContain(amount);
  });
});
