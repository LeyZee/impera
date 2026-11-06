import {
  CreateSuggestionBodySchema,
  newId,
  SuggestionIdSchema,
  type AgencySuggestion,
  type CreateSuggestionBody,
  type CreatorTaskWhen,
} from '@impera/contracts';

import { addDays, dayOf, lengthOf, minuteOf } from '@/scheduling/time';
import { whenOf, type TaskDraft } from '@/screens/agenda/draft';
import { whenWords } from '@/screens/agenda/words';

/*
 * Créatrices › Agenda (CR-05 lot c): what the agency proposed for one of her weeks and what she did of it, pure. The
 * agency types in her zone, the server's: a timed suggestion falls at its hour only inside one of her dispos and over
 * none of her tasks, otherwise she places it herself.
 */

const EVENING = 18 * 60;
const HOUR = 60;
const STEP = 30;

/**
 * Where « Proposer une tâche » opens: 18 h to 19 h on the day shown, unless that hour has begun in her zone (it
 * opened on 18 h to 19 h at 18 h 40, Chantier 7, 05/11): then the next half hour, or tomorrow evening once the hour
 * would cross midnight. A day already gone moves to today.
 */
export function proposalSlotOf(
  day: string,
  now: Date,
  zone: string,
): { readonly day: string; readonly start: number; readonly end: number } {
  const today = dayOf(now, zone);
  const shown = day < today ? today : day;
  if (shown > today) return { day: shown, start: EVENING, end: EVENING + HOUR };
  const next = Math.ceil((minuteOf(now, zone) + 1) / STEP) * STEP;
  if (next < EVENING) return { day: today, start: EVENING, end: EVENING + HOUR };
  if (next + HOUR > 24 * 60) return { day: addDays(today, 1), start: EVENING, end: EVENING + HOUR };
  return { day: today, start: next, end: next + HOUR };
}

/** A suggestion's id, drawn once when the form opens: sent again after a lost answer, it adds nothing. */
export const newSuggestionId = (): string => newId(SuggestionIdSchema);

/** The body of `POST /v1/creators/:creatorId/suggestions`. */
export function suggestionBodyOf(draft: TaskDraft, zone: string, id: string): CreateSuggestionBody {
  const purpose = draft.purpose.trim();
  return CreateSuggestionBodySchema.parse({
    id,
    when: whenOf(draft, zone),
    category: draft.category,
    title: draft.title.trim(),
    purpose: purpose === '' ? null : purpose,
  });
}

export type Standing = 'waiting' | 'accepted' | 'done' | 'removed' | 'declined';

/** Where a suggestion stands, as the agency reads it. */
export interface Followed {
  readonly standing: Standing;
  /** The word of its pill. */
  readonly label: string;
  /** What else there is to know, or null. */
  readonly detail: string | null;
}

const sameWhen = (a: CreatorTaskWhen | null, b: CreatorTaskWhen): boolean =>
  a !== null && JSON.stringify(a) === JSON.stringify(b);

const days = (count: number): string => (count === 1 ? '1 jour' : `${String(count)} jours`);

/** When it was asked for, in her words; « Sans heure » when it found no room in her dispos. */
export function askedWhen(suggestion: AgencySuggestion, zone: string): string {
  if (suggestion.when !== null) return whenWords(suggestion.when, zone);
  return suggestion.minutes === null
    ? 'Sans heure : elle la place dans sa semaine'
    : `Sans heure : elle la place dans sa semaine · ${lengthOf(suggestion.minutes * 60_000)}`;
}

/**
 * What became of a suggestion: still to decide, declined (with her reason when she gave one), accepted, done (every
 * day of her routine ticked, or the task ticked), or removed from her agenda since. A task she placed or moved says
 * where it is now.
 */
export function followedOf(suggestion: AgencySuggestion, zone: string): Followed {
  if (suggestion.state === 'suggested') return { standing: 'waiting', label: 'En attente', detail: null };
  if (suggestion.state === 'declined')
    return {
      standing: 'declined',
      label: 'Refusée',
      detail: suggestion.reason === null ? 'Sans motif' : `« ${suggestion.reason} »`,
    };
  const task = suggestion.task;
  if (task === null) return { standing: 'accepted', label: 'Acceptée', detail: null };
  if (task.removed)
    return {
      standing: 'removed',
      label: 'Retirée',
      detail:
        task.doneDays > 0
          ? `Faite ${days(task.doneDays)}, puis retirée de son agenda`
          : 'Acceptée, puis retirée de son agenda',
    };
  const moved = sameWhen(suggestion.when, task.when)
    ? null
    : `${suggestion.when === null ? 'Placée' : 'Déplacée'} : ${whenWords(task.when, zone)}`;
  if (task.when.kind === 'routine') {
    const due = task.when.weekdays.length;
    const done = Math.min(task.doneDays, due);
    const progress = `${String(done)} sur ${String(due)} cette semaine`;
    return {
      standing: done >= due ? 'done' : 'accepted',
      label: done >= due ? 'Faite' : 'Acceptée',
      detail: moved === null ? progress : `${progress} · ${moved}`,
    };
  }
  return task.doneDays > 0
    ? { standing: 'done', label: 'Faite', detail: moved }
    : { standing: 'accepted', label: 'Acceptée', detail: moved ?? 'Pas encore cochée' };
}

/** The three groups of the week, in the order she answers: still to decide, accepted (done ones included), declined. */
export function groupsOf(items: readonly AgencySuggestion[]): {
  waiting: AgencySuggestion[];
  accepted: AgencySuggestion[];
  declined: AgencySuggestion[];
} {
  return {
    waiting: items.filter((one) => one.state === 'suggested'),
    accepted: items.filter((one) => one.state === 'accepted'),
    declined: items.filter((one) => one.state === 'declined'),
  };
}

/** « 4 proposées · 2 acceptées · 1 faite · 1 refusée », only the counts there are. */
export function summaryOf(items: readonly AgencySuggestion[], zone: string): string {
  const count = (n: number, one: string, many: string): string | null =>
    n === 0 ? null : `${String(n)} ${n === 1 ? one : many}`;
  const followed = items.map((one) => followedOf(one, zone).standing);
  return [
    count(items.length, 'proposée', 'proposées'),
    count(items.filter((one) => one.state === 'accepted').length, 'acceptée', 'acceptées'),
    count(followed.filter((one) => one === 'done').length, 'faite', 'faites'),
    count(items.filter((one) => one.state === 'declined').length, 'refusée', 'refusées'),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
}
