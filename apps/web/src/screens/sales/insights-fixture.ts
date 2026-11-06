import type { CreatorFanInsights } from '@impera/contracts';

/** An invented base (ADR 0010): the shares of the screen's tests and captures, never a real creator's. */
export const DEMO_INSIGHTS: CreatorFanInsights = {
  asOf: '2026-11-05T23:00:00.000Z',
  fans: { total: 310, newLast30Days: 50, wroteLast7Days: 90 },
  age: {
    status: 'enough',
    aboutFans: 140,
    cases: [
      { key: '18_24', share: 14 },
      { key: '25_34', share: 38 },
      { key: '35_44', share: 27 },
      { key: '45_54', share: 15 },
      { key: '55_plus', share: 6 },
    ],
    averageAge: 34,
  },
  place: {
    status: 'enough',
    aboutFans: 110,
    cases: [
      { key: 'ile_de_france', share: 29 },
      { key: 'auvergne_rhone_alpes', share: 21 },
      { key: 'provence_alpes_cote_d_azur', share: 14 },
      { key: 'belgium', share: 9 },
      { key: 'occitanie', share: 8 },
      { key: 'other', share: 19 },
    ],
  },
  job: {
    status: 'enough',
    aboutFans: 90,
    cases: [
      { key: 'building', share: 22 },
      { key: 'health', share: 17 },
      { key: 'engineering', share: 15 },
      { key: 'transport', share: 12 },
      { key: 'self_employed', share: 10 },
      { key: 'other', share: 24 },
    ],
  },
  situation: { status: 'too_few' },
  spending: {
    status: 'enough',
    payingShare: 41,
    averageBasketMinor: 3850,
    cases: [
      { key: 'none', share: 59 },
      { key: 'under_20', share: 12 },
      { key: '20_100', share: 17 },
      { key: '100_500', share: 9 },
      { key: 'over_500', share: 3 },
    ],
  },
  activity: { status: 'enough', cells: demoCells() },
};

/** More in the evening and at the weekend, the shares summing to 100. */
function demoCells(): { day: number; slot: number; share: number }[] {
  const weights = Array.from({ length: 56 }, (_, i) => {
    const day = Math.floor(i / 8);
    const slot = i % 8;
    return ([0, 1, 1, 2, 3, 4, 7, 8][slot] ?? 0) + (day >= 4 ? 2 : 0) + (slot === 0 ? 1 : 0);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w, i) => ({
    day: Math.floor(i / 8),
    slot: i % 8,
    share: Math.round((w * 100) / total),
  }));
}
