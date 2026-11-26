import { describe, expect, it } from 'vitest';

import { creatorProgress, type ProgressDeps } from '../her-week';

/* An invented creator (ADR 0010), Wednesday 4 November 2026 in Paris: her week starts Monday the 2nd. */
const CREATOR = '0192f3a0-0000-7000-8000-0000000000c1';
const OWNER = 'u-owner';
const WEDNESDAY = new Date('2026-11-04T10:00:00.000Z');
const id = (n: number): string => `0192f3a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

function deps(over: { frames?: boolean; arrived?: number } = {}): ProgressDeps {
  return {
    agenda: {
      teamWeek: () =>
        Promise.resolve({
          creatorId: CREATOR,
          timeZone: 'Europe/Paris',
          today: '2026-11-04',
          frames:
            over.frames === false
              ? []
              : [
                  {
                    suggestionId: id(1),
                    role: 'shoot_day',
                    state: 'accepted',
                    taskId: id(11),
                    day: '2026-11-03',
                    lines: [
                      {
                        id: id(21),
                        need: 'feed_shoot',
                        label: 'Séance lingerie',
                        sheet: null,
                        count: 1,
                        requestId: null,
                        done: true,
                      },
                      {
                        id: id(22),
                        need: 'feed_video',
                        label: 'Trois vidéos',
                        sheet: null,
                        count: 3,
                        requestId: null,
                        done: false,
                      },
                    ],
                  },
                  {
                    suggestionId: id(2),
                    role: 'shoot_day',
                    state: 'declined',
                    taskId: null,
                    day: '2026-11-05',
                    lines: [
                      {
                        id: id(23),
                        need: 'feed_shoot',
                        label: 'Séance bain',
                        sheet: null,
                        count: 1,
                        requestId: null,
                        done: false,
                      },
                    ],
                  },
                  {
                    suggestionId: id(3),
                    role: 'delivery',
                    state: 'accepted',
                    taskId: id(13),
                    day: '2026-11-08',
                    lines: [],
                  },
                ],
        }),
    },
    facts: {
      teamArrivals: () =>
        Promise.resolve({
          byCategory: { feed_shoot: over.arrived ?? 1, feed_video: 1 },
          answered: new Set<string>(),
        }),
    },
    days: {
      teamDays: () =>
        Promise.resolve({
          today: '2026-11-04',
          days: new Map([
            ['2026-11-02', { reveal_story: 1, reveal_video: 1, insta_cta_story: 1, insta_stories: 2 }],
            ['2026-11-04', { reveal_story: 1 }],
          ]),
        }),
    },
  };
}

describe('« Où elle en est » (trous béants n° 11)', () => {
  it('reads her seven days from her Monday, the essentials apart, and nothing yet after today', async () => {
    const progress = await creatorProgress(deps(), CREATOR, OWNER, '2026-11-02', WEDNESDAY);
    expect(progress.days.map((day) => day.day)).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
    ]);
    const [monday, tuesday, wednesday, thursday] = progress.days;
    expect(monday).toMatchObject({ essentialsDone: 3, essentialsAsked: 3, done: 5, ahead: false });
    expect(tuesday).toMatchObject({ essentialsDone: 0, done: 0, ahead: false });
    expect(wednesday).toMatchObject({ essentialsDone: 1, ahead: false });
    expect(thursday?.ahead).toBe(true);
    expect(monday?.asked).toBeGreaterThan(monday?.essentialsAsked ?? 0);
  });

  it('counts the lines shot of the days she kept, never those of a day she declined', async () => {
    const progress = await creatorProgress(deps(), CREATOR, OWNER, '2026-11-02', WEDNESDAY);
    expect(progress.shoot).toEqual({ done: 1, asked: 2 });
    expect(progress.delivery?.lines).toEqual([
      { need: 'feed_shoot', asked: 1, received: 1 },
      // A session asks its Mass DM too, as her own « Livrer ma semaine » reads it.
      { need: 'mass_dm', asked: 1, received: 0 },
      { need: 'feed_video', asked: 3, received: 1 },
    ]);
    expect(progress.delivery?.delivered).toBe(false);
  });

  it('says nothing of a week that was never validated', async () => {
    const progress = await creatorProgress(deps({ frames: false }), CREATOR, OWNER, '2026-11-02', WEDNESDAY);
    expect(progress.shoot).toBeNull();
    expect(progress.delivery).toBeNull();
    expect(progress.days).toHaveLength(7);
  });
});
