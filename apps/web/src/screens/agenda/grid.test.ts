import { describe, expect, it } from 'vitest';

import { live, shoot, ZONE } from './fixtures';
import {
  createdSpan,
  lanesOf,
  minuteAt,
  monthDays,
  monthLabel,
  monthOf,
  monthRange,
  movedSpan,
  movedWhen,
} from './grid';

/* Her Semaine and Mois, pure (CR-05 b2), invented (ADR 0010): Paris, November 2026. */

const hours = { first: 7, last: 24 };

describe('the week grid', () => {
  it('puts tasks that overlap side by side, and the others alone', () => {
    const placed = lanesOf([
      { start: 600, end: 720 },
      { start: 660, end: 780 },
      { start: 900, end: 960 },
    ]);
    expect(placed.map(({ lane, lanes }) => [lane, lanes])).toEqual([
      [0, 2],
      [1, 2],
      [0, 1],
    ]);
  });

  it('reads the minute under the pointer on a quarter, inside the grid', () => {
    const column = { top: 100, height: 17 * 52 };
    expect(minuteAt(100, column, hours)).toBe(7 * 60);
    expect(minuteAt(100 + 52 * 3 + 20, column, hours)).toBe(10 * 60 + 30);
    expect(minuteAt(5000, column, hours)).toBe(24 * 60);
  });

  it('creates 30 minutes at least, upwards or downwards, and never past midnight', () => {
    expect(createdSpan(600, 600, hours)).toEqual({ start: 600, end: 630 });
    expect(createdSpan(720, 600, hours)).toEqual({ start: 600, end: 720 });
    expect(createdSpan(1440, 1440, hours)).toEqual({ start: 1410, end: 1440 });
  });

  it('moves a task with its length, inside the grid', () => {
    expect(movedSpan({ start: 840, end: 960 }, 600, hours)).toEqual({ start: 600, end: 720 });
    expect(movedSpan({ start: 840, end: 960 }, 1400, hours)).toEqual({ start: 1320, end: 1440 });
    expect(movedSpan({ start: 840, end: 960 }, 200, hours)).toEqual({ start: 420, end: 540 });
  });

  it('sends the move in her zone, nothing when the task did not move', () => {
    expect(movedWhen(shoot, '2026-11-05', { start: 600, end: 720 }, ZONE)).toEqual({
      kind: 'timed',
      startsAt: '2026-11-05T09:00:00.000Z',
      endsAt: '2026-11-05T11:00:00.000Z',
    });
    expect(movedWhen(shoot, '2026-11-04', { start: 840, end: 960 }, ZONE)).toBeNull();
    // Ending at midnight: the end is the next day's 0 h.
    expect(movedWhen(live, '2026-11-04', { start: 1380, end: 1440 }, ZONE)).toEqual({
      kind: 'timed',
      startsAt: '2026-11-04T22:00:00.000Z',
      endsAt: '2026-11-04T23:00:00.000Z',
    });
  });
});

describe('the month', () => {
  it('shows whole weeks, Monday to Sunday, within the 42 days the server answers', () => {
    const days = monthDays('2026-11-18');
    expect(days[0]).toBe('2026-10-26');
    expect(days.at(-1)).toBe('2026-12-06');
    expect(days).toHaveLength(42);
    expect(monthDays('2027-02-10')).toHaveLength(28);
    expect(monthRange('2026-11-18')).toEqual({ from: '2026-10-26', to: '2026-12-06' });
  });

  it('moves month by month and names it', () => {
    expect(monthOf('2026-11-18', 1)).toBe('2026-12-01');
    expect(monthOf('2026-01-31', -1)).toBe('2025-12-01');
    expect(monthLabel('2026-11-18')).toBe('Novembre 2026');
  });
});
