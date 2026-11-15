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

import {
  agencyInsights,
  agencyTransferVat,
  agencyRange,
  subscribersOf,
  type AgencyCreatorRead,
  type StatsDay,
} from '../agency-insights';

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
    refundsWithoutSale: 0,
    stats: [],
    ...more,
  };
}

const insights = (
  creators: readonly AgencyCreatorRead[],
  rate: { day: string; rateMicros: number } | null = null,
) =>
  AgencyInsightsSchema.parse(
    agencyInsights({ period: 'week', range: RANGE, creators, names: NAMES, rate, timeZone: 'Europe/Paris' }),
  );

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
          grossExclVatMinor: 900,
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
      revenueExclVatMinor: 1900,
      netMinor: 1600,
      agencyMinor: 700,
      creatorMinor: 900,
      agencyTransferVatMinor: 140,
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

  it("estimates the VAT added to the agency's transfers on its part alone, never on a part at zero (ADR 0106)", () => {
    expect(agencyTransferVat(10_000)).toBe(2_000);
    // A fifth of a cent rounds down, three fifths up.
    expect(agencyTransferVat(1)).toBe(0);
    expect(agencyTransferVat(3)).toBe(1);
    expect(agencyTransferVat(0)).toBe(0);
    expect(agencyTransferVat(-500)).toBe(0);
    const result = insights([
      creator(LINA, 'Lina', [row({ day: '2026-11-06', netMinor: 800, agencyMinor: 300, creatorMinor: 500 })]),
    ]);
    expect(result.totals.current.agencyTransferVatMinor).toBe(60);
    expect(result.byCreator[0]?.agencyTransferVatMinor).toBe(60);
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
          { isoDay: 1, hour: 21, saleType: 'ppv', currency: 'EUR', grossMinor: 1500 },
          { isoDay: 7, hour: 0, saleType: 'tip', currency: 'EUR', grossMinor: 200 },
        ],
      }),
      creator(MAYA, 'Maya', [], {
        hours: [{ isoDay: 1, hour: 21, saleType: 'ppv', currency: 'EUR', grossMinor: 500 }],
      }),
    ]);
    expect(result.hours[0]?.[21]).toBe(2000);
    expect(result.hours[6]?.[0]).toBe(200);
    // A week has no hour-by-hour chart.
    expect(result.hourly).toEqual([]);
  });

  it('splits one day hour by hour, by creator and by kind', () => {
    const result = AgencyInsightsSchema.parse(
      agencyInsights({
        period: 'day',
        range: RANGE,
        creators: [
          creator(LINA, 'Lina', [], {
            hours: [
              { isoDay: 4, hour: 21, saleType: 'ppv', currency: 'EUR', grossMinor: 1500 },
              { isoDay: 4, hour: 21, saleType: 'tip', currency: 'EUR', grossMinor: 300 },
            ],
          }),
          creator(MAYA, 'Maya', [], {
            hours: [{ isoDay: 4, hour: 21, saleType: 'ppv', currency: 'EUR', grossMinor: 500 }],
          }),
        ],
        names: NAMES,
        rate: null,
        timeZone: 'Europe/Paris',
      }),
    );
    expect(result.hourly).toHaveLength(24);
    expect(result.hourly[20]).toEqual({ hour: 20, revenueMinor: 0, byCreator: [], byKind: [] });
    expect(result.hourly[21]).toEqual({
      hour: 21,
      revenueMinor: 2300,
      byCreator: [
        { creatorId: LINA, revenueMinor: 1800 },
        { creatorId: MAYA, revenueMinor: 500 },
      ],
      byKind: [
        { kind: 'ppv', revenueMinor: 2000 },
        { kind: 'tips', revenueMinor: 300 },
      ],
    });
  });

  it('counts paying fans per creator, the new ones, the ten biggest’s share, never a fan by name', () => {
    const fans = Array.from({ length: 12 }, (_, i) => ({
      key: `account:fan_${String(i)}`,
      currency: 'EUR' as const,
      grossMinor: i === 0 ? 10_000 : 1000,
      previous: false,
      seenBefore: i < 4,
    }));
    const before = Array.from({ length: 7 }, (_, i) => ({
      key: `account:fan_${String(i)}`,
      currency: 'EUR' as const,
      grossMinor: 500,
      previous: true,
      seenBefore: false,
    }));
    const result = insights([
      creator(LINA, 'Lina', [], {
        // Fan 11 was refunded all he spent: he paid nothing.
        fans: [
          ...fans.slice(0, 11),
          {
            key: 'account:fan_11',
            currency: 'EUR' as const,
            grossMinor: 0,
            previous: false,
            seenBefore: false,
          },
          ...before,
        ],
        refundsWithoutSale: 2,
      }),
      // The same key under another creator is another fan.
      creator(MAYA, 'Maya', [], { fans: [...fans.slice(0, 1), ...before.slice(0, 1)] }),
    ]);
    expect(result.fans).toEqual({
      paying: 12,
      previousPaying: 8,
      newPaying: 7,
      // Top ten: 10 000 + 10 000 + 8 × 1000 = 28 000 of 30 000.
      topTenShare: 93,
      averagePerPayingMinor: Math.round(30_000 / 12),
    });
    expect(result.refundsWithoutSale).toBe(2);
    expect(JSON.stringify(result)).not.toContain('fan_');
  });

  it('counts a fan who paid in dollars alone in neither period without a rate', () => {
    const dollars = (previous: boolean) => ({
      key: 'account:fan_usd',
      currency: 'USD' as const,
      grossMinor: 1000,
      previous,
      seenBefore: false,
    });
    const without = insights([creator(LINA, 'Lina', [], { fans: [dollars(false), dollars(true)] })]);
    expect([without.fans.paying, without.fans.previousPaying]).toEqual([0, 0]);
    const withRate = insights([creator(LINA, 'Lina', [], { fans: [dollars(false), dollars(true)] })], {
      day: '2026-11-05',
      rateMicros: 900_000,
    });
    expect([withRate.fans.paying, withRate.fans.previousPaying]).toEqual([1, 1]);
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

describe('subscribersOf (ADR 0081)', () => {
  const ACCOUNT_B = newId(PlatformAccountIdSchema);
  const READ = new Date('2026-11-06T13:05:00Z');
  function line(day: string, patch: Partial<StatsDay> = {}): StatsDay {
    return {
      platformAccountId: ACCOUNT,
      day,
      newSubscribers: 2,
      unsubscribes: 1,
      activeSubscribers: 100,
      renewals: 3,
      ppvSent: 10,
      ppvPurchased: 4,
      messagesSent: 50,
      messagesReceived: 60,
      readAt: READ,
      ...patch,
    };
  }
  const every = (from: number, to: number, patch: (day: string) => Partial<StatsDay> = () => ({})) =>
    Array.from({ length: to - from + 1 }, (_, i) => {
      const day = `2026-11-0${String(from + i)}`;
      return line(day, patch(day));
    });

  it('is null while the snapshot holds nothing', () => {
    expect(subscribersOf([creator(LINA, 'Lina', [])], RANGE)).toBeNull();
    expect(insights([creator(LINA, 'Lina', [row()])]).subscribers).toBeNull();
  });

  it('sums the period and the one before, with the subscribers before each', () => {
    const stats = every(0 + 1, 6, (day) => ({ activeSubscribers: 100 + Number(day.slice(-1)) }));
    // The day before the previous period (31/10) gives its subscribers before.
    const result = subscribersOf(
      [creator(LINA, 'Lina', [], { stats: [line('2026-10-31', { activeSubscribers: 90 }), ...stats] })],
      RANGE,
    );
    expect(result?.current).toEqual({
      activeAtEnd: 106,
      activeBefore: 103,
      newSubscribers: 6,
      unsubscribes: 3,
      renewals: 9,
      ppvSent: 30,
      ppvPurchased: 12,
      messagesSent: 150,
      messagesReceived: 180,
      daysRead: 3,
      days: 3,
    });
    expect(result?.previous.activeBefore).toBe(90);
    expect(result?.previous.activeAtEnd).toBe(103);
    expect(result?.days).toEqual([
      { day: '2026-11-04', active: 104 },
      { day: '2026-11-05', active: 105 },
      { day: '2026-11-06', active: 106 },
    ]);
    expect(result?.readAt).toBe(READ.toISOString());
  });

  it('never counts a day one account has not been read for, and says how many days it counted', () => {
    const result = subscribersOf(
      [
        creator(LINA, 'Lina', [], { stats: every(4, 6) }),
        // Maya's account has today, not yesterday.
        creator(MAYA, 'Maya', [], {
          stats: [
            line('2026-11-04', { platformAccountId: ACCOUNT_B }),
            line('2026-11-06', { platformAccountId: ACCOUNT_B }),
          ],
        }),
      ],
      RANGE,
    );
    expect(result?.days.map((one) => one.active)).toEqual([200, null, 200]);
    expect(result?.current.daysRead).toBe(2);
    expect(result?.current.newSubscribers).toBe(8);
    expect(result?.current.activeAtEnd).toBe(200);
    // Nothing before the period: its subscribers before are unknown, never zero.
    expect(result?.current.activeBefore).toBeNull();
    expect(result?.previous.daysRead).toBe(0);
  });

  it('leaves a count still computed by the platform null for the whole period', () => {
    const result = subscribersOf(
      [
        creator(LINA, 'Lina', [], {
          stats: every(4, 6, (day) => (day === '2026-11-06' ? { messagesSent: null, ppvSent: null } : {})),
        }),
      ],
      RANGE,
    );
    expect(result?.current.messagesSent).toBeNull();
    expect(result?.current.ppvSent).toBeNull();
    expect(result?.current.messagesReceived).toBe(180);
    expect(result?.current.ppvPurchased).toBe(12);
  });

  it('passes the contract', () => {
    const result = insights([creator(LINA, 'Lina', [row()], { stats: every(4, 6) })]);
    expect(AgencyInsightsSchema.parse(result).subscribers?.current.daysRead).toBe(3);
  });
});
