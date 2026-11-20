import { HerShootDaySchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { dueWords, hasWeek, leftToDrop, progressOf } from './week-model';

describe('her week, as she reads it', () => {
  it('shows nothing before the agency sent it', () => {
    expect(hasWeek({ week: '2026-11-23', toAccept: false, shootDays: [], delivery: null })).toBe(false);
  });

  it('counts a shooting day’s lines shot', () => {
    const line = { need: 'feed_shoot', label: 'Séance', sheet: null, count: 1 } as const;
    expect(
      progressOf(
        HerShootDaySchema.parse({
          suggestionId: '0192f3a0-0000-7000-8000-000000000301',
          taskId: null,
          state: 'suggested',
          day: '2026-11-25',
          items: [
            { ...line, id: '0192f3a0-0000-7000-8000-000000000401', done: true },
            { ...line, id: '0192f3a0-0000-7000-8000-000000000402', done: false },
          ],
        }),
      ),
    ).toEqual({ done: 1, total: 2 });
  });

  it('says her deadline in her zone, and what is left to drop', () => {
    expect(dueWords('2026-11-29T22:00:00.000Z', 'Europe/Paris')).toMatch(/^À livrer avant dimanche 29.*23/);
    expect(
      leftToDrop([
        { need: 'script', asked: 1, received: 1 },
        { need: 'reveal_story', asked: 7, received: 3 },
      ]),
    ).toEqual([{ need: 'reveal_story', asked: 7, received: 3 }]);
  });
});
