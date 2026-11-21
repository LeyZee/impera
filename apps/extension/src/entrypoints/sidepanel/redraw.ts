import type { GestureDone, PanelScreen } from './view';

/** How long « Refusé… » or « Texte copié… » stays once the draft is gone from the CRM (recette du 16/11, EXT-23). */
export const DONE_KEPT_MS = 30_000;

/**
 * What the panel draws, as a key: an answer with the same key leaves the panel as it is, under his eyes (§ 10). The text
 * being retouched is left out, it lives in its field (EXT-01); the clock counts by the minute, so « il y a 3 min »
 * follows it without a redraw every 5 s (EXT-15).
 */
export function drawnKey(screen: PanelScreen): string {
  const drawn =
    screen.kind === 'conversation' && screen.draft.kind === 'ready'
      ? { ...screen, draft: { ...screen.draft, text: null } }
      : screen;
  return JSON.stringify(drawn, (name, value: unknown) => {
    if (name === 'now') return typeof value === 'string' ? value.slice(0, 16) : undefined;
    return value instanceof Set ? [...value] : value;
  });
}

/**
 * Whether what a gesture left is still said once its draft is gone from the CRM (refused, or sent and reconciled): a
 * while, and as long as bubbles are left to copy, so the chatter reads it and finishes (EXT-23).
 */
export function keepsDone(done: GestureDone, doneAt: number, now: number): boolean {
  if (done.outcome === 'placed' && done.sent !== 'reconciled' && done.copied < done.bubbles.length)
    return true;
  return now - doneAt < DONE_KEPT_MS;
}

/**
 * The placing of this draft, once the CRM matched what left in Reveal to it (ADR 0086 § 5): « Envoyé ». `null` when
 * nothing changes: another draft, a refusal, or already said.
 */
export function reconciledDone(
  done: GestureDone | null,
  draftId: string,
  sentDraftId: string | undefined,
): GestureDone | null {
  if (done?.outcome !== 'placed' || done.sent === 'reconciled' || sentDraftId !== draftId) return null;
  return { ...done, sent: 'reconciled', copied: done.bubbles.length };
}
