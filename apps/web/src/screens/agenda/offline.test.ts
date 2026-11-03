// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { agendaOf, post, WEDNESDAY } from './fixtures';
import { dropGestures, keepGesture, keepSnapshot, pendingGestures, snapshotOf, withPending } from './offline';

afterEach(() => {
  localStorage.clear();
});

const tick = {
  kind: 'tick' as const,
  tick: { taskId: post.id, day: WEDNESDAY, doneAt: '2026-11-04T09:00:00.000Z' },
};
const untick = { kind: 'untick' as const, taskId: post.id, day: WEDNESDAY };

describe('her agenda off the network (ADR 0042 § 8)', () => {
  it('keeps her last read of a range, the latest four only', () => {
    for (const week of ['a', 'b', 'c', 'd', 'e']) keepSnapshot(week, agendaOf({ today: WEDNESDAY }));
    expect(snapshotOf('e')).toEqual(agendaOf());
    expect(snapshotOf('a')).toBeUndefined();
  });

  it('keeps the last gesture on a task and day: a tick then an untick is an untick', () => {
    keepGesture(tick);
    keepGesture(untick);
    expect(pendingGestures()).toEqual([untick]);
  });

  it('shows her ticks not sent yet over the server’s', () => {
    keepGesture(tick);
    expect(withPending(agendaOf(), pendingGestures()).ticks).toEqual([tick.tick]);
    const ticked = agendaOf({ ticks: [tick.tick] });
    expect(withPending(ticked, [untick]).ticks).toEqual([]);
  });

  it('forgets only what was sent: a tap made meanwhile stays', () => {
    keepGesture(tick);
    const sent = pendingGestures();
    keepGesture({ ...tick, tick: { ...tick.tick, day: '2026-11-06' } });
    dropGestures(sent);
    expect(pendingGestures().map((gesture) => (gesture.kind === 'tick' ? gesture.tick.day : null))).toEqual([
      '2026-11-06',
    ]);
  });

  it('ignores what it cannot read instead of failing', () => {
    localStorage.setItem('impera.agenda.pending', '{not json');
    expect(pendingGestures()).toEqual([]);
  });
});
