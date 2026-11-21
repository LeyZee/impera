/**
 * He asks to see her (Charles, 21/11 à 19 h 50, Paris): never a yes, never a dry no. She gives one reason per message,
 * never aimed at him, chosen by where they are, never above it however much he insists, and never the same reason
 * twice to the same fan. Once every reason his tier allows was given: a tease, once, then the fan who insists (ADR
 * 0158 § C). Code picks the reason; her words for it are hers (her persona), never written here. The guards on a
 * meeting do not move: no date, no place, no city.
 */

/** The reasons, in the order of the relationship: each tier allows its own and every one below it. */
const MEETING_REASONS = ['too_early', 'needs_time', 'secret', 'no_dates', 'safety'] as const;
export type MeetingReason = (typeof MEETING_REASONS)[number];

/** Where they are: how long they have talked, whether he bought from her, and how close the agency says he is. */
export interface Relationship {
  readonly knownHours: number;
  readonly hasBought: boolean;
  /** A regular she is close to, then a very close one: signals the agency sets, never read from his words. */
  readonly closeness: 'none' | 'close' | 'very_close';
}

/** When a new fan becomes one of a few days: hers to set (her settings), never a number written here. */
export interface MeetingLimits {
  readonly newFanHours: number;
}

/** His tier, 1 to 5: unknown limits keep him new (fail safe: the lowest reason). */
export function relationshipTier(relationship: Relationship, limits: MeetingLimits | undefined): number {
  if (relationship.closeness === 'very_close') return 5;
  if (relationship.closeness === 'close') return 4;
  if (relationship.hasBought) return 3;
  return limits !== undefined && relationship.knownHours >= limits.newFanHours ? 2 : 1;
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
