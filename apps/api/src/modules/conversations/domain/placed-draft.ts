import type { Verdict } from '@impera/contracts';

/**
 * A draft the chatter put in the platform's field from the copilot panel (ADR 0086 § 4) waits this long for what
 * leaves: a message of the creator's side sent within it is read as that draft, sent by hand (§ 5).
 */
export const PLACED_WINDOW_MS = 15 * 60_000;
/** The platform's clock and ours drift: a message dated a little before the placing is still that draft. */
const CLOCK_SKEW_MS = 60_000;
/** The settling job runs after the window, plus what the connector takes to read what left. */
export const PLACED_SETTLE_DELAY_MS = PLACED_WINDOW_MS + 2 * 60_000;

interface PlacedCandidate {
  readonly status: string;
  readonly placedAt: Date | null;
}

/**
 * The draft a message of the creator's side sent at `sentAt` answers for, among her open drafts: the last one still
 * pending that was placed within the window before it. `null` when none: the message is someone's own words.
 */
export function placedDraftFor<D extends PlacedCandidate>(drafts: readonly D[], sentAt: Date): D | null {
  const placed = drafts.filter((draft) => {
    if (draft.status !== 'pending' || draft.placedAt === null) return false;
    const after = sentAt.getTime() - draft.placedAt.getTime();
    return after >= -CLOCK_SKEW_MS && after <= PLACED_WINDOW_MS;
  });
  return placed.at(-1) ?? null;
}

/** What a `corrected` rating keeps of the text (its schema's bound). */
const CORRECTED_MAX = 4_000;

/** Spaces the platform may add or fold do not make a bubble different. */
const sameWords = (a: string, b: string): boolean =>
  a.trim().replace(/\s+/gu, ' ') === b.trim().replace(/\s+/gu, ' ');

/**
 * What left decides the verdict (ADR 0086 § 5): the draft's bubbles, sent as they were, validate it; anything else
 * (a word changed, a bubble left out or added) corrects it, with the text really sent.
 */
export function placedVerdict(bubbles: readonly string[], sent: readonly string[]): Verdict {
  const same =
    bubbles.length === sent.length && bubbles.every((bubble, index) => sameWords(bubble, sent[index] ?? ''));
  return same ? { kind: 'validated' } : { kind: 'corrected', text: sent.join('\n').slice(0, CORRECTED_MAX) };
}
