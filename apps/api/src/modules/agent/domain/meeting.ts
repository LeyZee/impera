import { MEETING_REASONS, type MeetingReason, type MeetingTierSettings } from '@impera/contracts';

/**
 * He asks to see her (Charles, 21/11 à 19 h 50, Paris): never a yes, never a dry no. She gives one reason per message,
 * never aimed at him, chosen by where they are, never above it however much he insists, and never the same reason
 * twice to the same fan. Once every reason his tier allows was given: a tease, once, then the fan who insists (ADR
 * 0158 § C). Code picks the reason; her words for it are hers (her persona), never written here. The guards on a
 * meeting do not move: no date, no place, no city.
 */

export type { MeetingReason };

/** Where they are, as code reads it: how long they have talked, and whether he paid her. */
export interface Relationship {
  readonly knownHours: number;
  readonly hasBought: boolean;
}

/**
 * His tier, 1 to 5, judged by code from seniority and purchases (guide 26/11): brand new, a few days, a regular who
 * paid, close, very close. A fan who never paid never goes past the second; without her settings, nobody does (a
 * payer counts as a few days, the others as brand new).
 */
export function relationshipTier(
  relationship: Relationship,
  settings: MeetingTierSettings | undefined,
): number {
  const { knownHours, hasBought } = relationship;
  if (settings === undefined) return hasBought ? 2 : 1;
  if (!hasBought) return knownHours >= settings.newFanHours ? 2 : 1;
  if (knownHours >= settings.veryCloseFanHours) return 5;
  return knownHours >= settings.closeFanHours ? 4 : 3;
}

export type MeetingAnswer =
  | { readonly kind: 'reason'; readonly reason: MeetingReason }
  | { readonly kind: 'tease' }
  | { readonly kind: 'heavy' }
  | { readonly kind: 'next_party' };

export interface MeetingTurn {
  readonly tier: number;
  /** The reasons she already gave this fan, whenever (the journal). */
  readonly given: readonly MeetingReason[];
  /** She already teased him once about it, every reason spent. */
  readonly teased: boolean;
  /** He asks about her next party: « if I go, I'll tell you », nothing more. */
  readonly herNextParty: boolean;
}

/** One reason for this message: the one that fits his tier best among those not given yet, then a tease, then heavy. */
export function meetingAnswer(turn: MeetingTurn): MeetingAnswer {
  if (turn.herNextParty) return { kind: 'next_party' };
  const allowed = MEETING_REASONS.slice(0, Math.max(1, Math.min(MEETING_REASONS.length, turn.tier)));
  const left = allowed.filter((reason) => !turn.given.includes(reason));
  const reason = left.at(-1);
  if (reason !== undefined) return { kind: 'reason', reason };
  return turn.teased ? { kind: 'heavy' } : { kind: 'tease' };
}
