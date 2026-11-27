import type { AgencyInsights } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { AGENCY_WEEK } from './fixture';
import {
  cumulative,
  dependencyLine,
  detailLine,
  moneyThirds,
  paceOf,
  refundsLine,
  todayAndYesterday,
  trafficLine,
} from './owner';
import { STEERING } from './steering-fixture';

type Objectives = NonNullable<AgencyInsights['objectives']>;

/** An invented month: 30 days, the 15th today. Tests only. */
const month = (over: Partial<Objectives>): Objectives => ({
  month: '2026-11-01',
  daysGone: 15,
  days: 30,
  creators: [],
  objectiveMinor: 1_000_000,
  revenueMinor: 520_000,
  projectedMinor: 1_040_000,
  ...over,
});

describe('the owner’s money band (maquette du 27/11)', () => {
  it('draws the running total', () => {
    expect(cumulative([3, 0, 5, 2])).toEqual([3, 3, 8, 10]);
    expect(cumulative([])).toEqual([]);
  });

  it('says no pace without an objective, never « en retard » against nothing', () => {
    expect(paceOf(null)).toBeNull();
    expect(paceOf(month({ objectiveMinor: null }))).toBeNull();
  });

  it('reads the month on its way, its mark where it should be by now', () => {
    const pace = paceOf(month({}));
    expect(pace).toMatchObject({ fill: 52, mark: 50, tone: 'up', word: 'Dans les clous' });
    expect(paceOf(month({ projectedMinor: 900_000 }))).toMatchObject({ tone: 'down', word: 'En retard' });
  });

  it('never fills the bar past its end, and drops the mark once the month is over', () => {
    expect(paceOf(month({ revenueMinor: 1_300_000, projectedMinor: 2_600_000 }))?.fill).toBe(100);
    expect(paceOf(month({ daysGone: 30, projectedMinor: null, revenueMinor: 1_020_000 }))).toMatchObject({
      mark: null,
      word: 'Objectif atteint',
      tone: 'up',
    });
    expect(paceOf(month({ daysGone: 30, projectedMinor: null, revenueMinor: 800_000 }))).toMatchObject({
      word: 'Objectif manqué',
      tone: 'down',
    });
  });

  it('splits the revenue in three parts that add up to it', () => {
    const current = AGENCY_WEEK.totals.current;
    const thirds = moneyThirds(current, true);
    expect(thirds.map((third) => third.label)).toEqual(['Agence', 'Créatrices', 'Plateforme et TVA']);
    expect(thirds.reduce((sum, third) => sum + third.cents, 0)).toBe(current.revenueMinor);
    expect(moneyThirds(current, false)[1]?.label).toBe('Créatrice');
  });

  it('reads today and yesterday in the steering’s last days', () => {
    expect(todayAndYesterday(undefined)).toBeNull();
    expect(todayAndYesterday(STEERING)).toEqual({ today: 18_450, yesterday: 30_600 });
  });
});

describe('the answers of « Pour creuser »', () => {
  it('says the traffic in buyers, and nothing when nobody bought', () => {
    expect(trafficLine(STEERING.traffic)).toBe('38 premiers achats sur 30 jours, dont 14 déjà revenus');
    expect(trafficLine({ ...STEERING.traffic, firstPurchase: 0 })).toBeNull();
    expect(trafficLine({ ...STEERING.traffic, firstPurchase: 1, regular: 0 })).toBe(
      '1 premier achat sur 30 jours',
    );
  });

  it('says what the money hangs on, and who stopped', () => {
    expect(dependencyLine(STEERING.dependency)).toMatch(/^5 fans font 51 % du chiffre · \d+ ont décroché$/u);
    expect(dependencyLine({ ...STEERING.dependency, payingFans: 1, lapsed: [] })).toBe(
      '1 fan fait tout le chiffre · aucun n’a décroché',
    );
    expect(dependencyLine({ ...STEERING.dependency, totalMinor: 0 })).toBeNull();
  });

  it('says the refunds only when there are some, and the detail in one line', () => {
    expect(refundsLine({ refundList: [] })).toBeNull();
    expect(detailLine(AGENCY_WEEK.totals.current)).toMatch(/^Net 1\s476,80\s€ · 96 ventes$/u);
  });
});
