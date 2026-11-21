import { AgencySteeringSchema, type AgencySteering } from '@impera/contracts';

import { LINA, MAYA } from './fixture';

/** An invented agency's steering (ADR 0010): 30 days around 300 € a day, two creators, five payers gone quiet. Tests only. */
const REVENUES = [
  24_800, 31_200, 36_900, 28_400, 41_500, 33_000, 19_900, 30_400, 35_600, 27_200, 38_800, 44_100, 29_300,
  22_600, 31_900, 36_400, 30_100, 25_700, 39_200, 34_800, 28_900, 42_300, 31_500, 26_400, 33_700, 37_900,
  29_800, 35_100, 30_600, 18_450,
];

const day = (back: number): string =>
  new Date(Date.parse('2026-11-21T00:00:00Z') - back * 86_400_000).toISOString().slice(0, 10);

export const STEERING: AgencySteering = AgencySteeringSchema.parse({
  today: '2026-11-21',
  timeZone: 'Europe/Paris',
  creators: [
    { creatorId: LINA, name: 'Lina Test' },
    { creatorId: MAYA, name: 'Maya Démo' },
  ],
  registerSince: '2026-10-01',
  dollarsLeftOut: false,
  daily: {
    targetMinor: 30_000,
    todayMinor: 18_450,
    projectedMinor: 27_300,
    days: REVENUES.map((revenueMinor, i) => ({ day: day(29 - i), revenueMinor })),
    averageMinor: 31_000,
  },
  traffic: {
    newSubscribers: 1_640,
    wrote: 610,
    firstPurchase: 38,
    regular: 14,
    previous: { newSubscribers: 1_410, wrote: 560, firstPurchase: 41, regular: 12 },
  },
  dependency: {
    payingFans: 52,
    sales: 118,
    totalMinor: 960_000,
    topOneMinor: 210_000,
    nextFourMinor: 280_000,
    restMinor: 470_000,
    fansForEighty: 14,
    medianMinor: 6_500,
    lapsed: [
      {
        creatorId: LINA,
        fanName: 'fan_demo_baleine',
        spentMinor: 184_000,
        lastPurchaseDay: day(26),
        daysSince: 26,
        conversationId: '00000000-0000-4000-8000-00000000c001',
      },
      {
        creatorId: MAYA,
        fanName: 'fan_demo_nuit',
        spentMinor: 62_500,
        lastPurchaseDay: day(33),
        daysSince: 33,
        conversationId: null,
      },
      {
        creatorId: LINA,
        fanName: 'fan_demo_tips',
        spentMinor: 41_000,
        lastPurchaseDay: day(22),
        daysSince: 22,
        conversationId: '00000000-0000-4000-8000-00000000c003',
      },
    ],
  },
});
