import {
  CommissionStatementIdSchema,
  newId,
  PayPeriodClosingSchema,
  PayPeriodSchema,
  TeamMemberIdSchema,
  UserIdSchema,
  type CommissionStatementRules,
} from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import type { PayReader, PeriodView, StoredStatement } from '../../domain/ports';
import { createPayrollReads } from '../periods';

/** Invented members only (ADR 0010). */
const P1 = PayPeriodSchema.parse('2025-03-01');
const THEO = newId(TeamMemberIdSchema);
const window = {
  period: P1,
  startsAt: '2025-02-28T23:00:00.000Z',
  endsAt: '2025-03-15T23:00:00.000Z',
  timeZone: 'Europe/Paris',
};
const rules = (goal: boolean): CommissionStatementRules => ({
  commissionRateBps: 2_000,
  teamShareBps: null,
  bonusTiers: [],
  collectiveGoal: goal ? { targetMinor: 100_000, tiers: [{ reachedBps: 10_000, bonusMinor: 3_000 }] } : null,
  minimumPayoutMinor: 1_500,
  exchangeRates: [],
  final: false,
});

const stored = (goal: boolean): StoredStatement => ({
  statement: {
    id: newId(CommissionStatementIdSchema),
    memberId: THEO,
    window,
    status: 'draft',
    revision: 1,
    engineVersion: 'nirvana-1',
    inputsHash: 'a'.repeat(64),
    lines: [],
    netMinor: 8_000,
    commissionMinor: 1_600,
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
    totalMinor: 1_600,
    carryOverOutMinor: 0,
    payableMinor: 1_600,
    rules: rules(goal),
    computedAt: '2025-03-16T10:00:00.000Z',
    validatedAt: null,
    validatedBy: null,
    paidAt: null,
    paidBy: null,
    payment: null,
  },
  team: { netMinor: 50_000, collective: goal ? { reachedBps: 5_000, tier: null } : null },
});

const closing = PayPeriodClosingSchema.parse({
  period: P1,
  exchangeRates: [
    {
      currency: 'USD',
      day: '2025-03-14',
      rateMicros: 920_000,
      source: 'ecb',
      fetchedAt: '2025-03-14T15:07:00.000Z',
    },
  ],
  closedBy: newId(UserIdSchema),
  closedAt: '2025-03-17T09:00:00.000Z',
});

const read = (
  reader: PayReader,
  goal: boolean,
  at = '2025-03-20T00:00:00Z',
  view: Partial<Pick<PeriodView, 'closing' | 'firstClosed' | 'blocked'>> = {},
) =>
  createPayrollReads(
    {
      period: (): Promise<PeriodView> =>
        Promise.resolve({
          reader,
          window,
          firstClosed: null,
          closing: null,
          blocked: null,
          ...view,
          statements: [stored(goal)],
          bonusTierSets: [],
          collectiveGoals: [],
          settings: { minimumPayoutMinor: 1_500, nextMinimum: null, payoutDelayBusinessDays: null },
        }),
      periods: () => Promise.reject(new Error('not read here')),
      entries: () => Promise.reject(new Error('not read here')),
      settings: () => Promise.reject(new Error('not read here')),
      exchangeRates: () => Promise.reject(new Error('not read here')),
    },
    () => new Date(at),
  ).period(newId(UserIdSchema), P1);

