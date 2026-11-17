import { describe, expect, it } from 'vitest';

import { HourStartSchema, LinkHourTotalSchema, LinkPlacementSchema, isStoryPlacement } from './link-stats';

describe('what the link connector reads (ADR 0120 § 3)', () => {
  it('knows the closed list of places, and which ones are a story', () => {
    expect(LinkPlacementSchema.safeParse('bio').success).toBe(false);
    expect(isStoryPlacement('story_highlight')).toBe(true);
    expect(isStoryPlacement('story_daily')).toBe(true);
    expect(isStoryPlacement('telegram_channel')).toBe(false);
  });

  it('takes the start of an hour in UTC and nothing else', () => {
    expect(HourStartSchema.safeParse('2026-11-16T13:00:00.000Z').success).toBe(true);
    expect(HourStartSchema.safeParse('2026-11-16T13:00:00Z').success).toBe(true);
    expect(HourStartSchema.safeParse('2026-11-16T13:20:00.000Z').success).toBe(false);
  });

  it('keeps totals only: a field of a visitor is not part of an hour', () => {
    const hour = { hour: '2026-11-16T13:00:00.000Z', pageviews: 4, clicks: 1, robots: 2 };
    expect(LinkHourTotalSchema.parse({ ...hour, city: 'Lyon' })).toEqual(hour);
    expect(LinkHourTotalSchema.safeParse({ ...hour, clicks: -1 }).success).toBe(false);
  });
});
