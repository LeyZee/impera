import type { CommissionStatement } from '@impera/contracts';

/*
 * The batch of validations under way (recette COUV-13): they leave one by one, and leaving the page cuts the queue. A
 * mark in this tab's session storage holds the period and the statements not yet sent, so the page read again says
 * what was not validated. Ids only, no amount nor name. Storage may be refused: nothing is said then, nothing breaks.
 */

const KEY = 'impera.payValidationsUnderWay';

interface Queue {
  readonly period: string;
  readonly ids: readonly string[];
}

function write(queue: Queue | null): void {
  try {
    if (queue === null || queue.ids.length === 0) window.sessionStorage.removeItem(KEY);
    else window.sessionStorage.setItem(KEY, JSON.stringify(queue));
  } catch {
    // Storage refused: the page still asks before it is left.
  }
}

function read(): Queue | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || !('period' in parsed) || !('ids' in parsed))
      return null;
    const { period, ids } = parsed;
    if (typeof period !== 'string' || !Array.isArray(ids)) return null;
    return { period, ids: ids.filter((id): id is string => typeof id === 'string') };
  } catch {
    return null;
  }
}

/** The batch about to leave, every statement in it not sent yet. */
export function queueValidations(period: string, ids: readonly string[]): void {
  write({ period, ids });
}

/** One statement of the batch answered (validated, or refused and said on its row). */
export function answeredValidation(id: string): void {
  const queue = read();
  if (queue !== null) write({ ...queue, ids: queue.ids.filter((one) => one !== id) });
}

/** The batch is over: the page says the rest itself. */
export function endValidations(): void {
  write(null);
}

/**
 * The statements of `period` a cut batch left still to validate, read once: the mark is cleared. `null` when no
 * batch of this period was cut.
 */
export function cutValidations(
  period: string,
  statements: readonly { readonly id: string; readonly status: CommissionStatement['status'] }[],
): number | null {
  const queue = read();
  if (queue?.period !== period) return null;
  write(null);
  const left = new Set(queue.ids);
  return statements.filter((one) => left.has(one.id) && one.status === 'draft').length;
}

/** « 1 relevé n’a pas été validé » after a cut batch. */
export const cutText = (count: number): string =>
  count > 1
    ? `${String(count)} relevés n’ont pas été validés : la page a été quittée pendant la validation. Valide-les à nouveau.`
    : '1 relevé n’a pas été validé : la page a été quittée pendant la validation. Valide-le à nouveau.';
