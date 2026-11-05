import { describe, expect, it } from 'vitest';

import { agendaOf, live, post, shoot, stretch, WEDNESDAY } from './fixtures';
import { firstOf, momentOf, planOf, programOf, progressOf, undatedOf, windowsOn } from './model';

describe('her day (CR-05)', () => {
  it('lays out what is to tick, what is timed, her dispos and the suggestions of the day', () => {
    const plan = planOf(agendaOf(), WEDNESDAY);
    // The essential routine first, then by title.
    expect(plan.todo.map((item) => item.task.id)).toEqual([stretch.id, post.id]);
    expect(plan.timed.map((item) => [item.task.id, item.start, item.end])).toEqual([
      [shoot.id, 14 * 60, 16 * 60],
      [live.id, 21 * 60, 22 * 60],
    ]);
    expect(plan.windows.map((window) => [window.start, window.end])).toEqual([[17 * 60, 20 * 60]]);
    expect(plan.suggestions.map((suggestion) => suggestion.title)).toEqual(['Répondre aux commentaires']);
    expect(undatedOf(agendaOf()).map((suggestion) => suggestion.title)).toEqual(['Séance lingerie']);
  });

  it('keeps her routine on its weekdays only', () => {
    expect(planOf(agendaOf(), '2026-11-03').todo).toEqual([]);
    expect(planOf(agendaOf(), '2026-11-06').todo.map((item) => item.task.id)).toEqual([stretch.id]);
  });

  it('reads a night dispo to the next day, on its weekday', () => {
    expect(windowsOn(agendaOf().availabilities, '2026-11-06', 'Europe/Paris')).toEqual([
      expect.objectContaining({ start: 22 * 60, end: 26 * 60 }),
    ]);
  });

  it('says where the day stands and where to start: the essential task first', () => {
    const agenda = agendaOf({
      ticks: [{ taskId: post.id, day: WEDNESDAY, doneAt: '2026-11-04T08:00:00.000Z' }],
    });
    const plan = planOf(agenda, WEDNESDAY);
    expect(progressOf(plan)).toEqual({ done: 1, total: 4 });
    expect(firstOf(plan)?.id).toBe(stretch.id);
  });

  it('tells the task in progress, or the next one', () => {
    const plan = planOf(agendaOf(), WEDNESDAY);
    expect(momentOf(plan, 15 * 60)).toEqual({ kind: 'live', task: shoot, left: 60 });
    expect(momentOf(plan, 17 * 60)).toEqual({ kind: 'next', task: live, at: 21 * 60, in: 4 * 60 });
    expect(momentOf(plan, 23 * 60)).toEqual({ kind: 'none' });
  });

  it('gives her program with the free times between, open to the agency or not, and now', () => {
    const rows = programOf(planOf(agendaOf(), WEDNESDAY), 12 * 60 + 5);
    expect(
      rows.map((row) =>
        row.kind === 'task'
          ? row.item.task.title
          : row.kind === 'free'
            ? `libre ${String(row.start)}-${String(row.end)}${row.open ? ' ouvert' : ''}`
            : 'maintenant',
      ),
    ).toEqual([
      'maintenant',
      'libre 735-840',
      'Tournage tenue rouge',
      'libre 960-1260 ouvert',
      'Live du soir',
      'libre 1320-1440',
    ]);
  });

  it('starts another day at 8 h, without a line for now', () => {
    const rows = programOf(planOf(agendaOf(), '2026-11-03'), null);
    expect(rows).toEqual([{ kind: 'free', start: 8 * 60, end: 24 * 60, open: false }]);
  });
});
