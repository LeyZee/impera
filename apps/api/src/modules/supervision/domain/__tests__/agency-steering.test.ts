import { AgencySteeringSchema, CreatorIdSchema, newId } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { shiftDay } from '../agency-insights';
import {
  agencySteering,
  dailyOf,
  dependencyOf,
  steeringRange,
  trafficOf,
  type SteeringCreatorRead,
  type SteeringFanRead,
} from '../agency-steering';
import type { UsdRate } from '../fan-ranking';

// Everything below is invented (ADR 0010).
const LINA = newId(CreatorIdSchema);
const MAYA = newId(CreatorIdSchema);
const TODAY = '2026-11-21';
const range = steeringRange(TODAY);
const RATE: UsdRate = { day: TODAY, rateMicros: 900_000 };

const creator = (over: Partial<SteeringCreatorRead> = {}): SteeringCreatorRead => ({
  creatorId: LINA,
  name: 'Lina',
  registerSince: '2026-10-01',
  objectiveMinor: null,
  days: [],
  hours: [],
  fans: [],
  wrote: null,
  stats: [],
  ...over,
});

const fan = (over: Partial<SteeringFanRead> = {}): SteeringFanRead => ({
  key: 'a:1',
  fanName: 'Fan inventé',
  conversationId: null,
  currency: 'EUR',
  firstDay: '2026-11-01',
  lastDay: '2026-11-20',
  lifetimeMinor: 10_000,
  windowMinor: 10_000,
  windowPurchases: 1,
  previousPurchases: 0,
  withheld: false,
  ...over,
});

describe('steeringRange', () => {
  it('reads 30 days ending today, the 30 before, and the month', () => {
    expect(range).toMatchObject({
      today: TODAY,
      from: '2026-10-23',
      previousFrom: '2026-09-23',
      previousTo: '2026-10-22',
      profileFrom: '2026-10-24',
      monthFrom: '2026-11-01',
      monthDays: 30,
    });
    expect(steeringRange('2026-02-10').monthDays).toBe(28);
  });
});

describe('dailyOf', () => {
  it('divides the month objectives by its days and averages the seven days before today', () => {
    const days = [0, 1, 2, 3, 4, 5, 6, 7].map((back) => ({
      day: shiftDay(TODAY, -back),
      currency: 'EUR' as const,
      grossMinor: back === 0 ? 12_000 : 7_000,
      sales: 2,
    }));
    const daily = dailyOf(
      [creator({ objectiveMinor: 600_000, days }), creator({ creatorId: MAYA, objectiveMinor: 300_000 })],
      range,
      null,
      12,
    );
    expect(daily.targetMinor).toBe(30_000);
    expect(daily.todayMinor).toBe(12_000);
    expect(daily.averageMinor).toBe(7_000);
    expect(daily.days).toHaveLength(30);
    expect(daily.days.at(-1)).toEqual({ day: TODAY, revenueMinor: 12_000 });
  });

  it('has no target without an objective, and converts dollars at the rate', () => {
    const daily = dailyOf(
      [creator({ days: [{ day: TODAY, currency: 'USD', grossMinor: 1_000, sales: 1 }] })],
      range,
      RATE,
      10,
    );
    expect(daily.targetMinor).toBeNull();
    expect(daily.todayMinor).toBeGreaterThan(0);
  });

  it('projects today from the hours of the past days, once there are enough sales', () => {
    // 28 past days, each 50 € before noon and 50 € after: by noon a day is half done.
    const hours = [];
    const days = [];
    for (let back = 1; back <= 28; back += 1) {
      const day = shiftDay(TODAY, -back);
      hours.push({ day, hour: 10, currency: 'EUR' as const, grossMinor: 5_000 });
      hours.push({ day, hour: 20, currency: 'EUR' as const, grossMinor: 5_000 });
      days.push({ day, currency: 'EUR' as const, grossMinor: 10_000, sales: 2 });
    }
    days.push({ day: TODAY, currency: 'EUR' as const, grossMinor: 8_000, sales: 1 });
    const read = creator({ days, hours });
    expect(dailyOf([read], range, null, 12).projectedMinor).toBe(16_000);
    // Too early: nothing usual is done yet.
    expect(dailyOf([read], range, null, 3).projectedMinor).toBeNull();
    // A young register says nothing.
    expect(
      dailyOf([{ ...read, registerSince: shiftDay(TODAY, -3) }], range, null, 12).projectedMinor,
    ).toBeNull();
  });

  it('draws no projection on fewer than 30 sales', () => {
    const days = [{ day: shiftDay(TODAY, -1), currency: 'EUR' as const, grossMinor: 10_000, sales: 5 }];
    const hours = [{ day: shiftDay(TODAY, -1), hour: 10, currency: 'EUR' as const, grossMinor: 10_000 }];
    expect(dailyOf([creator({ days, hours })], range, null, 12).projectedMinor).toBeNull();
  });
});

