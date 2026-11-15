import type { MarkRevealedBody, TrophyCase } from '@impera/contracts';

import { gainsOf } from '../domain/gains';
import type { RewardsStore } from '../domain/ports';
import { gainKeyOf, trophyCaseOf } from '../domain/trophy-case';

export interface RewardsDeps {
  readonly store: RewardsStore;
  readonly now: () => Date;
}

/**
 * The job (`rewards.evaluate`): what each chatter earned, from the facts as they stand. Replayable: a gain already
 * written stays as it is, with the date it was first noted. It sends nothing to anyone (ADR 0104 § 18).
 */
export async function evaluateRewards(deps: RewardsDeps): Promise<{ players: number; gained: number }> {
  const players = await deps.store.players();
  let gained = 0;
  for (const player of players) {
    const now = deps.now();
    const facts = await deps.store.facts(player, now);
    const { gains, streak } = gainsOf({ ...facts, now });
    gained += await deps.store.record(player, gains, streak, now);
  }
  return { players: players.length, gained };
}

export async function myTrophyCase(deps: RewardsDeps, userId: string): Promise<TrophyCase> {
  const { gains, streak } = await deps.store.own(userId);
  return trophyCaseOf(gains, streak);
}

/** The reveals the account has just seen: marked once, then the case as it stands. */
export async function markRevealed(
  deps: RewardsDeps,
  userId: string,
  body: MarkRevealedBody,
): Promise<TrophyCase> {
  await deps.store.markRevealed(userId, body.kinds.map(gainKeyOf), deps.now());
  return myTrophyCase(deps, userId);
}
