import { HerShootDaySchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  dayWhen,
  droppedOf,
  dueIn,
  dueWords,
  hasWeek,
  heldByWeek,
  leftToDrop,
  progressOf,
  shootDaysWords,
} from './week-model';

describe('her week, as she reads it', () => {
  it('holds the days of a week still to accept, and lets them go once accepted (choice of 21/11)', () => {
    const day = HerShootDaySchema.parse({
      suggestionId: '0192f3a0-0000-7000-8000-000000000301',
      taskId: null,
      state: 'suggested',
      day: '2026-11-25',
      items: [],
    });
    const week = { week: '2026-11-23', toAccept: true, shootDays: [day], delivery: null };
    expect(heldByWeek(week, day.suggestionId)).toBe(true);
    expect(heldByWeek(week, '0192f3a0-0000-7000-8000-000000000399')).toBe(false);
    expect(heldByWeek({ ...week, toAccept: false }, day.suggestionId)).toBe(false);
    expect(heldByWeek(undefined, day.suggestionId)).toBe(false);
  });

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

  it('says her week in three short words: her days, what arrived, how long she has left', () => {
    const day = (on: string) =>
      HerShootDaySchema.parse({
        suggestionId: '0192f3a0-0000-7000-8000-000000000301',
        taskId: null,
        state: 'suggested',
        day: on,
        items: [],
      });
    expect(shootDaysWords([day('2026-11-25')])).toBe('mer. 25');
    expect(shootDaysWords([day('2026-11-25'), day('2026-11-28')])).toBe('mer. 25 et sam. 28');
    expect(
      droppedOf([
        { need: 'feed_shoot', asked: 2, received: 5 },
        { need: 'reveal_story', asked: 7, received: 3 },
      ]),
    ).toEqual({ done: 5, total: 9 });
    expect(dayWhen('2026-11-25', '2026-11-25')).toBe('Aujourd’hui');
    expect(dayWhen('2026-11-26', '2026-11-25')).toBe('Demain');
    expect(dayWhen('2026-11-28', '2026-11-25')).toBe('Dans 3 jours');
    expect(dayWhen('2026-11-24', '2026-11-25')).toBe('Passé');
    const due = '2026-11-29T22:00:00.000Z';
    const before = Date.parse('2026-11-24T10:00:00.000Z');
    expect(dueIn(due, 'Europe/Paris', '2026-11-24', before)).toBe('dans 5 jours');
    expect(dueIn(due, 'Europe/Paris', '2026-11-28', before)).toBe('demain soir');
    expect(dueIn(due, 'Europe/Paris', '2026-11-29', before)).toBe('ce soir');
    expect(dueIn(due, 'Europe/Paris', '2026-11-30', Date.parse('2026-11-29T22:30:00.000Z'))).toBe('passé');
  });
});
