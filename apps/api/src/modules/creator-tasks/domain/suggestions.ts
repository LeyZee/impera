import { DomainError, SUGGESTION_DECIDED_CONFLICT } from '@impera/contracts';

import { addDays, isoWeekday } from '../../scheduling/pure';

/**
 * A suggestion of the agency or the AI (ADR 0042 § 3): she accepts it, as it is or moved, or declines it, with a
 * reason if she likes. Only an accepted suggestion enters her agenda; a decision is never taken back.
 */
export type SuggestionState = 'suggested' | 'accepted' | 'declined';

export type SuggestionDecision = 'accept' | 'decline';

/** The other gesture on a decided suggestion: refused, her first decision stands. */
export class SuggestionDecidedError extends DomainError {
  constructor(readonly state: Exclude<SuggestionState, 'suggested'>) {
    super(
      SUGGESTION_DECIDED_CONFLICT,
      state === 'accepted' ? 'Tu as déjà accepté cette suggestion' : 'Tu as déjà refusé cette suggestion',
      { details: { state } },
    );
  }
}

/**
 * The state after her gesture. The same gesture again (a double tap, a replay from her phone back online) changes
 * nothing and is no error; the other gesture on a decided suggestion is refused.
 */
export function decide(
  state: SuggestionState,
  decision: SuggestionDecision,
): { state: SuggestionState; changed: boolean } {
  const next: SuggestionState = decision === 'accept' ? 'accepted' : 'declined';
  if (state === 'suggested') return { state: next, changed: true };
  if (state === next) return { state, changed: false };
  throw new SuggestionDecidedError(state);
}

/** Her Monday: the first day of the week `day` is in. */
export const weekOf = (day: string): string => addDays(day, 1 - isoWeekday(day));

/** What makes two suggestions the same task: their category and their title, without case, accents nor extra spaces. */
export interface TaskIdentity {
  readonly category: string;
  readonly title: string;
}

const normalized = (title: string): string =>
  title
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();

export const sameTask = (a: TaskIdentity, b: TaskIdentity): boolean =>
  a.category === b.category && normalized(a.title) === normalized(b.title);

export interface Declined extends TaskIdentity {
  /** The day she declined it, in her time. */
  readonly declinedOn: string;
}

/**
 * Whether a task may be suggested for the week starting `week` (her Monday): not if she declined the same task that
 * week or the week before (ADR 0042, Conséquences). Two weeks later it may come back.
 */
export function maySuggest(candidate: TaskIdentity, week: string, declined: readonly Declined[]): boolean {
  const since = addDays(week, -7);
  const until = addDays(week, 6);
  return !declined.some(
    (decline) => decline.declinedOn >= since && decline.declinedOn <= until && sameTask(decline, candidate),
  );
}
