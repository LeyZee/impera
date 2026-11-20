import { ContentRequestIdSchema, WeekPlanSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { frameId, lineId } from '../ids';
import {
  WEEK_DEFAULTS,
  chooseShootDays,
  daysInWeek,
  deliveryDue,
  mondayOf,
  packWeek,
  weekNeeds,
  weekToPlan,
} from '../plan';

/** Invented weeks only (ADR 0010): a Monday of November 2026 and made-up requests. */
const WEEK = '2026-11-23';
const PARIS = 'Europe/Paris';
const request = (n: number) =>
  ContentRequestIdSchema.parse(`00000000-0000-4000-8000-00000000000${String(n)}`);

describe('what there is to shoot (ADR 0140 § 4)', () => {
  it('asks each script, the feed the stock lacks in turn, and the stories as one line', () => {
    const needs = weekNeeds({
      stock: { feed: 1, stories: 4 },
      scripts: [{ requestId: request(1), name: 'La douche' }],
    });
    expect(needs.map((item) => [item.need, item.label, item.count, item.minutes])).toEqual([
      ['script', 'Script « La douche »', 1, 90],
      ['feed_shoot', 'Une séance pour le feed', 1, 45],
      ['feed_video', 'Une vidéo courte pour le feed', 1, 30],
      ['reveal_story', '3 stories', 3, 30],
    ]);
    expect(needs[0]?.requestId).toBe(request(1));
  });

  it('asks nothing a full stock covers, and never makes up a Relance or an idea', () => {
    const needs = weekNeeds({ stock: { feed: 5, stories: 9 }, scripts: [] });
    expect(needs).toEqual([]);
  });

  it('names a script without its structure plainly', () => {
    expect(
      weekNeeds({ stock: { feed: 3, stories: 7 }, scripts: [{ requestId: request(2), name: null }] })[0]
        ?.label,
    ).toBe('Ton prochain script');
  });
});

describe('her lines laid on her days (ADR 0140 § 5)', () => {
  const needs = weekNeeds({
    stock: { feed: 0, stories: 0 },
    scripts: [
      { requestId: request(1), name: 'Un' },
      { requestId: request(2), name: 'Deux' },
    ],
  });

  it('spreads the week over her days, the scripts first', () => {
    const packed = packWeek(needs, ['2026-11-25', '2026-11-28'], 240);
    const minutes = packed.shootDays.map((day) => day.items.reduce((sum, item) => sum + item.minutes, 0));
    expect(minutes.every((total) => total <= 240)).toBe(true);
    expect(packed.shootDays[0]?.items[0]?.need).toBe('script');
    expect(packed.shootDays[1]?.items[0]?.need).toBe('script');
    // 2 × 90 + 45 + 30 + 45 + 70 = 370 minutes: all of it fits in 480.
    expect(packed.deferred).toEqual([]);
    const stories = packed.shootDays
      .flatMap((day) => day.items)
      .filter((item) => item.need === 'reveal_story');
    expect(stories.reduce((sum, item) => sum + item.count, 0)).toBe(7);
  });

  it('never makes a week heavier than her days: the stories first, then the rest, move to the week after', () => {
    const packed = packWeek(needs, ['2026-11-25'], 240);
    const kept = packed.shootDays[0]?.items ?? [];
    expect(kept.reduce((sum, item) => sum + item.minutes, 0)).toBeLessThanOrEqual(240);
    expect(kept.map((item) => item.need)).toEqual(['script', 'script', 'feed_shoot', 'reveal_story']);
    expect(kept[3]).toMatchObject({ count: 1, label: '1 story', minutes: 10 });
    expect(packed.deferred.map((item) => [item.need, item.count])).toEqual([
      ['feed_video', 1],
      ['feed_shoot', 1],
      ['reveal_story', 6],
    ]);
  });

  it('defers everything when no day is left', () => {
    expect(packWeek(needs, [], 240).deferred).toHaveLength(needs.length);
  });
});

describe('her shooting days (ADR 0140 § 1)', () => {
  it('keeps the weekdays she shot on the week before, as she moved them', () => {
    expect(chooseShootDays(WEEK, ['2026-11-17', '2026-11-21'], new Map([[5, 600]]), 2)).toEqual([
      '2026-11-24',
      '2026-11-28',
    ]);
  });

  it('takes the weekdays of her dispos with the most time, else Wednesday and Saturday', () => {
    expect(
      chooseShootDays(
        WEEK,
        [],
        new Map([
          [1, 60],
          [4, 300],
          [5, 300],
        ]),
        2,
      ),
    ).toEqual(['2026-11-26', '2026-11-27']);
    expect(chooseShootDays(WEEK, [], new Map(), 2)).toEqual(['2026-11-25', '2026-11-28']);
  });

  it('completes a week where she kept fewer days, and never proposes more than asked', () => {
    expect(chooseShootDays(WEEK, ['2026-11-20'], new Map(), 2)).toEqual(['2026-11-25', '2026-11-27']);
    expect(chooseShootDays(WEEK, ['2026-11-17', '2026-11-18', '2026-11-19'], new Map(), 2)).toHaveLength(2);
  });
});

describe('the week’s dates (ADR 0140 § 2 and § 9)', () => {
  it('is due on her Sunday at 23 h, in her zone', () => {
    expect(deliveryDue(WEEK, PARIS).toISOString()).toBe('2026-11-29T22:00:00.000Z');
    expect(deliveryDue(WEEK, 'America/Montreal').toISOString()).toBe('2026-11-30T04:00:00.000Z');
  });

  it('is computed once her Sunday 18 h has passed, for the week after', () => {
    expect(weekToPlan(new Date('2026-11-22T16:59:00Z'), PARIS)).toBeNull();
    expect(weekToPlan(new Date('2026-11-22T17:00:00Z'), PARIS)).toBe(WEEK);
    expect(weekToPlan(new Date('2026-11-21T20:00:00Z'), PARIS)).toBeNull();
    expect(weekToPlan(new Date('2026-11-22T23:30:00Z'), PARIS)).toBeNull();
  });

  it('names a week by its Monday, and keeps her days in it', () => {
    expect(mondayOf('2026-11-27')).toBe(WEEK);
    expect(daysInWeek(WEEK, ['2026-11-23', '2026-11-29'])).toBe(true);
    expect(daysInWeek(WEEK, ['2026-11-30'])).toBe(false);
  });
});

describe('a week the contract takes, with ids a replay finds again (ADR 0140 § 19)', () => {
  it('parses the plan the code builds with the default settings', () => {
    const packed = packWeek(
      weekNeeds({ stock: { feed: 0, stories: 0 }, scripts: [] }),
      ['2026-11-25', '2026-11-28'],
      240,
    );
    expect(() =>
      WeekPlanSchema.parse({
        ...packed,
        dueAt: deliveryDue(WEEK, PARIS).toISOString(),
        stock: { feed: 0, stories: 0 },
        capacityMinutes: WEEK_DEFAULTS.capacityMinutes,
      }),
    ).not.toThrow();
  });

  it('draws the same uuid from the same parts, another from others', () => {
    const one = frameId('c', WEEK, 'shoot_day', '2026-11-25');
    expect(one).toBe(frameId('c', WEEK, 'shoot_day', '2026-11-25'));
    expect(one).not.toBe(frameId('c', WEEK, 'shoot_day', '2026-11-28'));
    expect(one).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(lineId(one, 0)).not.toBe(lineId(one, 1));
  });
});
