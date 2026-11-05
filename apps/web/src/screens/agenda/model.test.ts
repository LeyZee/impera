import { AvailabilitySchema, CreatorTaskSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { agendaOf, live, post, shoot, stretch, WEDNESDAY } from './fixtures';
import { timedSuggestionsOf } from './grid';
import { firstOf, momentOf, planOf, programOf, progressOf, undatedOf, windowsOn } from './model';

/** An invented timed task (ADR 0010). */
const timedTask = (n: number, title: string, startsAt: string, endsAt: string) =>
  CreatorTaskSchema.parse({
    id: `01936f00-0000-7000-8000-0000000009${String(n).padStart(2, '0')}`,
    when: { kind: 'timed', startsAt, endsAt },
    category: 'live',
    title,
    purpose: null,
    shootBrief: null,
    essential: false,
    reminderMinutes: null,
  });

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

  it('keeps a routine from the day it entered her agenda, in her zone, never before (CREA-08)', () => {
    // Created Wednesday 4 at 0 h 30 in Paris (Tuesday 23 h 30 UTC): due Wednesday, not Monday.
    const routine = { ...stretch, createdAt: '2026-11-03T23:30:00.000Z' };
    const agenda = agendaOf({ tasks: [routine] });
    expect(planOf(agenda, '2026-11-02').todo).toEqual([]);
    expect(planOf(agenda, WEDNESDAY).todo.map((item) => item.task.id)).toEqual([stretch.id]);
    expect(planOf(agenda, '2026-11-06').todo.map((item) => item.task.id)).toEqual([stretch.id]);
    // Kept on her phone from before the date was sent: due on its weekdays as before.
    expect(planOf(agendaOf({ tasks: [stretch] }), '2026-11-02').todo).toHaveLength(1);
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
    expect(firstOf(plan)?.task.id).toBe(stretch.id);
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

  it('shows a task past midnight the day after too, from 0 h, ticked and counted on its day (CREA-02)', () => {
    // Thursday 22 h 30 – Friday 1 h 30, Paris.
    const night = timedTask(1, 'Live nocturne', '2026-11-05T21:30:00.000Z', '2026-11-06T00:30:00.000Z');
    const agenda = agendaOf({
      tasks: [night],
      ticks: [{ taskId: night.id, day: '2026-11-05', doneAt: '2026-11-06T00:40:00.000Z' }],
    });
    const thursday = planOf(agenda, '2026-11-05');
    expect(thursday.timed.map((item) => [item.start, item.end, item.carried])).toEqual([
      [22 * 60 + 30, 25 * 60 + 30, false],
    ]);
    const friday = planOf(agenda, '2026-11-06');
    expect(friday.timed.map((item) => [item.start, item.end, item.carried, item.day, item.done])).toEqual([
      [0, 90, true, '2026-11-05', true],
    ]);
    // Counted once, on Thursday; at 0 h 45 on Friday, it is « en cours ».
    expect(progressOf(friday)).toEqual({ done: 0, total: 0 });
    expect(momentOf(friday, 45)).toMatchObject({ kind: 'live', task: night });
    // Ending at midnight sharp, it does not reach the next day.
    const toMidnight = timedTask(2, 'Live tardif', '2026-11-05T21:00:00.000Z', '2026-11-05T23:00:00.000Z');
    expect(planOf(agendaOf({ tasks: [toMidnight] }), '2026-11-06').timed).toEqual([]);
  });

  it('shows the end of a night dispo the day after, from 0 h (CREA-02)', () => {
    // Friday 22 h – 2 h: on Saturday, 0 h – 2 h.
    expect(windowsOn(agendaOf().availabilities, '2026-11-07', 'Europe/Paris')).toEqual([
      expect.objectContaining({ start: 0, end: 2 * 60 }),
    ]);
    const once = [
      AvailabilitySchema.parse({
        id: '01936f00-0000-7000-8000-000000000999',
        when: { kind: 'once', startsAt: '2026-11-03T21:00:00.000Z', endsAt: '2026-11-04T01:00:00.000Z' },
      }),
    ];
    expect(windowsOn(once, '2026-11-04', 'Europe/Paris')).toEqual([
      expect.objectContaining({ start: 0, end: 2 * 60 }),
    ]);
  });

  it('counts the length of a task by its instants on a day of clock change (CREA-05)', () => {
    // 1 h 30 – 3 h 30 on 25/10/2026 (an hour lived twice) and on 28/03/2027 (an hour skipped), Paris.
    const autumn = timedTask(3, 'Automne', '2026-10-24T23:30:00.000Z', '2026-10-25T02:30:00.000Z');
    const spring = timedTask(4, 'Printemps', '2027-03-28T00:30:00.000Z', '2027-03-28T01:30:00.000Z');
    const plan = (task: typeof autumn, day: string) =>
      planOf(agendaOf({ tasks: [task], today: day }), day).timed[0];
    expect(plan(autumn, '2026-10-25')).toMatchObject({ start: 90, end: 210, length: 3 * 3_600_000 });
    expect(plan(spring, '2027-03-28')).toMatchObject({ start: 90, end: 210, length: 3_600_000 });
  });

  it('starts with a task of the day, else one whose time is over; never one still to come (CREA-21)', () => {
    const early = timedTask(
      5,
      'Rendez-vous photographe',
      '2026-11-04T11:00:00.000Z',
      '2026-11-04T12:00:00.000Z',
    );
    const later = timedTask(6, 'Live du soir', '2026-11-04T20:00:00.000Z', '2026-11-04T21:00:00.000Z');
    const plan = planOf(agendaOf({ tasks: [early, later] }), WEDNESDAY);
    expect(firstOf(plan, 10 * 60)).toBeNull();
    expect(firstOf(plan, 18 * 60)).toEqual({ task: early, late: true });
    expect(firstOf(plan, null)).toBeNull();
  });

  it('puts a suggestion at its hour in the program, splitting the free time (CREA-22)', () => {
    const plan = planOf(agendaOf({ tasks: [] }), WEDNESDAY);
    const rows = programOf(plan, null, timedSuggestionsOf(plan, 'Europe/Paris'));
    expect(
      rows.map((row) =>
        row.kind === 'proposed'
          ? `proposé ${row.at.suggestion.title}`
          : row.kind === 'free'
            ? `libre ${String(row.start)}-${String(row.end)}`
            : row.kind,
      ),
    ).toEqual(['libre 480-1020', 'proposé Répondre aux commentaires', 'libre 1080-1440']);
  });
});
