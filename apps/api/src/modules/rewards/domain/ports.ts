import type { Currency, TeamMemberId } from '@impera/contracts';

import type { ChallengeShift, TimedNet } from './challenge';
import type { Gain, GamePay, GameShift } from './gains';
import type { Streak } from './streak';
import type { StoredGain } from './trophy-case';

/** A chatter the game counts for: the manager and the owner do not play (ADR 0104 § 20). */
interface Player {
  readonly memberId: TeamMemberId;
  readonly userId: string;
}

/** What the job reads of one player, in one transaction. */
interface PlayerFacts {
  readonly agencyZone: string;
  readonly pay: GamePay;
  readonly shifts: readonly GameShift[];
  /** The owner's thresholds for the levels, the first rank first; empty when none is set. */
  readonly thresholdsMinor: readonly number[];
}

/** What a chatter's own read adds to their stored gains: their net, their shifts begun, the thresholds. */
export interface OwnFacts {
  readonly agencyZone: string;
  readonly currency: Currency | null;
  readonly cumulatedNetMinor: number;
  readonly timedNets: readonly TimedNet[];
  readonly shifts: readonly ChallengeShift[];
  readonly thresholdsMinor: readonly number[];
}

export interface RewardsStore {
  /** The chatters who have not left, on the admin connection. */
  players(): Promise<Player[]>;
  facts(player: Player, now: Date): Promise<PlayerFacts>;
  /** Writes the gains not written yet (each once, under its key) and the streak as counted; answers how many are new. */
  record(player: Player, gains: readonly Gain[], streak: Streak, now: Date): Promise<number>;
  /** The account's own gains and streak, read as itself. */
  own(userId: string): Promise<{ readonly gains: StoredGain[]; readonly streak: Streak }>;
  /** A chatter's own net, shifts and the thresholds, read as themself; `null` for an account that does not play. */
  ownFacts(userId: string, now: Date): Promise<OwnFacts | null>;
  /**
   * A chatter's gains and streak as `viewerId` may read them (the owner and an active manager the team's, § 20);
   * `null` when the viewer cannot see that member or the member does not play.
   */
  ofMember(
    viewerId: string,
    memberId: TeamMemberId,
  ): Promise<{ readonly gains: StoredGain[]; readonly streak: Streak } | null>;
  /** The owner's thresholds, read as `userId`; empty when none is set. */
  thresholds(userId: string): Promise<number[]>;
  /** Replaces the thresholds; the database lets the owner alone write them. */
  saveThresholds(userId: string, thresholdsMinor: readonly number[], now: Date): Promise<void>;
  /** Marks the reveal of the account's own gains played, those not marked yet. */
  markRevealed(
    userId: string,
    keys: readonly { readonly kind: string; readonly scopeKey: string }[],
    now: Date,
  ): Promise<void>;
}
