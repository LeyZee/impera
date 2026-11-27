import { describe, expect, it } from 'vitest';

import {
  START_CAP_OF_BIGGEST_PURCHASE,
  STAIRCASE_TARGET,
  STAIRCASE_TARGET_WHALE_VERY_HOT,
  VERY_HOT_DESIRE,
  stepPriceChoice,
  type StepPriceInput,
} from '../step-price';

// Invented amounts, in cents.
const base: StepPriceInput = {
  branchesMinor: [1_100],
  lastBoughtMinor: null,
  biggestPurchaseMinor: null,
  fanTier: null,
  desire: 75,
};

describe('stepPriceChoice (ADR 0098, avenant du 27/11/2026)', () => {
  it('names its constants: twice, three times for a very hot whale, one and a half times at the start', () => {
    expect(STAIRCASE_TARGET).toBe(2);
    expect(STAIRCASE_TARGET_WHALE_VERY_HOT).toBe(3);
    expect(START_CAP_OF_BIGGEST_PURCHASE).toBe(1.5);
    expect(VERY_HOT_DESIRE).toBe(85);
  });

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

  it('climbs strictly: a step above the last bought goes, the same price never does', () => {
    expect(stepPriceChoice({ ...base, branchesMinor: [1_101], lastBoughtMinor: 1_100 })).toMatchObject({
      kind: 'offer',
      reason: 'next_step',
    });
    expect(stepPriceChoice({ ...base, branchesMinor: [1_100], lastBoughtMinor: 1_100 })).toEqual({
      kind: 'stop',
      reason: 'limit_reached',
      capMinor: null,
    });
    expect(stepPriceChoice({ ...base, branchesMinor: [900], lastBoughtMinor: 1_100 })).toMatchObject({
      kind: 'stop',
      reason: 'limit_reached',
    });
  });

  it('caps the start at one and a half times his biggest purchase before, rounded down to the cent', () => {
    const over = stepPriceChoice({ ...base, branchesMinor: [1_600], biggestPurchaseMinor: 1_001 });
    expect(over).toEqual({ kind: 'stop', reason: 'capped_by_biggest_purchase', capMinor: 1_501 });
    expect(stepPriceChoice({ ...base, branchesMinor: [1_501], biggestPurchaseMinor: 1_001 })).toMatchObject({
      kind: 'offer',
      priceMinor: 1_501,
      reason: 'next_step',
      capMinor: 1_501,
    });
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
      stepPriceChoice({ ...base, branchesMinor: [2_000, 1_200, 1_400], biggestPurchaseMinor: 1_000 }),
    ).toEqual({
      kind: 'offer',
      branch: 2,
      priceMinor: 1_400,
      reason: 'capped_by_biggest_purchase',
      capMinor: 1_500,
    });
  });

  it('keeps the default branch at the start when nothing caps it', () => {
    expect(stepPriceChoice({ ...base, branchesMinor: [1_200, 3_000] })).toMatchObject({
      branch: 0,
      reason: 'next_step',
    });
  });

  it('ranks branches toward twice the last bought step', () => {
    expect(
      stepPriceChoice({ ...base, branchesMinor: [1_500, 2_100, 3_300], lastBoughtMinor: 1_000 }),
    ).toMatchObject({ branch: 1, priceMinor: 2_100, reason: 'branch_double' });
  });

  it('ranks toward three times for a whale who is very hot, twice for a whale who is merely hot', () => {
    const branches = { branchesMinor: [2_000, 3_000], lastBoughtMinor: 1_000 };
    expect(
      stepPriceChoice({ ...base, ...branches, fanTier: 'whale', desire: VERY_HOT_DESIRE }),
    ).toMatchObject({ priceMinor: 3_000, reason: 'branch_triple_whale' });
    expect(
      stepPriceChoice({ ...base, ...branches, fanTier: 'whale', desire: VERY_HOT_DESIRE - 1 }),
    ).toMatchObject({ priceMinor: 2_000, reason: 'branch_double' });
    expect(stepPriceChoice({ ...base, ...branches, fanTier: 'very_good', desire: 100 })).toMatchObject({
      priceMinor: 2_000,
      reason: 'branch_double',
    });
  });

  it('takes the cheaper of two branches as close to the target, and never one not strictly above', () => {
    expect(
      stepPriceChoice({ ...base, branchesMinor: [1_000, 1_800, 2_200], lastBoughtMinor: 1_000 }),
    ).toMatchObject({ priceMinor: 1_800, reason: 'branch_double' });
  });
});
