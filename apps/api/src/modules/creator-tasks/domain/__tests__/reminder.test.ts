import { CreatorTaskSchema, type CreatorTask } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { reminderAt, reminderMessage, untilWords, wallClock } from '../reminder';

/* Her reminders (CR-05 lot b3), invented (ADR 0010). Paris is UTC+1 in November. */

const PARIS = 'Europe/Paris';
const START = '2026-11-04T13:00:00.000Z';

const shoot: CreatorTask = CreatorTaskSchema.parse({
  id: '0190f3a0-0000-7000-8000-000000000001',
  when: { kind: 'timed', startsAt: START, endsAt: '2026-11-04T15:00:00.000Z' },
  category: 'shoot',
  title: 'Tournage tenue rouge',
  purpose: null,
  reminderMinutes: 15,
  essential: false,
});

describe('her reminders', () => {
  it('rings her minutes before the start, and not at all without a reminder or an hour', () => {
    expect(reminderAt(shoot)?.toISOString()).toBe('2026-11-04T12:45:00.000Z');
    expect(reminderAt({ ...shoot, reminderMinutes: null })).toBeNull();
    expect(reminderAt({ ...shoot, when: { kind: 'day', day: '2026-11-04' } })).toBeNull();
  });

  it('says what and when, in her zone, and opens her day', () => {
    expect(reminderMessage(shoot, START, PARIS, new Date('2026-11-04T12:45:00.000Z'))).toEqual({
      title: 'Tournage tenue rouge',
      body: 'Dans 15 min · 14 h – 16 h',
      url: '/agenda?jour=2026-11-04',
      tag: `task:${shoot.id}`,
    });
  });

  it('rings nothing for a task moved, removed, started or without a reminder any more', () => {
    const at = new Date('2026-11-04T12:45:00.000Z');
    expect(reminderMessage(shoot, '2026-11-04T09:00:00.000Z', PARIS, at)).toBeNull();
    expect(reminderMessage(null, START, PARIS, at)).toBeNull();
    expect(reminderMessage(shoot, START, PARIS, new Date(START))).toBeNull();
    expect(reminderMessage({ ...shoot, reminderMinutes: null }, START, PARIS, at)).toBeNull();
  });

  it('counts the time left when the job runs late, never less than a minute', () => {
    expect(reminderMessage(shoot, START, PARIS, new Date('2026-11-04T12:55:00.000Z'))?.body).toBe(
      'Dans 5 min · 14 h – 16 h',
    );
    expect(reminderMessage(shoot, START, PARIS, new Date('2026-11-04T12:59:50.000Z'))?.body).toBe(
      'Dans 1 min · 14 h – 16 h',
    );
  });

  it('writes her clock and the time left in French', () => {
    expect(wallClock(new Date('2026-11-04T16:30:00.000Z'), PARIS)).toEqual({
      day: '2026-11-04',
      clock: '17 h 30',
    });
    expect(wallClock(new Date('2026-11-04T23:30:00.000Z'), PARIS).day).toBe('2026-11-05');
    expect([untilWords(15), untilWords(60), untilWords(90), untilWords(125)]).toEqual([
      '15 min',
      '1 h',
      '1 h 30',
      '2 h 05',
    ]);
  });
});
