import { CARRY_OVER_RANK_MAX, carryOverRank } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import {
  computeCommissionStatements,
  type AccountEarnings,
  type MemberPayInput,
  type PeriodPayInput,
  type CommissionStatement,
} from '../commission-statements';

/*
 * Properties of the engine over periods drawn at random (EQ-04), from a fixed seed so that a failure replays: no
 * dependency for it, a small generator is enough for integers.
 */

/** Mulberry32: a seeded generator of [0, 1). */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

type Draw = () => number;
const between = (draw: Draw, low: number, high: number): number =>
  low + Math.floor(draw() * (high - low + 1));
const some = <T>(draw: Draw, max: number, make: (index: number) => T): T[] =>
  Array.from({ length: between(draw, 0, max) }, (_, index) => make(index));

/** The same items in another order: each takes a random key, and the keys are sorted. */
function shuffled<T>(draw: Draw, items: readonly T[]): T[] {
  return items
    .map((item) => ({ key: draw(), item }))
    .sort((a, b) => a.key - b.key)
    .map(({ item }) => item);
}

function memberOf(draw: Draw, index: number): MemberPayInput {
  const manager = draw() < 0.2;
  const accounts: AccountEarnings[] = some(draw, 3, (account) => ({
    platformAccountId: `account-${String(account)}`,
    currency: draw() < 0.5 ? 'EUR' : 'USD',
    // Mostly sales, now and then a late refund.
    grossMinor: draw() < 0.1 ? -between(draw, 0, 50_000) : between(draw, 0, 5_000_000),
    vatBps: between(draw, 0, 2_500),
    platformFeeBps: between(draw, 0, 5_000),
  }));
  return {
    memberId: `member-${String(index)}`,
    teamRole: manager ? 'manager' : 'chatter',
    commissionRateBps: between(draw, 0, 5_000),
    teamShareBps: manager ? between(draw, 0, 1_500) : null,
    collectiveEligible: !manager && draw() < 0.9,
    final: draw() < 0.1,
    accounts,
    manualBonuses: some(draw, 2, (bonus) => ({
      id: `b${String(bonus)}`,
      amountMinor: between(draw, 1, 20_000),
    })),
    penalties: some(draw, 2, (penalty) =>
      draw() < 0.5
        ? { id: `p${String(penalty)}`, kind: 'fixed', amountMinor: between(draw, 1, 200_000) }
        : { id: `p${String(penalty)}`, kind: 'percent', bps: between(draw, 1, 3_000) },
    ),
    carryOversIn: some(draw, 1, (carry) => {
      const amountMinor = between(draw, -5_000, 1_499);
      // A positive carry-over is at rank 1 or 2, a negative one at rank 1 (ADR 0038).
      return { id: `c${String(carry)}`, amountMinor, rank: amountMinor > 0 ? between(draw, 1, 2) : 1 };
    }),
    adjustments: some(draw, 1, (adjustment) => ({
      id: `a${String(adjustment)}`,
      amountMinor: between(draw, -100_000, 100_000),
    })),
  };
}

function periodOf(draw: Draw): PeriodPayInput {
  return {
    rates: [
      { currency: 'USD', rateMicros: between(draw, 800_000, 1_100_000), source: 'test', day: '2026-10-31' },
    ],
    // Few thresholds, so that two tiers on the same one come up.
    bonusTiers: some(draw, 4, () => ({
      thresholdMinor: between(draw, 0, 4) * 500_000,
      bonusMinor: between(draw, 0, 50_000),
    })),
    collectiveGoal:
      draw() < 0.5
        ? null
        : {
            targetMinor: between(draw, 1, 10_000_000),
            tiers: some(draw, 4, () => ({
              reachedBps: between(draw, 2, 6) * 2_500,
              bonusMinor: between(draw, 0, 10_000),
            })),
          },
    minimumPayoutMinor: between(draw, 0, 3_000),
    members: Array.from({ length: between(draw, 1, 6) }, (_, index) => memberOf(draw, index)),
  };
}

