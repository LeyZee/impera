import { describe, expect, it } from 'vitest';

import { dayOutcome, streakOf, type DayRecord } from '../streak';

/** A day of hers: `e` essentials done out of `of`, every daily task done when `perfect`. */
const day = (date: string, done: number, of = 2, perfect = false): DayRecord => ({
  day: date,
  essentials: { total: of, done },
  daily: { total: of + 1, done: perfect ? of + 1 : done },
});

describe('her day (ADR 0042 § 3)', () => {
  it('is « réussie » with every essential done, « parfaite » with every daily task', () => {
    expect(dayOutcome(day('2026-11-03', 2))).toBe('success');
    expect(dayOutcome(day('2026-11-03', 2, 2, true))).toBe('perfect');
    expect(dayOutcome(day('2026-11-03', 1))).toBe('missed');
    expect(dayOutcome(day('2026-11-03', 0, 0))).toBe('empty');
  });
});

describe('her streak (ADR 0042 § 3)', () => {
  const today = '2026-11-10';

  it('counts the « réussies » in a row, today once it is', () => {
    const run = [day('2026-11-07', 2), day('2026-11-08', 2, 2, true), day('2026-11-09', 2)];
    expect(streakOf(run, today).days).toBe(3);
    expect(streakOf([...run, day(today, 2)], today).days).toBe(4);
  });

  it('never breaks on today while it lasts: an essential left only puts it at risk', () => {
    const streak = streakOf([day('2026-11-09', 2), day(today, 1)], today);
    expect(streak).toMatchObject({ days: 1, atRisk: true });
    expect(streakOf([day(today, 1)], today).atRisk).toBe(false);
  });

  it('forgives one missed day with the joker, and breaks on the second', () => {
    const once = [day('2026-11-06', 2), day('2026-11-07', 2), day('2026-11-08', 0), day('2026-11-09', 2)];
    expect(streakOf(once, today)).toMatchObject({ days: 3, jokerUsed: true });
    const twice = [
      day('2026-11-05', 2),
      day('2026-11-06', 1),
      day('2026-11-07', 2),
      day('2026-11-08', 0),
      day('2026-11-09', 2),
    ];
    expect(streakOf(twice, today)).toMatchObject({ days: 2, jokerUsed: true });
  });

  it('breaks, then starts again from the day after', () => {
    const broke = [
      day('2026-11-04', 2),
      day('2026-11-05', 0),
      day('2026-11-06', 1),
      day('2026-11-08', 2),
      day('2026-11-09', 2),
    ];
    expect(streakOf(broke, today).days).toBe(2);
  });

  it('spends no joker on a missed day with nothing before it to save', () => {
    expect(streakOf([day('2026-11-08', 0), day('2026-11-09', 2)], today)).toMatchObject({
      days: 1,
      jokerUsed: false,
    });
  });

  it('passes over a day with nothing essential, and a day not read at all', () => {
    const gaps = [day('2026-11-06', 2), day('2026-11-07', 0, 0), day('2026-11-09', 2)];
    expect(streakOf(gaps, today).days).toBe(2);
  });

  it('names the last milestone reached and the next one', () => {
    const days = Array.from({ length: 14 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 10, 9 - index)).toISOString().slice(0, 10);
      return day(date, 2);
    });
    expect(streakOf(days, today)).toMatchObject({ days: 14, milestone: 14, next: 30 });
    expect(streakOf(days.slice(0, 6), today)).toMatchObject({ days: 6, milestone: null, next: 7 });
  });
});
