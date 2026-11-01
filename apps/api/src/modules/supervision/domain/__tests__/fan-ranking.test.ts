import { describe, expect, it } from 'vitest';

import { rankFans, usdToEurMinor, type FanSales } from '../fan-ranking';

// 0.893815 € for one dollar: the inverse of an ECB 1.1188 dollars per euro, as pay writes it (ADR 0033).
const RATE = { day: '2026-10-27', rateMicros: 893_815 };

const fan = (fanId: string, sales: Partial<Omit<FanSales, 'fanId'>> = {}): FanSales => ({
  fanId,
  conversationId: `conversation-${fanId}`,
  eurMinor: 0,
  usdMinor: 0,
  byAgentEurMinor: 0,
  byAgentUsdMinor: 0,
  ...sales,
});

describe('usdToEurMinor', () => {
  it('converts dollar cents to euro cents at the rate in millionths', () => {
    // 10 $ × 0.893815 = 8.93815 € → 8.94 €.
    expect(usdToEurMinor(1_000, RATE.rateMicros)).toBe(894);
    expect(usdToEurMinor(0, RATE.rateMicros)).toBe(0);
    expect(usdToEurMinor(1_000, 1_000_000)).toBe(1_000);
  });

  it('rounds to the nearest cent, a half cent up (away from zero), as pay does', () => {
    // 1 $ × 0.905 = 0.905 € → 0.91 € ; 1 $ × 0.904999 = 0.904999 € → 0.90 €.
    expect(usdToEurMinor(100, 905_000)).toBe(91);
    expect(usdToEurMinor(100, 904_999)).toBe(90);
    // 0.5 cent exactly: up.
    expect(usdToEurMinor(1, 500_000)).toBe(1);
    expect(usdToEurMinor(1, 499_999)).toBe(0);
  });

  it('stays exact past what a float would round', () => {
    // 90 000 000 000 $ cents × 0.999999: the product is past 2^53, the result is not.
    expect(usdToEurMinor(9_000_000_000_000, 999_999)).toBe(8_999_991_000_000);
  });

  it('refuses a rate or an amount that is not a whole positive number', () => {
    expect(() => usdToEurMinor(100, 0)).toThrow(RangeError);
    expect(() => usdToEurMinor(100, 1.5)).toThrow(RangeError);
    expect(() => usdToEurMinor(-1, RATE.rateMicros)).toThrow(RangeError);
    expect(() => usdToEurMinor(0.5, RATE.rateMicros)).toThrow(RangeError);
  });
});

describe('rankFans', () => {
  it('ranks on the sum in euros, his dollars converted', () => {
    // Marc: 30 € and 20 $ (17.88 €) = 47.88 €; Julien: 45 €; Hugo: 60 $ = 53.63 €.
    const ranked = rankFans(
      [
        fan('julien', { eurMinor: 4_500 }),
        fan('marc', { eurMinor: 3_000, usdMinor: 2_000 }),
        fan('hugo', { usdMinor: 6_000, byAgentUsdMinor: 6_000 }),
      ],
      RATE,
      10,
    );
    expect(ranked.map((f) => [f.fanId, f.spentMinor, f.byAgentMinor])).toEqual([
      ['hugo', 5_363, 5_363],
      ['marc', 4_788, 0],
      ['julien', 4_500, 0],
    ]);
    expect(ranked[0]?.conversationId).toBe('conversation-hugo');
  });

  it('leaves the dollars out without a rate: a fan who paid in dollars only drops out', () => {
    const ranked = rankFans(
      [
        fan('julien', { eurMinor: 4_500 }),
        fan('marc', { eurMinor: 3_000, usdMinor: 2_000 }),
        fan('hugo', { usdMinor: 6_000 }),
      ],
      null,
      10,
    );
    expect(ranked.map((f) => [f.fanId, f.spentMinor])).toEqual([
      ['julien', 4_500],
      ['marc', 3_000],
    ]);
  });

  it('rounds the whole and the agent’s part once each, so the part never exceeds the whole', () => {
    // At 0.5 €: the whole, 0.02 $, is 0.01 €; the agent's part, 0.01 $, is 0.005 €, rounded up to 0.01 €, not past it.
    const [only] = rankFans(
      [fan('a', { usdMinor: 2, byAgentUsdMinor: 1 })],
      { day: '2026-10-27', rateMicros: 500_000 },
      10,
    );
    expect(only).toMatchObject({ spentMinor: 1, byAgentMinor: 1 });
  });

  it('keeps the top ones, a tie always in the same order', () => {
    const ranked = rankFans(
      [fan('c', { eurMinor: 100 }), fan('a', { eurMinor: 100 }), fan('b', { eurMinor: 300 })],
      RATE,
      2,
    );
    expect(ranked.map((f) => f.fanId)).toEqual(['b', 'a']);
  });
});
