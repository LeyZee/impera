import { owedReveals, TrophyCaseSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  CREATOR_GAIN_KINDS,
  creatorGainsOf,
  creatorTrophyCaseOf,
  deliveryOutcome,
  deliveryStreakOf,
  type CreatorFacts,
  type GameRequest,
} from '../creator-game';

const request = (dueOn: string, over: Partial<GameRequest> = {}): GameRequest => ({
  dueOn,
  state: 'open',
  decidedOn: null,
  arrivedOn: null,
  ...over,
});

const facts = (over: Partial<CreatorFacts> = {}): CreatorFacts => ({
  dayStreak: { current: 0, best: 0 },
  perfectDay: false,
  requests: [],
  today: '2026-11-14',
  firstDrop: false,
  firstScript: false,
  fullStock: null,
  hitContent: null,
  ...over,
});

describe('deliveryOutcome (ADR 0107 § 2)', () => {
  const today = '2026-11-14';
  it('is on time when a drop arrived by the end of the due day, late after', () => {
    expect(deliveryOutcome(request('2026-11-10', { arrivedOn: '2026-11-10' }), today)).toBe('on_time');
    expect(deliveryOutcome(request('2026-11-10', { arrivedOn: '2026-11-08' }), today)).toBe('on_time');
    expect(deliveryOutcome(request('2026-11-10', { arrivedOn: '2026-11-11' }), today)).toBe('late');
  });

  it('is missed once the due day is over with nothing, pending until then', () => {
    expect(deliveryOutcome(request('2026-11-13'), today)).toBe('missed');
    expect(deliveryOutcome(request('2026-11-14'), today)).toBe('pending');
    expect(deliveryOutcome(request('2026-11-20'), today)).toBe('pending');
  });

  it('never costs her a refusal before the due day ends, nor an agency cancellation', () => {
    expect(deliveryOutcome(request('2026-11-10', { state: 'refused', decidedOn: '2026-11-10' }), today)).toBe(
      'neutral',
    );
    expect(
      deliveryOutcome(request('2026-11-10', { state: 'cancelled', decidedOn: '2026-11-12' }), today),
    ).toBe('neutral');
  });

  it('counts a refusal after the due day as the missed delivery it already was', () => {
    expect(deliveryOutcome(request('2026-11-10', { state: 'refused', decidedOn: '2026-11-11' }), today)).toBe(
      'missed',
    );
  });
});

describe('deliveryStreakOf (ADR 0107 § 2)', () => {
  const today = '2026-11-20';
  it('counts on-time deliveries in a row in due order, a late or missed one resets, neutral ones skip', () => {
    const streak = deliveryStreakOf(
      [
        request('2026-11-05', { arrivedOn: '2026-11-04' }),
        request('2026-11-01', { arrivedOn: '2026-11-01' }),
        request('2026-11-03', { arrivedOn: '2026-11-02' }),
        request('2026-11-07', { arrivedOn: '2026-11-09' }),
        request('2026-11-10', { arrivedOn: '2026-11-10' }),
        request('2026-11-11', { state: 'refused', decidedOn: '2026-11-09' }),
        request('2026-11-12', { arrivedOn: '2026-11-12' }),
        request('2026-11-25'),
      ],
      today,
    );
    expect(streak).toEqual({ current: 2, best: 3, anyOnTime: true });
  });

  it('starts at zero with nothing asked', () => {
    expect(deliveryStreakOf([], today)).toEqual({ current: 0, best: 0, anyOnTime: false });
  });
});

describe('creatorGainsOf (ADR 0107 § 1 and § 3)', () => {
  it('gives nothing for nothing', () => {
    expect(creatorGainsOf(facts()).gains).toEqual([]);
  });

  it('gives each streak medal her best day streak reached, kept when the streak falls back', () => {
    const { gains, streaks } = creatorGainsOf(facts({ dayStreak: { current: 2, best: 31 } }));
    expect(gains).toEqual(['day_streak_7', 'day_streak_14', 'day_streak_30']);
    expect(streaks.day).toEqual({ current: 2, best: 31 });
  });

  it('gives the delivery trophies from the facts of her drops and requests', () => {
    const requests = Array.from({ length: 5 }, (_, index) =>
      request(`2026-11-0${String(index + 1)}`, { arrivedOn: `2026-11-0${String(index + 1)}` }),
    );
    const { gains, streaks } = creatorGainsOf(
      facts({ requests, firstDrop: true, firstScript: true, perfectDay: true }),
    );
    expect(gains).toEqual([
      'first_drop',
      'first_on_time_delivery',
      'delivery_streak_5',
      'perfect_day',
      'first_script',
    ]);
    expect(streaks.delivery).toEqual({ current: 5, best: 5 });
  });

  it('never gives a trophy whose signal does not exist yet', () => {
    expect(creatorGainsOf(facts({ fullStock: null, hitContent: null })).gains).toEqual([]);
    expect(creatorGainsOf(facts({ fullStock: true, hitContent: true })).gains).toEqual([
      'full_stock',
      'hit_content',
    ]);
  });
});

describe('creatorTrophyCaseOf (ADR 0107 § 10)', () => {
  const streaks = { day: { current: 9, best: 9 }, delivery: { current: 3, best: 4 } };

  it('lists every medal and trophy of hers, in the shape of the shared case, with no level', () => {
    const empty = creatorTrophyCaseOf([], streaks);
    expect(TrophyCaseSchema.safeParse(empty).success).toBe(true);
    expect(empty.items.map((item) => item.kind)).toEqual([...CREATOR_GAIN_KINDS]);
    expect(empty.level).toBeNull();
    expect(empty.streaks).toEqual([
      { kind: 'day', current: 9, best: 9 },
      { kind: 'delivery', current: 3, best: 4 },
    ]);
  });

  it('draws medals, delivery streaks and trophies, with progress only on what is still ahead and counted', () => {
    const trophyCase = creatorTrophyCaseOf(
      [{ kind: 'day_streak_7', earnedAt: new Date('2026-11-10T08:00:00Z'), revealedAt: null }],
      streaks,
    );
    const item = (kind: string) => trophyCase.items.find((one) => one.kind === kind);
    expect(item('day_streak_7')).toMatchObject({ family: 'medal', progress: null });
    expect(item('day_streak_14')).toMatchObject({
      family: 'medal',
      progress: { current: 9, target: 14, unit: 'day' },
    });
    expect(item('delivery_streak_5')).toMatchObject({
      family: 'streak',
      progress: { current: 3, target: 5, unit: 'delivery' },
    });
    expect(item('full_stock')).toMatchObject({ family: 'trophy', progress: null, earnedAt: null });
    expect(owedReveals(trophyCase).map((one) => one.kind)).toEqual(['day_streak_7']);
  });

  it('never shows a best day streak under the streak of now', () => {
    const trophyCase = creatorTrophyCaseOf([], {
      day: { current: 12, best: 10 },
      delivery: { current: 0, best: 0 },
    });
    expect(trophyCase.streaks[0]).toEqual({ kind: 'day', current: 12, best: 12 });
  });
});
