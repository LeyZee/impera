import type { LinkHourReading, LinkHourTotal } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { hoursOfWindow, hoursWithoutRobots, readingWindow, robotShare, storyLinkSilent } from '../link-stats';

const reading = (hour: string, pageviews: number, clicks: number): LinkHourReading => ({
  hour: `2026-11-16T${hour}:00:00.000Z`,
  pageviews,
  clicks,
});
const robots = (hour: string, count: number) => ({ hour: `2026-11-16T${hour}:00:00.000Z`, robots: count });

describe('the hours kept of a redirect link (ADR 0120 § 3)', () => {
  it('removes the robots of each hour and keeps their number beside', () => {
    const totals = hoursWithoutRobots(
      [reading('13', 10, 3), reading('14', 2, 0)],
      [robots('13', 2), robots('14', 1)],
    );
    expect(totals).toEqual([
      { hour: '2026-11-16T13:00:00.000Z', pageviews: 8, clicks: 3, robots: 2 },
      { hour: '2026-11-16T14:00:00.000Z', pageviews: 1, clicks: 0, robots: 1 },
    ]);
  });

  it('never goes below zero, and keeps an hour that only robots visited', () => {
    expect(
      hoursWithoutRobots([reading('13', 1, 0)], [robots('13', 1), robots('13', 1), robots('15', 1)]),
    ).toEqual([
      { hour: '2026-11-16T13:00:00.000Z', pageviews: 0, clicks: 0, robots: 2 },
      { hour: '2026-11-16T15:00:00.000Z', pageviews: 0, clicks: 0, robots: 1 },
    ]);
  });

  it('gives the same sorted rows when a reading is replayed, split or out of order', () => {
    const once = hoursWithoutRobots([reading('13', 4, 1), reading('09', 2, 2)], []);
    const split = hoursWithoutRobots([reading('09', 2, 2), reading('13', 3, 1), reading('13', 1, 0)], []);
    expect(split).toEqual(once);
    expect(once.map((total) => total.hour)).toEqual(['2026-11-16T09:00:00.000Z', '2026-11-16T13:00:00.000Z']);
    expect(hoursWithoutRobots([reading('10', 0, 0)], [])).toEqual([]);
  });

  it('says the part of the visits that were robots', () => {
    expect(robotShare([])).toBe(0);
    expect(robotShare(hoursWithoutRobots([reading('13', 4, 0)], [robots('13', 1)]))).toBe(0.25);
  });
});

describe('a story link gone silent (ADR 0120 § 6)', () => {
  const now = new Date('2026-11-16T12:00:00.000Z');
  const click = (hoursAgo: number): LinkHourTotal => ({
    hour: new Date(now.getTime() - hoursAgo * 3_600_000).toISOString(),
    pageviews: 5,
    clicks: 1,
    robots: 0,
  });
  const habit = [1, 2, 3, 4, 5, 6, 7].map((day) => click(day * 24 + 6));

  it('alerts when the last 24 hours have no click and each of the seven days before had one', () => {
    expect(storyLinkSilent(habit, now)).toBe(true);
  });

  it('stays quiet with one click in the last 24 hours', () => {
    expect(storyLinkSilent([...habit, click(3)], now)).toBe(false);
  });

  it('stays quiet for a link that is new or never had the habit', () => {
    expect(storyLinkSilent([], now)).toBe(false);
    expect(storyLinkSilent(habit.slice(1), now)).toBe(false);
    expect(storyLinkSilent(habit.slice(0, 6), now)).toBe(false);
  });

  it('raises nothing with three days of history: the job reads at least eight days', () => {
    expect(storyLinkSilent(habit.slice(0, 3), now)).toBe(false);
  });
});

describe('the window of one hourly reading (INS-02 lot e2)', () => {
  const now = new Date('2026-11-16T13:20:00Z');

  it('covers the hour under way and the 46 before it', () => {
    const range = readingWindow(now);
    expect(range.from.toISOString()).toBe('2026-11-14T15:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-11-16T14:00:00.000Z');
    expect(hoursOfWindow([], range, now)).toHaveLength(47);
  });

  it('keeps every hour, zero included, and closes the ones a reading follows by ten minutes', () => {
    const range = { from: new Date('2026-11-16T11:00:00Z'), to: new Date('2026-11-16T14:00:00Z') };
    const read = [{ hour: '2026-11-16T12:00:00.000Z', pageviews: 5, clicks: 2, robots: 1 }];
    expect(hoursOfWindow(read, range, now)).toEqual([
      { hour: '2026-11-16T11:00:00.000Z', pageviews: 0, clicks: 0, robots: 0, closed: true },
      { hour: '2026-11-16T12:00:00.000Z', pageviews: 5, clicks: 2, robots: 1, closed: true },
      { hour: '2026-11-16T13:00:00.000Z', pageviews: 0, clicks: 0, robots: 0, closed: false },
    ]);
    // Five minutes after its end an hour is still open: the service may still be counting it.
    const early = hoursOfWindow(read, range, new Date('2026-11-16T13:05:00Z'));
    expect(early.map((hour) => hour.closed)).toEqual([true, false, false]);
  });
});
