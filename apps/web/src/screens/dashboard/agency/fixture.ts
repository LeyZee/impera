import { AgencyInsightsSchema, type AgencyInsights } from '@impera/contracts';

/** An invented agency's week (ADR 0010): two creators, a chatter, the agent, sales at night. Tests only. */
export const LINA = '00000000-0000-4000-8000-00000000a001';
export const MAYA = '00000000-0000-4000-8000-00000000a002';
const THEO = '00000000-0000-4000-8000-00000000b001';

const days = [
  '2026-10-31',
  '2026-11-01',
  '2026-11-02',
  '2026-11-03',
  '2026-11-04',
  '2026-11-05',
  '2026-11-06',
];

export const AGENCY_WEEK: AgencyInsights = AgencyInsightsSchema.parse({
  period: 'week',
  from: '2026-10-31',
  to: '2026-11-06',
  previousFrom: '2026-10-24',
  previousTo: '2026-10-30',
  creators: [
    { creatorId: LINA, name: 'Lina Test' },
    { creatorId: MAYA, name: 'Maya Démo' },
  ],
  totals: {
    current: {
      revenueMinor: 184_600,
      netMinor: 147_680,
      agencyMinor: 59_072,
      creatorMinor: 88_608,
      sales: 96,
      refunds: 2,
    },
    previous: {
      revenueMinor: 156_000,
      netMinor: 124_800,
      agencyMinor: 49_920,
      creatorMinor: 74_880,
      sales: 81,
      refunds: 4,
    },
  },
  days: days.map((day, i) => ({
    day,
    revenueMinor: 20_000 + i * 2_000,
    byCreator: [
      { creatorId: LINA, revenueMinor: 12_000 + i * 1_500 },
      { creatorId: MAYA, revenueMinor: 8_000 + i * 500 },
    ],
    byKind: [
      { kind: 'subscriptions', revenueMinor: 6_000 },
      { kind: 'ppv', revenueMinor: 10_000 + i * 2_000 },
      { kind: 'tips', revenueMinor: 4_000 },
    ],
  })),
  kinds: [
    { kind: 'subscriptions', revenueMinor: 42_000, sales: 40, previousRevenueMinor: 40_000 },
    { kind: 'ppv', revenueMinor: 112_600, sales: 44, previousRevenueMinor: 90_000 },
    { kind: 'tips', revenueMinor: 28_000, sales: 10, previousRevenueMinor: 26_000 },
    { kind: 'boudoir', revenueMinor: 2_000, sales: 2, previousRevenueMinor: 0 },
  ],
  sellers: [
    {
      seller: { kind: 'member', memberId: THEO, name: 'Théo' },
      revenueMinor: 98_000,
      netMinor: 78_400,
      agencyMinor: 31_360,
      creatorMinor: 47_040,
      sales: 40,
      refunds: 1,
      previousRevenueMinor: 80_000,
    },
    {
      seller: { kind: 'agent' },
      revenueMinor: 44_600,
      netMinor: 35_680,
      agencyMinor: 14_272,
      creatorMinor: 21_408,
      sales: 16,
      refunds: 0,
      previousRevenueMinor: 30_000,
    },
    {
      seller: { kind: 'none' },
      revenueMinor: 42_000,
      netMinor: 33_600,
      agencyMinor: 13_440,
      creatorMinor: 20_160,
      sales: 40,
      refunds: 1,
      previousRevenueMinor: 46_000,
    },
  ],
  byCreator: [
    {
      creatorId: LINA,
      revenueMinor: 115_500,
      netMinor: 92_400,
      agencyMinor: 36_960,
      creatorMinor: 55_440,
      sales: 60,
      refunds: 1,
      previousRevenueMinor: 100_000,
    },
    {
      creatorId: MAYA,
      revenueMinor: 69_100,
      netMinor: 55_280,
      agencyMinor: 22_112,
      creatorMinor: 33_168,
      sales: 36,
      refunds: 1,
      previousRevenueMinor: 56_000,
    },
  ],
  hours: Array.from({ length: 7 }, (_, day) =>
    Array.from({ length: 24 }, (_, hour) =>
      hour >= 20 || hour < 2 ? 1_500 + day * 200 : hour >= 12 ? 300 : 0,
    ),
  ),
  hourly: [],
  fans: { paying: 42, previousPaying: 37, newPaying: 9, topTenShare: 58, averagePerPayingMinor: 4_395 },
  refundsWithoutSale: 0,
  timeZone: 'Europe/Paris',
  dollarsLeftOut: false,
});