describe('trafficOf', () => {
  it('counts first purchases in each window and the regular payers among them', () => {
    const traffic = trafficOf(
      [
        creator({
          wrote: { current: 40, previous: 30 },
          fans: [
            fan({ key: 'a:1', firstDay: '2026-11-10', windowPurchases: 3 }),
            fan({ key: 'a:2', firstDay: '2026-11-12', windowPurchases: 1 }),
            fan({ key: 'a:3', firstDay: '2026-10-01', previousPurchases: 2, windowPurchases: 0 }),
            fan({ key: 'a:4', firstDay: '2026-08-01' }),
          ],
        }),
        creator({ creatorId: MAYA, wrote: { current: 2, previous: 0 } }),
      ],
      range,
      null,
    );
    expect(traffic).toMatchObject({
      newSubscribers: null,
      wrote: 42,
      firstPurchase: 2,
      regular: 1,
      previous: { wrote: 30, firstPurchase: 1, regular: 1 },
    });
  });

  it('says nothing of messages when no conversation is read', () => {
    expect(trafficOf([creator()], range, null).wrote).toBeNull();
  });

  it('merges a fan who paid in two currencies, and leaves dollars out without a rate', () => {
    const fans = [
      fan({ key: 'a:1', windowPurchases: 1 }),
      fan({ key: 'a:1', currency: 'USD', windowPurchases: 1 }),
    ];
    expect(trafficOf([creator({ fans })], range, RATE).regular).toBe(1);
    expect(trafficOf([creator({ fans })], range, null).regular).toBe(0);
  });
});

describe('dependencyOf', () => {
  it('splits the window between the biggest fan, the four after him and the rest', () => {
    const spends = [50_000, 20_000, 10_000, 5_000, 5_000, 5_000, 3_000, 2_000];
    const fans = spends.map((windowMinor, i) =>
      fan({ key: `a:${String(i)}`, windowMinor, lifetimeMinor: windowMinor }),
    );
    const dependency = dependencyOf([creator({ fans })], range, null);
    expect(dependency).toMatchObject({
      payingFans: 8,
      totalMinor: 100_000,
      topOneMinor: 50_000,
      nextFourMinor: 40_000,
      restMinor: 10_000,
      fansForEighty: 3,
      medianMinor: 5_000,
    });
  });

  it('lists the biggest payers silent for 21 days or more, never an unnamed one', () => {
    const fans = [
      fan({ key: 'a:1', fanName: 'Gros', lifetimeMinor: 90_000, windowMinor: 0, lastDay: '2026-10-25' }),
      fan({ key: 'a:2', fanName: 'Petit', lifetimeMinor: 5_000, windowMinor: 0, lastDay: '2026-10-01' }),
      fan({ key: 'a:3', fanName: 'Récent', lifetimeMinor: 99_000, lastDay: '2026-11-15' }),
      fan({ key: 'a:4', fanName: null, lifetimeMinor: 80_000, windowMinor: 0, lastDay: '2026-10-01' }),
    ];
    const { lapsed } = dependencyOf([creator({ fans })], range, null);
    expect(lapsed.map((one) => one.fanName)).toEqual(['Gros', 'Petit']);
    expect(lapsed[0]).toMatchObject({ daysSince: 27, spentMinor: 90_000, creatorId: LINA });
  });

  it('never names a fan in care or with an open doubt on his age, yet counts his money (Sécurité, 21/11)', () => {
    const fans = [
      fan({ key: 'a:1', fanName: 'Gros', lifetimeMinor: 90_000, windowMinor: 0, lastDay: '2026-10-25' }),
      fan({
        key: 'a:2',
        fanName: 'Soin',
        lifetimeMinor: 95_000,
        windowMinor: 20_000,
        lastDay: '2026-10-25',
        withheld: true,
      }),
    ];
    const dependency = dependencyOf([creator({ fans })], range, null);
    expect(dependency.lapsed.map((one) => one.fanName)).toEqual(['Gros']);
    expect(dependency.totalMinor).toBe(20_000);
  });

  it('has no median without a payer', () => {
    expect(dependencyOf([creator()], range, null).medianMinor).toBeNull();
  });
});

describe('agencySteering', () => {
  it('answers the contract, and says when dollars are left out', () => {
    const steering = agencySteering({
      creators: [creator({ days: [{ day: TODAY, currency: 'USD', grossMinor: 100, sales: 1 }] })],
      range,
      rate: null,
      timeZone: 'Europe/Paris',
      nowHour: 9.5,
    });
    expect(AgencySteeringSchema.parse(steering)).toEqual(steering);
    expect(steering.dollarsLeftOut).toBe(true);
    expect(steering.registerSince).toBe('2026-10-01');
  });
});
