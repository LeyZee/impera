import { describe, expect, it, vi } from 'vitest';

import { draftWhen } from './AddDialog';
import {
  availabilityBodiesOf,
  defaultStart,
  dispoIds,
  firstMoment,
  reachOf,
  spanOf,
  taskBodyOf,
  taskProblems,
  type TaskDraft,
} from './draft';

const ZONE = 'Europe/Paris';
const draft: TaskDraft = {
  title: '  Tournage  ',
  category: 'shoot',
  kind: 'timed',
  day: '2026-11-04',
  start: 22 * 60,
  end: 1 * 60,
  weekdays: [3],
  purpose: ' ',
  reminderMinutes: 15,
};

describe('« Ajouter » (CR-05)', () => {
  it('previews no day her agenda does not reach: what to choose instead (CREA-14)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
    try {
      expect(draftWhen({ ...draft, kind: 'day', day: '2099-01-01' }, ZONE)).toBe('Choisis le jour');
      expect(draftWhen({ ...draft, kind: 'day' }, ZONE)).toMatch(/4 novembre/u);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads an end at or before the start as the next day, in her zone', () => {
    expect(spanOf('2026-11-04', 22 * 60, 60, ZONE)).toEqual({
      startsAt: '2026-11-04T21:00:00.000Z',
      endsAt: '2026-11-05T00:00:00.000Z',
    });
    expect(spanOf('2026-11-04', 9 * 60, 9 * 60, ZONE).endsAt).toBe('2026-11-05T08:00:00.000Z');
  });

  it('sends a trimmed title, no empty purpose, and a reminder only for a timed task', () => {
    const body = taskBodyOf(draft, ZONE, '01936f00-0000-7000-8000-000000000001');
    expect(body).toMatchObject({ title: 'Tournage', purpose: null, reminderMinutes: 15 });
    expect(taskBodyOf({ ...draft, kind: 'day' }, ZONE, body.id)).toMatchObject({
      when: { kind: 'day', day: '2026-11-04' },
      reminderMinutes: null,
    });
  });

  it('asks for a title, and a day of the week for a routine', () => {
    expect(taskProblems({ ...draft, title: ' ', kind: 'routine', weekdays: [] })).toEqual([
      'title',
      'weekdays',
    ]);
  });

  it('makes one dispo per weekday, with the same ids when it is sent again', () => {
    const idFor = dispoIds();
    const dispo = {
      kind: 'weekly' as const,
      day: '2026-11-04',
      weekdays: [5, 1],
      start: 22 * 60,
      end: 2 * 60,
    };
    const first = availabilityBodiesOf(dispo, ZONE, idFor);
    expect(first.map((body) => body.when)).toEqual([
      { kind: 'weekly', weekday: 1, startMinute: 1320, endMinute: 120 },
      { kind: 'weekly', weekday: 5, startMinute: 1320, endMinute: 120 },
    ]);
    expect(availabilityBodiesOf(dispo, ZONE, idFor).map((body) => body.id)).toEqual(
      first.map((body) => body.id),
    );
  });
});

describe('the moment a form opens on (CREA-09)', () => {
  const week = [
    '2026-11-02',
    '2026-11-03',
    '2026-11-04',
    '2026-11-05',
    '2026-11-06',
    '2026-11-07',
    '2026-11-08',
  ];

  it('starts another day at 10 h, today at the next full hour once 10 h is past', () => {
    expect(defaultStart('2026-11-06', '2026-11-05', 18 * 60 + 40)).toBe(10 * 60);
    expect(defaultStart('2026-11-05', '2026-11-05', 7 * 60)).toBe(10 * 60);
    expect(defaultStart('2026-11-05', '2026-11-05', 18 * 60 + 40)).toBe(19 * 60);
    expect(defaultStart('2026-11-05', '2026-11-05', 18 * 60)).toBe(19 * 60);
    expect(defaultStart('2026-11-05', '2026-11-05', 23 * 60 + 30)).toBe(23 * 60);
  });

  it('places a suggestion on the first day of its week still ahead, never a day gone', () => {
    // Thursday 5 at 18 h 40: today at 19 h, not Monday 2 at 10 h.
    expect(firstMoment(week, '2026-11-05', 18 * 60 + 40)).toEqual({ day: '2026-11-05', start: 19 * 60 });
    // Thursday at 23 h 10: no full hour left, Friday at 10 h.
    expect(firstMoment(week, '2026-11-05', 23 * 60 + 10)).toEqual({ day: '2026-11-06', start: 10 * 60 });
    // A week to come: its Monday at 10 h.
    expect(firstMoment(week, '2026-10-30', 12 * 60)).toEqual({ day: '2026-11-02', start: 10 * 60 });
  });
});

describe('the days a form takes (CREA-14)', () => {
  const now = Date.parse('2026-11-05T12:00:00.000Z');
  const draft = (day: string): TaskDraft => ({
    title: 'Live',
    category: 'live',
    kind: 'day',
    day,
    start: 600,
    end: 660,
    weekdays: [],
    purpose: '',
    reminderMinutes: null,
  });

  it('refuses a day her agenda does not reach, and offers only the days it does', () => {
    expect(taskProblems(draft('2026-11-20'), now)).toEqual([]);
    expect(taskProblems(draft('1900-01-01'), now)).toEqual(['day']);
    expect(taskProblems(draft('9999-12-31'), now)).toEqual(['day']);
    const { min, max } = reachOf(now);
    expect(taskProblems(draft(min), now)).toEqual([]);
    expect(taskProblems(draft(max), now)).toEqual([]);
  });
});
