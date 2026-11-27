import type { StaircaseSetting } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { stepPriceChoice, type StepPriceInput } from '../step-price';

// Invented amounts, in cents, and invented agency settings: never the agency's own.
const SETTING: StaircaseSetting = {
  targetMultiple: 1.7,
  topTierTargetMultiple: 2.6,
  topTierMinDesire: 90,
  startCapMultiple: 1.25,
};

const base: StepPriceInput = {
  branchesMinor: [1_100],
  lastBoughtMinor: null,
  biggestPurchaseMinor: null,
  fanTier: null,
  desire: 75,
  setting: SETTING,
};

describe('stepPriceChoice (ADR 0098, avenant du 27/11/2026)', () => {
  it('lets the first paid step go at its price without any purchase: no cap from history', () => {
    expect(stepPriceChoice({ ...base, branchesMinor: [9_900] })).toEqual({
      kind: 'offer',
      branch: 0,
      priceMinor: 9_900,
      reason: 'next_step',
      capMinor: null,
    });
    expect(stepPriceChoice({ ...base, biggestPurchaseMinor: 0 }).capMinor).toBeNull();
  });

  it('climbs strictly, whatever the settings: above the last bought goes, the same price never does', () => {
    for (const setting of [SETTING, undefined, {}]) {
      const input = { ...base, setting, lastBoughtMinor: 1_100 };
      expect(stepPriceChoice({ ...input, branchesMinor: [1_101] })).toMatchObject({
        kind: 'offer',
        reason: 'next_step',
      });
      expect(stepPriceChoice({ ...input, branchesMinor: [1_100] })).toEqual({
        kind: 'stop',
        reason: 'limit_reached',
        capMinor: null,
      });
      expect(stepPriceChoice({ ...input, branchesMinor: [900] })).toMatchObject({
        kind: 'stop',
        reason: 'limit_reached',
      });
    }
  });

  it('caps the start at the agency’s multiple of his biggest purchase before, rounded down to the cent', () => {
    expect(stepPriceChoice({ ...base, branchesMinor: [1_300], biggestPurchaseMinor: 1_001 })).toEqual({
      kind: 'stop',
      reason: 'capped_at_start',
      capMinor: 1_251,
    });
    expect(stepPriceChoice({ ...base, branchesMinor: [1_251], biggestPurchaseMinor: 1_001 })).toMatchObject({
      kind: 'offer',
      priceMinor: 1_251,
      reason: 'next_step',
      capMinor: 1_251,
    });
  });

  it('has no cap without the setting', () => {
    expect(
      stepPriceChoice({ ...base, setting: {}, branchesMinor: [5_000], biggestPurchaseMinor: 1_000 }),
    ).toMatchObject({ kind: 'offer', capMinor: null });
  });

  it('applies the cap at the start only: inside the run the staircase climbs past it', () => {
    expect(
      stepPriceChoice({
        ...base,
        branchesMinor: [4_400],
        lastBoughtMinor: 2_200,
        biggestPurchaseMinor: 2_200,
      }),
    ).toMatchObject({ kind: 'offer', priceMinor: 4_400, capMinor: null });
  });

  it('takes a cheaper branch under the cap at the start, and says so', () => {
    expect(
      stepPriceChoice({ ...base, branchesMinor: [2_000, 1_100, 1_200], biggestPurchaseMinor: 1_000 }),
    ).toEqual({ kind: 'offer', branch: 2, priceMinor: 1_200, reason: 'capped_at_start', capMinor: 1_250 });
  });

  it('keeps the default branch at the start when nothing caps it', () => {
    expect(stepPriceChoice({ ...base, branchesMinor: [1_200, 3_000] })).toMatchObject({
      branch: 0,
      reason: 'next_step',
    });
  });

  it('ranks branches toward the agency’s target from the last bought step', () => {
    expect(
      stepPriceChoice({ ...base, branchesMinor: [1_200, 1_650, 2_600], lastBoughtMinor: 1_000 }),
    ).toMatchObject({ branch: 1, priceMinor: 1_650, reason: 'branch_target' });
  });

  it('follows the agency’s order when no target is set', () => {
    expect(
      stepPriceChoice({ ...base, setting: undefined, branchesMinor: [1_200, 1_650], lastBoughtMinor: 1_000 }),
    ).toMatchObject({ branch: 0, reason: 'next_step' });
  });

  it('uses the top tier’s target for a fan of that tier at the desire set, the common one below it', () => {
    const branches = { branchesMinor: [1_700, 2_600], lastBoughtMinor: 1_000 };
    expect(stepPriceChoice({ ...base, ...branches, fanTier: 'whale', desire: 90 })).toMatchObject({
      priceMinor: 2_600,
      reason: 'branch_target_top_tier',
    });
    expect(stepPriceChoice({ ...base, ...branches, fanTier: 'whale', desire: 89 })).toMatchObject({
      priceMinor: 1_700,
      reason: 'branch_target',
    });
    expect(stepPriceChoice({ ...base, ...branches, fanTier: 'very_good', desire: 100 })).toMatchObject({
      priceMinor: 1_700,
      reason: 'branch_target',
    });
  });

  it('takes the cheaper of two branches as close to the target, and never one not strictly above', () => {
    expect(
      stepPriceChoice({ ...base, branchesMinor: [1_000, 1_600, 1_800], lastBoughtMinor: 1_000 }),
    ).toMatchObject({ priceMinor: 1_600, reason: 'branch_target' });
  });
});
