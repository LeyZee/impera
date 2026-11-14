import {
  CommissionStatementIdSchema,
  newId,
  PayPeriodSchema,
  TeamMemberIdSchema,
  UserIdSchema,
  type TeamMemberId,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type { PayrollReadStore, PeriodView, StoredStatement } from '../../domain/ports';
import { createPayrollStatementReads, type PayStatementReader } from '../statement-reads';

/** Invented members only (ADR 0010). */
const P1 = PayPeriodSchema.parse('2025-03-01');
const window = {
  period: P1,
  startsAt: '2025-02-28T23:00:00.000Z',
  endsAt: '2025-03-15T23:00:00.000Z',
  timeZone: 'Europe/Paris',
};

const stored = (memberId: TeamMemberId, totalMinor: number): StoredStatement => ({
  statement: {
    id: newId(CommissionStatementIdSchema),
    memberId,
    window,
    status: 'validated',
    revision: 2,
    engineVersion: 'nirvana-1',
    inputsHash: 'a'.repeat(64),
    lines: [],
    netMinor: totalMinor * 5,
    commissionMinor: totalMinor,
    teamShare: null,
    tierBonus: null,
    collectiveBonusMinor: 0,
    bonuses: [],
    penalties: [],
    carryOversIn: [],
    adjustments: [],
    bonusesMinor: 0,
    penaltiesRequestedMinor: 0,
    penaltiesMinor: 0,
    carryOversInMinor: 0,
    adjustmentsMinor: 0,
    totalMinor,
    carryOverOutMinor: 0,
    writtenOffMinor: 0,
    payableMinor: totalMinor,
    rules: {
      commissionRateBps: 2_000,
      teamShareBps: null,
      bonusTiers: [],
      collectiveGoal: null,
      minimumPayoutMinor: 1_500,
      exchangeRates: [],
      final: false,
    },
    computedAt: '2025-03-16T10:00:00.000Z',
    validatedAt: '2025-03-17T10:00:00.000Z',
    validatedBy: newId(UserIdSchema),
    paidAt: null,
    paidBy: null,
    payment: null,
    payoutBlock: null,
    notIssuedReason: null,
  },
  team: { netMinor: 50_000, collective: null },
});

/** The period's store in memory: who it was read as, and the statements the policies gave. */
function store(statements: StoredStatement[]) {
  const asked: string[] = [];
  const fake: Pick<PayrollReadStore, 'period'> = {
    period: (userId): Promise<PeriodView> => {
      asked.push(userId);
      return Promise.resolve({
        reader: { scope: 'owner', memberId: null },
        window,
        firstClosed: null,
        closing: null,
        blocked: null,
        statements,
        bonusTierSets: [],
        collectiveGoals: [],
        settings: { minimumPayoutMinor: 1_500, nextMinimum: null, payoutDelayBusinessDays: null },
      });
    },
  };
  return { asked, fake };
}

describe('createPayrollStatementReads (ADR 0026 § 1, ADR 0105 § 4)', () => {
  const owner: PayStatementReader = { userId: newId(UserIdSchema), role: 'owner' };

  it('reads the period as the person, each statement cut to what tells no rate, in a fixed order', async () => {
    const [first, second] = [newId(TeamMemberIdSchema), newId(TeamMemberIdSchema)].toSorted();
    if (first === undefined || second === undefined) throw new Error('two members');
    const period = store([stored(second, 3_000), stored(first, 1_600)]);
    const read = await createPayrollStatementReads(period.fake).statements(owner, P1);
    expect(period.asked).toEqual([owner.userId]);
    expect(read.map((one) => [one.memberId, one.totalMinor, one.payableMinor])).toEqual([
      [first, 1_600, 1_600],
      [second, 3_000, 3_000],
    ]);
    expect(read.every((one) => !('netMinor' in one) && !('commissionMinor' in one))).toBe(true);
  });

  it('refuses a creator’s account before reading anything, as the routes refuse her session', async () => {
    const period = store([]);
    await expect(
      createPayrollStatementReads(period.fake).statements({ userId: owner.userId, role: 'creator' }, P1),
    ).rejects.toMatchObject({ code: 'role_forbidden' });
    expect(period.asked).toEqual([]);
  });
});
