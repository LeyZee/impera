import type { ReservedCategory } from '@impera/contracts';

/*
 * What the AI sends from her coffre (ADR 0163 § 7), rules of code (CLAUDE.md, rule 3): never a prompt's.
 */

/** A gift counts, and goes to a fan, only once its description proves it is not nude: undescribed, it waits. */
export const PROVEN_GIFT_INTENSITIES: ReadonlySet<string> = new Set(['soft', 'suggestive']);

/**
 * A voice of hers goes once to a fan, whichever of its files (Charles, 21/11): the beep once, the proof once. A gift is
 * never the same twice, and another may follow.
 */
export const ONCE_PER_FAN: ReadonlySet<ReservedCategory> = new Set(['voice_beep', 'voice_real']);
