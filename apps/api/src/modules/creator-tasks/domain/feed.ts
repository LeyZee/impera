import {
  CREATOR_TASK_CATEGORY_EMOJI,
  CREATOR_TASK_CATEGORY_LABELS,
  type CreatorTask,
} from '@impera/contracts';

/**
 * Her agenda in the calendar of her phone (CR-05 lot c2, ADR 0042 § 4): what an event of her calendar link says of a
 * task. The same shape as the `scheduling` feed's events, which writes the file.
 */
export type AgendaFeedEntry = {
  /** Her task's id: a task she moves stays the same event in her calendar. */
  readonly uid: string;
  readonly summary: string;
  readonly description: string;
} & ({ readonly startsAt: Date; readonly endsAt: Date } | { readonly day: string });

/**
 * A task as an event: its category's emoji and its title, then what it is for (or its category). Its shooting sheet
 * stays in Impera: a calendar app keeps its feed on its own servers, so the sheet is only named there. A routine, which
 * is ticked every day it runs and has no date, is not in her calendar: her reminders and Aujourd'hui carry it.
 */
export function feedEntryOf(task: CreatorTask): AgendaFeedEntry | null {
  if (task.when.kind === 'routine') return null;
  const lines = [task.purpose ?? CREATOR_TASK_CATEGORY_LABELS[task.category]];
  if (task.shootBrief !== null) lines.push('Ta fiche de tournage est dans ton agenda Impera.');
  const words = {
    uid: `${task.id}@impera`,
    summary: `${CREATOR_TASK_CATEGORY_EMOJI[task.category]} ${task.title}`,
    description: lines.join('\n'),
  };
  if (task.when.kind === 'day') return { ...words, day: task.when.day };
  return { ...words, startsAt: new Date(task.when.startsAt), endsAt: new Date(task.when.endsAt) };
}
