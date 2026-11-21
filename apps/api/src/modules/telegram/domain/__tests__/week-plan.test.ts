import { DEFAULT_TELEGRAM_CHANNEL_CONFIG, type ChannelSlot } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { needsRefresh, nextWeekOf, planWeek, type PlanInput } from '../week-plan';

const base: PlanInput = {
  creatorId: '00000000-0000-7000-8000-000000000001',
  week: '2026-11-23',
  timeZone: 'Europe/Paris',
  slots: DEFAULT_TELEGRAM_CHANNEL_CONFIG.slots,
  photoStock: 10,
  hasNewsSource: true,
};

describe('her channel’s week (ADR 0162)', () => {
  it('plans three posts a day by default, each drawn inside its window', () => {
    const plan = planWeek(base);
    expect(plan).toHaveLength(21);
    for (const post of plan) {
      expect(post.minute).toBeGreaterThanOrEqual(post.window.from);
      expect(post.minute).toBeLessThanOrEqual(post.window.until);
    }
    // 09:00 in Paris in winter is 08:00 UTC.
    const first = plan[0];
    expect(first?.day).toBe('2026-11-23');
    expect(first?.at.toISOString()).toBe(
      new Date(Date.UTC(2026, 10, 23, 0, (first?.minute ?? 0) - 60)).toISOString(),
    );
  });

  it('gives the same plan for the same creator and week, another one for another week', () => {
    const minutes = (input: PlanInput): number[] => planWeek(input).map((post) => post.minute);
    expect(minutes(base)).toEqual(minutes(base));
    expect(minutes({ ...base, week: '2026-11-30' })).not.toEqual(minutes(base));
  });

  it('keeps two hours between two posts of a day, even when windows touch', () => {
    const slots: ChannelSlot[] = [
      { minute: 9 * 60, untilMinute: 11 * 60, role: 'engagement', days: [1], enabled: true },
      { minute: 11 * 60, untilMinute: 12 * 60, role: 'engagement', days: [1], enabled: true },
    ];
    const [morning, noon] = planWeek({ ...base, slots });
    expect((noon?.minute ?? 0) - (morning?.minute ?? 0)).toBeGreaterThanOrEqual(120);
  });

  it('makes the evening the main post, one poll a day at most and never on two days in a row', () => {
    const plan = planWeek(base);
    expect(plan.filter((post) => post.role === 'main').every((post) => post.kind === 'main')).toBe(true);
    const pollDays = plan.filter((post) => post.kind === 'poll').map((post) => post.day);
    expect(pollDays).toHaveLength(3);
    expect(new Set(pollDays).size).toBe(3);
    const ranks = pollDays.map((day) => Number(day.slice(8)));
    for (let i = 1; i < ranks.length; i += 1)
      expect((ranks[i] ?? 0) - (ranks[i - 1] ?? 0)).toBeGreaterThan(1);
  });

  it('gives a photo to one engagement post a day while her stock lasts, then texts alone', () => {
    expect(planWeek({ ...base, photoStock: 2 }).filter((post) => post.kind === 'photo')).toHaveLength(2);
    expect(planWeek({ ...base, photoStock: 0 }).some((post) => post.kind === 'photo')).toBe(false);
  });

  it('never plans a « news » post without a real source of her day', () => {
    expect(planWeek({ ...base, hasNewsSource: false }).some((post) => post.theme === 'news')).toBe(false);
  });

  it('talks of her passions twice a week at most', () => {
    expect(planWeek(base).filter((post) => post.theme === 'passion').length).toBeLessThanOrEqual(2);
  });

  it('rewrites the day before only what hangs on the moment and nobody locked', () => {
    expect(needsRefresh('passion', false)).toBe(true);
    expect(needsRefresh('evening', false)).toBe(true);
    expect(needsRefresh('girly', false)).toBe(false);
    expect(needsRefresh('passion', true)).toBe(false);
  });

  it('names the next week by its Monday', () => {
    expect(nextWeekOf('2026-11-21')).toBe('2026-11-23');
    expect(nextWeekOf('2026-11-23')).toBe('2026-11-30');
  });
});
