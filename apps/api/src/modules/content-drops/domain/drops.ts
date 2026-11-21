import {
  declaredFileRefusal,
  dropCountRefusal,
  WITHDRAWABLE_DROP_STATES,
  type ContentDropFileId,
  type CreateContentDropBody,
  type DropCategory,
  type DropState,
} from '@impera/contracts';

/** A refusal of a drop: of one of its files, or of the whole drop (`fileId` null). */
export interface DropRefusal {
  readonly fileId: ContentDropFileId | null;
  readonly sentence: string;
}

/**
 * What the declared drop breaks of its category's rules (ADR 0055 § 2), before anything is stored: too many files, a
 * kind it does not take, a file too heavy. The same sentences as on her phone, which checked them first.
 */
export function dropRefusals(body: Pick<CreateContentDropBody, 'category' | 'files'>): DropRefusal[] {
  const count = dropCountRefusal(body.category, body.files.length);
  const refusals: DropRefusal[] = count === null ? [] : [{ fileId: null, sentence: count }];
  for (const file of body.files) {
    const sentence = declaredFileRefusal(body.category, file);
    if (sentence !== null) refusals.push({ fileId: file.id, sentence });
  }
  return refusals;
}

/** A script is dropped only from a request (ADR 0055 § 8: the Script tile opens only from one). */
export const needsRequest = (category: DropCategory): boolean => category === 'script';

/** She withdraws a drop herself while nothing has scheduled it; the agency too, until it is out. */
export function mayWithdraw(state: DropState, by: 'creator' | 'agency'): boolean {
  if (by === 'creator') return WITHDRAWABLE_DROP_STATES.has(state);
  return state !== 'published' && state !== 'withdrawn';
}

/** A drop answering a request, as the request's reading needs it. */
export interface RequestDrop {
  readonly id: string;
  readonly state: DropState;
  readonly blockedReason: string | null;
  /** The agency's « À refaire », on a withdrawn drop only. */
  readonly redoSentence: string | null;
  readonly withdrawnAt: Date | null;
  readonly updatedAt: Date;
}

/**
 * What answers a request (trou 7 du 21/11): its live drop, unless nothing of it could be kept (blocked): then nothing
 * answers it and the reason says why. With no live drop, the agency's « À refaire » on the last one withdrawn says why
 * it is hers again; one she withdrew herself last says nothing.
 */
export function requestAnswer(drops: readonly RequestDrop[]): {
  readonly dropId: string | null;
  readonly redo: { readonly sentence: string; readonly at: Date } | null;
} {
  const live = drops.find((drop) => drop.state !== 'withdrawn');
  if (live !== undefined)
    return live.state === 'blocked'
      ? { dropId: null, redo: { sentence: live.blockedReason ?? NOTHING_KEPT, at: live.updatedAt } }
      : { dropId: live.id, redo: null };
  const last = drops
    .filter((drop) => drop.withdrawnAt !== null)
    .toSorted((a, b) => (b.withdrawnAt?.getTime() ?? 0) - (a.withdrawnAt?.getTime() ?? 0))[0];
  if (last === undefined || last.redoSentence === null || last.withdrawnAt === null)
    return { dropId: null, redo: null };
  return { dropId: null, redo: { sentence: last.redoSentence, at: last.withdrawnAt } };
}

/** Why a drop is blocked when the cleaning kept none of its files. */
export const NOTHING_KEPT = 'Aucun fichier de ce dépôt n’a pu être gardé';

/** A drop takes a file's bytes while it sends, while she fills her script, or once received for a replacement. */
export const TAKES_BYTES_STATES: ReadonlySet<DropState> = new Set(['uploading', 'filling', 'received']);
