/**
 * What left on the platform after a chatter placed a draft from the copilot panel (ADR 0086 § 5): the platform's own
 * text decides, not the click. A draft placed longer ago than this is not reconciled: it answers an old moment.
 */
export const PLACED_RECONCILE_MS = 15 * 60_000;

/**
 * - `wait`: fewer messages left than the draft has bubbles: the chatter sends them one at a time (EXT-13);
 * - `approved`: they are its bubbles, word for word;
 * - `edited`: what left differs, and is the draft's corrected text.
 */
export type Reconciled =
  | { readonly kind: 'wait' }
  | { readonly kind: 'approved' }
  | { readonly kind: 'edited'; readonly bubbles: readonly string[] };

/** The same words, whatever the spaces around them or the form of an accent the platform gives back. */
const sameText = (left: string, right: string): boolean =>
  left.normalize('NFC').trim().replace(/\s+/gu, ' ') === right.normalize('NFC').trim().replace(/\s+/gu, ' ');

/**
 * Reconciles a placed draft's bubbles with the texts the chatter sent since the fan's last message, oldest first.
 * Nothing is decided before as many messages as bubbles have left.
 */
export function reconcilePlaced(bubbles: readonly string[], sent: readonly string[]): Reconciled {
  if (sent.length < bubbles.length) return { kind: 'wait' };
  const same =
    sent.length === bubbles.length && bubbles.every((bubble, i) => sameText(bubble, sent[i] ?? ''));
  return same ? { kind: 'approved' } : { kind: 'edited', bubbles: [...sent] };
}
