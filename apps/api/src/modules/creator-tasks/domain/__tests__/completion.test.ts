import { describe, expect, it } from 'vitest';

import { applyTicks, tickTimely, type Tick } from '../completion';
import { dayRecordOf, dayOutcome } from '../streak';

const tick = (taskId: string, day: string, doneAt: string): Tick => ({
  taskId,
  day,
  doneAt: new Date(doneAt),
});

describe('her ticks (ADR 0042 § 8)', () => {
  const first = tick('shoot', '2026-11-03', '2026-11-03T18:00:00.000Z');

  it('counts a double tick once', () => {
    const { ticks, added } = applyTicks(
      [],
      [first, { ...first, doneAt: new Date('2026-11-03T18:00:01.000Z') }],
    );
    expect(ticks).toEqual([first]);
    expect(added).toEqual([first]);
  });

  it('adds nothing when her phone replays ticks the server has, in any order', () => {
    const second = tick('post', '2026-11-03', '2026-11-03T19:00:00.000Z');
    const once = applyTicks([], [second, first]);
    const replay = applyTicks(once.ticks, [first, second]);
    expect(replay.added).toEqual([]);
    expect(replay.ticks).toHaveLength(2);
    expect(applyTicks([], [first, second]).ticks).toEqual(expect.arrayContaining(once.ticks));
  });

  it('keeps the same task on two days apart: a routine task is ticked each day', () => {
    const tomorrow = tick('shoot', '2026-11-04', '2026-11-03T23:30:00.000Z');
    expect(applyTicks([first], [tomorrow]).added).toEqual([tomorrow]);
  });
});

describe('a tick that may count (ADR 0042 § 8)', () => {
  // Paris is UTC+1 after 25/10: 23:30Z on the 3rd is 0 h 30 on the 4th.
  const now = new Date('2026-11-04T10:00:00.000Z');
  const zone = 'Europe/Paris';

  it('takes a tick kept offline up to 48 h, never older nor ahead of the clock', () => {
    expect(tickTimely(tick('post', '2026-11-02', '2026-11-02T10:00:00.000Z'), false, now, zone)).toBe(true);
    expect(tickTimely(tick('post', '2026-11-02', '2026-11-02T09:59:00.000Z'), false, now, zone)).toBe(false);
    expect(tickTimely(tick('post', '2026-11-04', '2026-11-04T10:04:00.000Z'), false, now, zone)).toBe(true);
    expect(tickTimely(tick('post', '2026-11-04', '2026-11-04T10:06:00.000Z'), false, now, zone)).toBe(false);
  });

  it('reads a routine tick on her day when she ticked it, never another one', () => {
    expect(tickTimely(tick('stretch', '2026-11-04', '2026-11-03T23:30:00.000Z'), true, now, zone)).toBe(true);
    expect(tickTimely(tick('stretch', '2026-11-03', '2026-11-03T23:30:00.000Z'), true, now, zone)).toBe(
      false,
    );
    expect(tickTimely(tick('stretch', '2026-11-03', '2026-11-04T09:00:00.000Z'), true, now, zone)).toBe(
      false,
    );
  });

  it('lets a dated task be ticked ahead of its day', () => {
    expect(tickTimely(tick('post', '2026-11-05', '2026-11-04T09:00:00.000Z'), false, now, zone)).toBe(true);
  });
});

describe('her day from her ticks', () => {
  const due = [
    { taskId: 'agency-story', essential: true },
    { taskId: 'agency-post', essential: true },
    { taskId: 'her-walk', essential: false },
  ];

  it('is « réussie » with the agency’s routine done, « parfaite » with hers too', () => {
    const essentials = [
      tick('agency-story', '2026-11-03', '2026-11-03T09:00:00.000Z'),
      tick('agency-post', '2026-11-03', '2026-11-03T10:00:00.000Z'),
    ];
    expect(dayOutcome(dayRecordOf('2026-11-03', due, essentials))).toBe('success');
    const all = [...essentials, tick('her-walk', '2026-11-03', '2026-11-03T11:00:00.000Z')];
    expect(dayOutcome(dayRecordOf('2026-11-03', due, all))).toBe('perfect');
  });

  it('counts a tick for its own day only, whatever the hour it reached the server', () => {
    // Ticked at 0 h 30 in Paris on the 4th for the 3rd: still the 3rd's.
    const late = [
      tick('agency-story', '2026-11-03', '2026-11-03T23:30:00.000Z'),
      tick('agency-post', '2026-11-04', '2026-11-03T23:31:00.000Z'),
    ];
    expect(dayRecordOf('2026-11-03', due, late).essentials).toEqual({ total: 2, done: 1 });
    expect(dayOutcome(dayRecordOf('2026-11-03', [], late))).toBe('empty');
  });
});
