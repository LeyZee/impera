import type { TeamMemberId } from '@impera/contracts';

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
