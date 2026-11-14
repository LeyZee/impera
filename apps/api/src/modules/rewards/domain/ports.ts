import type { TeamMemberId } from '@impera/contracts';

import type { CreatorFacts, CreatorGainKind, StoredCreatorGain } from './creator-game';
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
}

export interface RewardsStore {
  /** The chatters who have not left, on the admin connection. */
  players(): Promise<Player[]>;
  facts(player: Player, now: Date): Promise<PlayerFacts>;
  /** Writes the gains not written yet (each once, under its key) and the streak as counted; answers how many are new. */
  record(player: Player, gains: readonly Gain[], streak: Streak, now: Date): Promise<number>;
  /** The account's own gains and streak, read as itself. */
  own(userId: string): Promise<{ readonly gains: StoredGain[]; readonly streak: Streak }>;
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
