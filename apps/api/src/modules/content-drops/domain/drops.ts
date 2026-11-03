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
