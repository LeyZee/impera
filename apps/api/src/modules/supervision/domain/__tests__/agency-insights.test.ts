import {
  AgencyInsightsSchema,
  CreatorIdSchema,
  newId,
  PlatformAccountIdSchema,
  TeamMemberIdSchema,
  type SaleSeller,
  type SalesTotalsRow,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { agencyInsights, agencyRange, type AgencyCreatorRead } from '../agency-insights';

// Everything below is invented (ADR 0010).
const LINA = newId(CreatorIdSchema);
const MAYA = newId(CreatorIdSchema);
const ACCOUNT = newId(PlatformAccountIdSchema);
const THEO = newId(TeamMemberIdSchema);
const NAMES = new Map([[THEO, 'Théo']]);
const theo: SaleSeller = { kind: 'member', memberId: THEO };
const RANGE = { from: '2026-11-04', to: '2026-11-06', previousFrom: '2026-11-01', previousTo: '2026-11-03' };

function row(patch: Partial<SalesTotalsRow> = {}): SalesTotalsRow {
  return {
    day: '2026-11-05',
    platform: 'reveal',
    platformAccountId: ACCOUNT,
    currency: 'EUR',
    saleType: 'ppv',
    seller: theo,
    sales: 1,
    refunds: 0,
    grossInclVatMinor: 1200,
    grossExclVatMinor: 1000,
    netMinor: 800,
    agencyMinor: 300,
    creatorMinor: 500,
    ...patch,
  };
}

function creator(
  creatorId: typeof LINA,
  name: string,
  rows: readonly SalesTotalsRow[],
  more: Partial<AgencyCreatorRead> = {},
): AgencyCreatorRead {
  return {
    creatorId,
    name,
    totals: { from: RANGE.previousFrom, to: RANGE.to, rows: [...rows], refundsWithoutSale: 0 },
    hours: [],
    fans: [],
    previousPaying: 0,
    ...more,
  };
}

const insights = (
  creators: readonly AgencyCreatorRead[],
  rate: { day: string; rateMicros: number } | null = null,
) =>
  AgencyInsightsSchema.parse(agencyInsights({ period: 'week', range: RANGE, creators, names: NAMES, rate }));

describe('agencyRange', () => {
  it('counts today in, and puts the period of the same length just before', () => {
    const now = new Date('2026-11-06T22:30:00Z'); // 23h30 in Paris
    expect(agencyRange('week', now, 'Europe/Paris')).toEqual({
      from: '2026-10-31',
      to: '2026-11-06',
      previousFrom: '2026-10-24',
      previousTo: '2026-10-30',
    });
    expect(agencyRange('day', new Date('2026-11-06T23:30:00Z'), 'Europe/Paris')).toEqual({
      from: '2026-11-07',
      to: '2026-11-07',
      previousFrom: '2026-11-06',
      previousTo: '2026-11-06',
    });
    expect(agencyRange('quarter', now, 'Europe/Paris').from).toBe('2026-08-09');
  });
});

describe('agencyInsights', () => {
  it('splits the totals between the period and the one before, as the register summed them', () => {
    const result = insights([
      creator(LINA, 'Lina', [
        row(),
        row({
          day: '2026-11-06',
          saleType: 'subscription',
          grossInclVatMinor: 1000,
          netMinor: 800,
          agencyMinor: 400,
          creatorMinor: 400,
        }),
        row({
          day: '2026-11-02',
          grossInclVatMinor: 500,
          netMinor: 400,
          agencyMinor: 100,
          creatorMinor: 300,
        }),
        // Before the previous period: in no figure.
        row({ day: '2026-10-20', grossInclVatMinor: 99_999 }),
      ]),
    ]);
    expect(result.totals.current).toEqual({
      revenueMinor: 2200,
      netMinor: 1600,
      agencyMinor: 700,
      creatorMinor: 900,
      sales: 2,
      refunds: 0,
    });
    expect(result.totals.previous.revenueMinor).toBe(500);
    expect(result.days.map((one) => [one.day, one.revenueMinor])).toEqual([
      ['2026-11-04', 0],
      ['2026-11-05', 1200],
      ['2026-11-06', 1000],
    ]);
  });

  it('groups a subscription with its renewals, keeps the kinds in their fixed order and their previous revenue', () => {
    const result = insights([
      creator(LINA, 'Lina', [
        row({ saleType: 'tip', grossInclVatMinor: 300 }),
        row({ saleType: 'renewal', grossInclVatMinor: 900 }),
        row({ saleType: 'subscription', grossInclVatMinor: 1000 }),
        row({ day: '2026-11-02', saleType: 'ppv', grossInclVatMinor: 700 }),
      ]),
    ]);
    expect(result.kinds).toEqual([
      { kind: 'subscriptions', revenueMinor: 1900, sales: 2, previousRevenueMinor: 0 },
      { kind: 'ppv', revenueMinor: 0, sales: 0, previousRevenueMinor: 700 },
      { kind: 'tips', revenueMinor: 300, sales: 1, previousRevenueMinor: 0 },
    ]);
  });

  it('ranks sellers and creators by revenue, names members, a refund taken off its sale', () => {
    const result = insights([
      creator(LINA, 'Lina', [row(), row({ seller: { kind: 'agent' }, grossInclVatMinor: 3000 })]),
      creator(MAYA, 'Maya', [
        row({ seller: { kind: 'none' }, grossInclVatMinor: 5000 }),
        row({
          seller: theo,
          sales: 0,
          refunds: 1,
          grossInclVatMinor: -1200,
          netMinor: -800,
          agencyMinor: -300,
          creatorMinor: -500,
        }),
      ]),
    ]);
    expect(result.sellers.map((one) => [one.seller, one.sales, one.refunds, one.revenueMinor])).toEqual([
      [{ kind: 'none' }, 1, 0, 5000],
      [{ kind: 'agent' }, 1, 0, 3000],
      [{ kind: 'member', memberId: THEO, name: 'Théo' }, 1, 1, 0],
    ]);
    expect(result.byCreator.map((one) => [one.creatorId, one.revenueMinor])).toEqual([
      [LINA, 4200],
      [MAYA, 3800],
    ]);
    expect(result.days.find((one) => one.day === '2026-11-05')?.byCreator).toEqual([
      { creatorId: LINA, revenueMinor: 4200 },
      { creatorId: MAYA, revenueMinor: 3800 },
    ]);
  });

  it('puts the sales on their hour, Monday first', () => {
    const result = insights([
      creator(LINA, 'Lina', [], {
        hours: [
          { isoDay: 1, hour: 21, currency: 'EUR', grossMinor: 1500 },
          { isoDay: 7, hour: 0, currency: 'EUR', grossMinor: 200 },
        ],
      }),
      creator(MAYA, 'Maya', [], { hours: [{ isoDay: 1, hour: 21, currency: 'EUR', grossMinor: 500 }] }),
    ]);
    expect(result.hours[0]?.[21]).toBe(2000);
    expect(result.hours[6]?.[0]).toBe(200);
  });

  it('counts paying fans per creator, the new ones, the ten biggest’s share, never a fan by name', () => {
    const fans = Array.from({ length: 12 }, (_, i) => ({
      key: `account:fan_${String(i)}`,
      currency: 'EUR' as const,
      grossMinor: i === 0 ? 10_000 : 1000,
      seenBefore: i < 4,
    }));
    const result = insights([
      creator(LINA, 'Lina', [], { fans, previousPaying: 7 }),
      // The same key under another creator is another fan.
      creator(MAYA, 'Maya', [], { fans: fans.slice(0, 1), previousPaying: 1 }),
    ]);
    expect(result.fans).toEqual({
      paying: 13,
      previousPaying: 8,
      newPaying: 8,
      // Top ten: 10 000 + 10 000 + 8 × 1000 = 28 000 of 31 000.
      topTenShare: 90,
      averagePerPayingMinor: Math.round(31_000 / 13),
    });
    expect(JSON.stringify(result)).not.toContain('fan_');
  });

  it('leaves dollars out without a rate and says so, converts them with one', () => {
    const rows = [
      row(),
      row({ currency: 'USD', grossInclVatMinor: 1000, netMinor: 800, agencyMinor: 400, creatorMinor: 400 }),
    ];
    const without = insights([creator(LINA, 'Lina', rows)]);
    expect(without.dollarsLeftOut).toBe(true);
    expect(without.totals.current.revenueMinor).toBe(1200);
    expect(without.totals.current.sales).toBe(1);
    const withRate = insights([creator(LINA, 'Lina', rows)], { day: '2026-11-05', rateMicros: 900_000 });
    expect(withRate.dollarsLeftOut).toBe(false);
    expect(withRate.totals.current.revenueMinor).toBe(1200 + 900);
    expect(withRate.totals.current.sales).toBe(2);
  });

  it('answers an empty agency with zeros and nulls, no made-up figure', () => {
    const result = insights([]);
    expect(result.creators).toEqual([]);
    expect(result.days).toHaveLength(3);
    expect(result.fans.topTenShare).toBeNull();
    expect(result.fans.averagePerPayingMinor).toBeNull();
  });
});
