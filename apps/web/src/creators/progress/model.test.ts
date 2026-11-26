import { CreatorProgressSchema, type CreatorProgress } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { progressOf } from './model';

/* An invented week (ADR 0010): Wednesday 4 November 2026, her Monday the 2nd. */
const day = (n: number, over: Partial<CreatorProgress['days'][number]> = {}) => ({
  day: `2026-11-0${String(n + 2)}`,
  essentialsDone: 0,
  essentialsAsked: 3,
  done: 0,
  asked: 12,
  ahead: n > 2,
  ...over,
});

const progressWith = (over: Partial<CreatorProgress> = {}): CreatorProgress =>
  CreatorProgressSchema.parse({
    week: '2026-11-02',
    today: '2026-11-04',
    days: [
      day(0, { essentialsDone: 3, done: 5 }),
      day(1, { essentialsDone: 1, done: 1 }),
      day(2, { essentialsDone: 3, done: 3 }),
      day(3),
      day(4),
      day(5),
      day(6),
    ],
    shoot: { done: 3, asked: 5 },
    delivery: {
      suggestionId: '0199f2a0-0000-7000-8000-000000000201',
      taskId: null,
      state: 'accepted',
      dueAt: '2026-11-08T22:00:00.000Z',
      lines: [
        { need: 'feed_shoot', asked: 2, received: 1 },
        { need: 'feed_video', asked: 3, received: 3 },
      ],
      delivered: false,
    },
    ...over,
  });

describe('« Où elle en est » (trous béants n° 11)', () => {
  it('answers first how many days she held her essentials, counting only the days already lived', () => {
    const view = progressOf(progressWith());
    expect(view.line).toBe('L’essentiel tenu 2 jours sur 3.');
    expect(view.days.map((one) => one.held)).toEqual([true, false, true, false, false, false, false]);
    expect(view.days[2]?.today).toBe(true);
    expect(view.days[0]).toMatchObject({ done: 3, asked: 3, extra: 2, weekday: 'lun.' });
    expect(view.days[0]?.words).toBe('lun. : essentiel 3 sur 3, 2 bonus');
    expect(view.days[4]?.words).toBe('ven. : à venir');
  });

  it('says her shooting and her delivery as she reads them, and nothing without a validated week', () => {
    expect(progressOf(progressWith()).rows).toEqual([
      { key: 'shoot', label: 'Tournage', done: 3, asked: 5, percent: 60, words: '3 sur 5 lignes tournées' },
      { key: 'delivery', label: 'Livraison', done: 4, asked: 5, percent: 80, words: '4 sur 5 reçus' },
    ]);
    const empty = progressOf(progressWith({ shoot: null, delivery: null }));
    expect(empty.rows).toEqual([]);
  });

  it('waits before her Monday has come', () => {
    const ahead = progressWith({
      today: '2026-11-01',
      days: progressWith().days.map((one) => ({ ...one, ahead: true })),
    });
    expect(progressOf(ahead).line).toBe('Sa semaine n’a pas commencé.');
  });
});
