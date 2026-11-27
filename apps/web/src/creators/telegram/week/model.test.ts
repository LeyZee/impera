import { ChannelPlannedPostSchema, ChannelWeekSchema, type ChannelPlannedPost } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { mondayOf, stateLine, weekToOpen, weekView, weekWords, windowWords } from './model';

/* An invented creator and invented posts: no real person, no real text. */
const CREATOR = '0192f3a0-0000-7000-8000-0000000000c1';
const PARIS = 'Europe/Paris';

const post = (n: number, patch: Partial<ChannelPlannedPost> = {}): ChannelPlannedPost =>
  ChannelPlannedPostSchema.parse({
    id: `0192f3a0-0000-7000-8000-0000000001${String(n).padStart(2, '0')}`,
    creatorId: CREATOR,
    day: '2026-11-30',
    window: { from: 9 * 60, until: 11 * 60 },
    at: '2026-11-30T09:12:00Z',
    role: 'engagement',
    kind: 'text',
    theme: 'chat',
    draft: {
      kind: 'post',
      segments: [{ text: 'Un texte inventé', style: 'plain' }],
      link: null,
      html: 'Un texte inventé',
    },
    mediaId: null,
    why: null,
    repost: false,
    state: 'planned',
    locked: false,
    review: null,
    replacesId: null,
    reason: null,
    sentAt: null,
    ...patch,
  });

describe('her channel’s week, as the review reads it', () => {
  it('opens on this week, or on the coming one from Saturday', () => {
    expect(mondayOf('2026-12-03')).toBe('2026-11-30');
    expect(weekToOpen(new Date('2026-12-03T10:00:00Z'), PARIS)).toBe('2026-11-30');
    expect(weekToOpen(new Date('2026-12-05T18:30:00Z'), PARIS)).toBe('2026-12-07');
    // Sunday 23:30 in Paris is already Monday in UTC+1's eyes only after midnight: still Sunday here.
    expect(weekToOpen(new Date('2026-12-06T22:30:00Z'), PARIS)).toBe('2026-12-07');
  });

  it('says the dates and the window in words', () => {
    expect(weekWords('2026-11-30')).toBe('Du lundi 30 novembre au dimanche 6 décembre');
    expect(weekWords('2026-11-23')).toBe('Du lundi 23 au dimanche 29 novembre');
    expect(windowWords({ from: 18 * 60, until: 21 * 60 })).toBe('18\u00a0h – 21\u00a0h');
  });

  it('puts the answer first: how many posts wait for a read, and the next one', () => {
    const week = ChannelWeekSchema.parse({
      week: '2026-11-30',
      posts: [
        post(1, {
          locked: true,
          review: { action: 'validated', byName: 'Charles', at: '2026-11-29T10:00:00Z' },
        }),
        post(2, { at: '2026-11-30T13:40:00Z', window: { from: 13 * 60, until: 15 * 60 } }),
        post(3, {
          at: '2026-11-30T18:48:00Z',
          kind: 'main',
          theme: 'evening',
          window: { from: 18 * 60, until: 21 * 60 },
        }),
        post(4, {
          state: 'removed',
          review: { action: 'removed', byName: 'Lou', at: '2026-11-29T10:00:00Z' },
        }),
      ],
      reviewed: 1,
      total: 3,
    });
    const view = weekView(week, new Date('2026-11-30T08:00:00Z'), PARIS);
    expect(view.answer).toBe('2 posts à relire');
    expect(view.line).toBe('Le prochain part aujourd’hui à 14:40. Sans relecture, il part quand même.');
    expect(view.toValidate.map((one) => one.id)).toEqual([post(2).id, post(3).id]);
    expect(view.byKind.find((one) => one.kind === 'main')?.count).toBe(1);
    expect(view.days[0]?.today).toBe(true);
    expect(view.days[0]?.waiting).toBe(2);
  });

  it('says who read a post, that it left, or why it did not', () => {
    expect(stateLine(post(1), PARIS)).toEqual({ text: 'Pas encore relu', tone: 'idle' });
    expect(
      stateLine(post(1, { review: { action: 'edited', byName: 'Lou', at: '2026-11-29T10:00:00Z' } }), PARIS)
        .text,
    ).toBe('Modifié par Lou');
    expect(stateLine(post(1, { state: 'sent', sentAt: '2026-11-30T09:12:30Z' }), PARIS)).toEqual({
      text: 'Parti à 10:12',
      tone: 'ok',
    });
    expect(stateLine(post(1, { state: 'skipped', reason: 'Heure dépassée.' }), PARIS)).toEqual({
      text: 'Heure dépassée.',
      tone: 'warn',
    });
  });

  it('says a week not planned yet', () => {
    const view = weekView(
      ChannelWeekSchema.parse({ week: '2026-11-30', posts: [], reviewed: 0, total: 0 }),
      new Date('2026-11-30T08:00:00Z'),
      PARIS,
    );
    expect(view.answer).toBe('Pas encore planifiée');
  });
});
