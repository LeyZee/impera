import type { Currency, TeamMemberId } from '@impera/contracts';

import type { ChallengeShift, TimedNet } from './challenge';
import type { CreatorFacts, CreatorGainKind, StoredCreatorGain } from './creator-game';
import type { Gain, GamePay, GameShift, HeldGain } from './gains';
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
  /** The gains that hold today, as the job last wrote them. */
  readonly held: readonly HeldGain[];
}

/** What a chatter's own read adds to their stored gains: their net, their shifts begun, the thresholds. */
interface OwnFacts {
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
  /**
   * Writes the gains not held yet (each once, under its key), dates those `takenBack` (ADR 0118 § 5: the row stays, a
   * gain earned again is a new one) and keeps the streak as counted; answers how many are new.
   */
  record(
    player: Player,
    gains: readonly Gain[],
    takenBack: readonly HeldGain[],
    streak: Streak,
    now: Date,
  ): Promise<number>;
  /** The account's own gains that hold and its streak, read as itself. */
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

/** A creator the game counts for (ADR 0107): her account, linked to her one creator. */
export interface CreatorPlayer {
  readonly userId: string;
  readonly creatorId: string;
}

export interface CreatorRewardsStore {
  /** The creator accounts, on the admin connection. */
  players(): Promise<CreatorPlayer[]>;
  /** What the game reads of her agenda and her drops, on the admin connection, bounded to her creator. */
  facts(player: CreatorPlayer, now: Date): Promise<CreatorFacts>;
  /** Writes the gains not written yet, each once under its kind; answers how many are new. */
  record(player: CreatorPlayer, gains: readonly CreatorGainKind[], now: Date): Promise<number>;
  /** Her own account as a player; `CreatorTrophiesForbidden` when it is not a creator linked to one creator. */
  herself(userId: string): Promise<CreatorPlayer>;
  /**
   * Her account as a player for one of the agency reading her profile (§ 12): the owner or an active manager,
   * `null` for anyone else, including a chatter, and for a creator with no account.
   */
  forAgency(readerId: string, creatorId: string): Promise<CreatorPlayer | null>;
  /** Her gains, read as `readerId` under the table's policies: herself, the owner or an active manager. */
  gains(readerId: string, player: CreatorPlayer): Promise<StoredCreatorGain[]>;
}
