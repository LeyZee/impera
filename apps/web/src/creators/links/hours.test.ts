import {
  AgencyLinkHourSchema,
  AgencyRedirectLinkSchema,
  type AgencyLinkHour,
  type AgencyRedirectLink,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { changePercent, hoursView, robotShare } from './hours';

/* Invented links and counts only. */
const link = (id: string, name: string, set: object = {}): AgencyRedirectLink =>
  AgencyRedirectLinkSchema.parse({
    id,
    name,
    url: `https://liens.example.test/${name}`,
    destination: '',
    placement: 'story_daily',
    usageNote: '',
    enabled: true,
    attached: true,
    ...set,
  });
const STORY = link('0192f3a0-0000-7000-8000-0000000000e1', 'story');
const CANAL = link('0192f3a0-0000-7000-8000-0000000000e2', 'canal', { placement: 'telegram_channel' });
const LOOSE = link('0192f3a0-0000-7000-8000-0000000000e3', 'libre', { attached: false });
const NOW = new Date('2026-11-26T15:20:00Z');
const hour = (of: AgencyRedirectLink, hoursAgo: number, clicks: number, robots = 0): AgencyLinkHour =>
  AgencyLinkHourSchema.parse({
    linkId: of.id,
    hour: new Date(Date.parse('2026-11-26T15:00:00Z') - hoursAgo * 3_600_000).toISOString(),
    pageviews: clicks * 2,
    clicks,
    robots,
    closed: hoursAgo > 0,
  });

describe('her clicks hour by hour (INS-02 lot e3)', () => {
  it('draws the last 24 hours stacked by place, and sums the day before apart', () => {
    const view = hoursView(
      [hour(STORY, 30, 7), hour(STORY, 23, 2), hour(CANAL, 1, 4, 3), hour(STORY, 0, 1), hour(STORY, 60, 99)],
      [STORY, CANAL, LOOSE],
      NOW,
    );
    expect(view.columns).toHaveLength(24);
    expect(view.columns[0]?.key).toBe('2026-11-25T16:00:00.000Z');
    expect(view.columns[0]?.clicks).toEqual([0, 2, 0, 0]);
    expect(view.columns[22]?.clicks).toEqual([0, 0, 4, 0]);
    expect(view.columns[23]?.open).toBe(true);
    expect(view.columns[22]?.open).toBe(false);
    expect(view.clicks).toBe(7);
    expect(view.clicksBefore).toBe(7);
    expect(view.robots).toBe(3);
    expect(view.placements).toEqual(['story_daily', 'telegram_channel']);
    // Only linked links, in the stack's order of places, whatever their clicks.
    expect(view.links.map((one) => [one.link.name, one.clicks])).toEqual([
      ['story', 3],
      ['canal', 4],
    ]);
  });

  it('leaves out the hours of a link it does not know', () => {
    const stranger = link('0192f3a0-0000-7000-8000-0000000000e9', 'autre');
    expect(hoursView([hour(stranger, 2, 5)], [STORY], NOW).clicks).toBe(0);
  });

  it('compares with the day before only when there was one, and gives the robots share', () => {
    expect(changePercent(15, 10)).toBe(50);
    expect(changePercent(5, 10)).toBe(-50);
    expect(changePercent(5, 0)).toBeNull();
    expect(robotShare(90, 10)).toBe(10);
    expect(robotShare(0, 0)).toBe(0);
  });
});