const RUNS = 400;
const periods = (seed: number): PeriodPayInput[] => {
  const draw = seeded(seed);
  return Array.from({ length: RUNS }, () => periodOf(draw));
};

const byMember = (statements: readonly CommissionStatement[]): Map<string, CommissionStatement> =>
  new Map(statements.map((one) => [one.memberId, one]));

describe('every period the engine computes', () => {
  it('never pays below zero, nor under the minimum outside a final statement or an amount carried twice', () => {
    for (const input of periods(1)) {
      for (const one of computeCommissionStatements(input).statements) {
        const member = input.members.find((candidate) => candidate.memberId === one.memberId);
        const carriedTwice = member?.carryOversIn.some((carry) => carry.amountMinor > 0 && carry.rank === 2);
        expect(one.payableMinor).toBeGreaterThanOrEqual(0);
        if (one.payableMinor > 0 && member?.final !== true && carriedTwice !== true) {
          expect(one.payableMinor).toBeGreaterThanOrEqual(input.minimumPayoutMinor);
        }
        expect(one.payableMinor + one.carryOverOutMinor).toBe(one.totalMinor);
      }
    }
  });

  it('carries a positive amount twice at most: the third period pays it (ADR 0038)', () => {
    for (const input of periods(7)) {
      for (const one of computeCommissionStatements(input).statements) {
        const member = input.members.find((candidate) => candidate.memberId === one.memberId);
        if (member === undefined) throw new Error('no member');
        expect(carryOverRank(member.carryOversIn, one.carryOverOutMinor)).toBeLessThanOrEqual(
          CARRY_OVER_RANK_MAX,
        );
      }
    }
  });

  it('caps penalties at the share plus bonuses, and adds up to its total', () => {
    for (const input of periods(2)) {
      for (const one of computeCommissionStatements(input).statements) {
        const share = one.commissionMinor + (one.teamShare?.amountMinor ?? 0);
        expect(one.penaltiesMinor).toBeGreaterThanOrEqual(0);
        expect(one.penaltiesMinor).toBeLessThanOrEqual(Math.max(0, share + one.bonusesMinor));
        expect(one.penaltiesMinor).toBeLessThanOrEqual(Math.max(0, one.penaltiesRequestedMinor));
        expect(one.totalMinor).toBe(
          share + one.bonusesMinor - one.penaltiesMinor + one.carryOversInMinor + one.adjustmentsMinor,
        );
        expect(one.netMinor).toBe(one.lines.reduce((total, line) => total + line.netMinor, 0));
      }
    }
  });

  it('gives the same statements again, computed twice', () => {
    for (const input of periods(3)) {
      expect(computeCommissionStatements(input)).toEqual(computeCommissionStatements(structuredClone(input)));
    }
  });

  it('does not depend on the order of the members, their accounts, their amounts or the tiers', () => {
    const draw = seeded(4);
    for (const input of periods(5)) {
      const reordered: PeriodPayInput = {
        ...input,
        bonusTiers: shuffled(draw, input.bonusTiers),
        collectiveGoal:
          input.collectiveGoal === null
            ? null
            : { ...input.collectiveGoal, tiers: shuffled(draw, input.collectiveGoal.tiers) },
        members: shuffled(draw, input.members).map((member) => ({
          ...member,
          accounts: shuffled(draw, member.accounts),
          manualBonuses: shuffled(draw, member.manualBonuses),
          penalties: shuffled(draw, member.penalties),
        })),
      };
      const before = byMember(computeCommissionStatements(input).statements);
      const after = byMember(computeCommissionStatements(reordered).statements);
      expect(after.size).toBe(before.size);
      for (const [memberId, one] of before) {
        const again = after.get(memberId);
        expect({ ...again, lines: undefined }).toEqual({ ...one, lines: undefined });
        const sorted = (lines: CommissionStatement['lines'] | undefined) =>
          [...(lines ?? [])].sort((a, b) => a.platformAccountId.localeCompare(b.platformAccountId));
        expect(sorted(again?.lines)).toEqual(sorted(one.lines));
      }
    }
  });
});
