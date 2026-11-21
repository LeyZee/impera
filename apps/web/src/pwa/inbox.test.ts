import type { NotificationInboxItem } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { byDay, FAMILY_OF, familyCounts, headline } from './inbox';

const item = (
  id: number,
  at: string,
  quiet = false,
  reason: NotificationInboxItem['reason'] = 'reminder',
) => ({
  id: `00000000-0000-4000-8000-00000000000${String(id)}`,
  reason,
  title: `n${String(id)}`,
  url: '/agenda',
  quiet,
  at,
});

describe('« Tes notifications »', () => {
  it('groups by the reader’s day: today, yesterday, then the weekday', () => {
    const days = byDay(
      [
        item(1, '2026-11-21T10:00:00Z'),
        item(2, '2026-11-21T00:30:00Z'),
        item(3, '2026-11-20T22:00:00Z'),
        item(4, '2026-11-18T12:00:00Z'),
      ],
      new Date('2026-11-21T14:00:00Z'),
      'Europe/Paris',
    );
    // 23 h on the 20th in Paris is the 20th; 00 h 30 UTC on the 21st is 1 h 30 in Paris, the 21st.
    expect(days.map((day) => [day.label, day.items.length])).toEqual([
      ['Aujourd’hui', 2],
      ['Hier', 1],
      ['Mercredi 18 novembre', 1],
    ]);
  });

  it('answers first what never rang, else how many this week', () => {
    expect(headline([])).toEqual({ big: 'Rien cette semaine', small: null });
    expect(headline([item(1, '2026-11-21T10:00:00Z')])).toEqual({
      big: '1 cette semaine',
      small: 'elle a sonné',
    });
    expect(headline([item(1, '2026-11-21T10:00:00Z'), item(2, '2026-11-21T10:00:00Z')])).toEqual({
      big: '2 cette semaine',
      small: 'toutes ont sonné',
    });
    expect(headline([item(1, '2026-11-21T10:00:00Z', true), item(2, '2026-11-21T10:00:00Z')])).toEqual({
      big: '1 arrivée sans sonner',
      small: 'sur 2 cette semaine',
    });
  });

  it('counts each family in the legend’s order, money first, the empty ones left out', () => {
    expect(
      familyCounts([
        item(1, '2026-11-21T10:00:00Z', false, 'owner_change'),
        item(2, '2026-11-21T10:00:00Z', false, 'sale'),
        item(3, '2026-11-21T10:00:00Z', false, 'agency_share'),
      ]),
    ).toEqual([
      { family: 'money', count: 2 },
      { family: 'safety', count: 1 },
    ]);
  });

  it('gives every reason a family', () => {
    expect(Object.keys(FAMILY_OF)).toHaveLength(11);
  });
});