describe('a period as its reader sees it (EQ-04)', () => {
  it('shows the team’s net to the agency, and to a member only how far the team got toward its goal', async () => {
    const agency = { scope: 'agency' as const, memberId: newId(TeamMemberIdSchema) };
    const own = { scope: 'self' as const, memberId: THEO };
    expect((await read(agency, false)).statements[0]?.team).toEqual({ netMinor: 50_000, collective: null });
    expect((await read(agency, true)).statements[0]?.team?.netMinor).toBe(50_000);
    expect((await read(own, false)).statements[0]?.team).toBeNull();
    expect((await read(own, true)).statements[0]?.team).toEqual({
      netMinor: null,
      collective: { reachedBps: 5_000, tier: null },
    });
  });

  it('shows a member a closing’s date only, never who closed it nor its rates', async () => {
    const agency = await read({ scope: 'owner', memberId: null }, false, undefined, { closing });
    const own = await read({ scope: 'self', memberId: THEO }, false, undefined, { closing });
    expect(agency.closing).toEqual(closing);
    expect(own.closing).toEqual({ ...closing, closedBy: null, exchangeRates: null });
  });

  it('says whether the period comes before the team’s first closing', async () => {
    const owner = { scope: 'owner' as const, memberId: null };
    const P2 = PayPeriodSchema.parse('2025-03-16');
    expect((await read(owner, false)).beforeFirstClosing).toBe(false);
    expect((await read(owner, false, undefined, { firstClosed: P2 })).beforeFirstClosing).toBe(true);
    expect((await read(owner, false, undefined, { firstClosed: P1 })).beforeFirstClosing).toBe(false);
  });

  it('says the period is blocked, and to a member only whether they lack a rate themselves', async () => {
    const LEA = newId(TeamMemberIdSchema);
    const blocked = {
      code: 'commission_rate_missing_conflict' as const,
      memberIds: [THEO, LEA],
      since: '2025-03-16T10:00:00.000Z',
    };
    const owner = await read({ scope: 'owner', memberId: null }, false, undefined, { blocked });
    expect(owner.blocked).toEqual(blocked);
    // The figures stay those of the last computation that passed: the block says they are out of date.
    expect(owner.statements).toHaveLength(1);
    expect((await read({ scope: 'self', memberId: THEO }, false, undefined, { blocked })).blocked).toEqual({
      ...blocked,
      memberIds: [THEO],
    });
    expect((await read({ scope: 'self', memberId: LEA }, false, undefined, { blocked })).blocked).toEqual({
      ...blocked,
      memberIds: [LEA],
    });
    expect((await read({ scope: 'owner', memberId: null }, false)).blocked).toBeNull();
  });

  it('lets the agency validate a draft, never its own member, and says whether the period has ended', async () => {
    const own = await read({ scope: 'self', memberId: THEO }, false);
    const agency = await read({ scope: 'owner', memberId: null }, false);
    expect(own.statements[0]?.canValidate).toBe(false);
    expect(agency.statements[0]?.canValidate).toBe(true);
    expect(agency.ended).toBe(true);
    expect((await read({ scope: 'owner', memberId: null }, false, '2025-03-10T00:00:00Z')).ended).toBe(false);
  });
});

describe('the periods’ list (EQ-05)', () => {
  it('says of each period whether it has ended, at the reader’s now, and keeps the page’s cursor', async () => {
    const summary = {
      window,
      closedAt: null,
      closedBy: null,
      blocked: null,
      statements: { draft: 1, validated: 0, paid: 0, carried: 0 },
      netMinor: 6_400,
      payableMinor: 1_600,
      validatedPayableMinor: 0,
      carriedMinor: 0,
      paidMinor: 0,
    };
    const list = (at: string) =>
      createPayrollReads(
        {
          period: () => Promise.reject(new Error('not read here')),
          periods: () => Promise.resolve({ items: [summary], nextCursor: 'next' }),
          entries: () => Promise.reject(new Error('not read here')),
          settings: () => Promise.reject(new Error('not read here')),
          exchangeRates: () => Promise.reject(new Error('not read here')),
        },
        () => new Date(at),
      ).periods(newId(UserIdSchema), { limit: 1 });
    expect(await list('2025-03-20T00:00:00Z')).toEqual({
      items: [{ ...summary, ended: true }],
      nextCursor: 'next',
    });
    expect((await list('2025-03-10T00:00:00Z')).items[0]?.ended).toBe(false);
  });
});
