import type { MarkRevealedBody, TrophyCase } from '@impera/contracts';

import { creatorGainsOf, creatorTrophyCaseOf } from '../domain/creator-game';
import { CreatorTrophyCaseNotFound } from '../domain/errors';
import type { CreatorPlayer, CreatorRewardsStore, RewardsStore } from '../domain/ports';
import { gainKeyOf } from '../domain/trophy-case';

export interface CreatorRewardsDeps {
  readonly creators: CreatorRewardsStore;
  /** The chatter's store, for the one write the creator shares with them: the date a reveal was played. */
  readonly store: Pick<RewardsStore, 'markRevealed'>;
  readonly now: () => Date;
}

/**
 * The job's creator side (ADR 0107 § 14): what each creator earned, from her days and her drops as they stand.
 * Replayable: a gain already written stays as it is, with the date it was first noted. It sends nothing (§ 7).
 */
export async function evaluateCreatorRewards(
  deps: CreatorRewardsDeps,
): Promise<{ players: number; gained: number }> {
  const players = await deps.creators.players();
  let gained = 0;
  for (const player of players) {
    const now = deps.now();
    const { gains } = creatorGainsOf(await deps.creators.facts(player, now));
    gained += await deps.creators.record(player, gains, now);
  }
  return { players: players.length, gained };
}

async function caseOf(
  deps: CreatorRewardsDeps,
  readerId: string,
  player: CreatorPlayer,
): Promise<TrophyCase> {
  const { streaks } = creatorGainsOf(await deps.creators.facts(player, deps.now()));
  return creatorTrophyCaseOf(await deps.creators.gains(readerId, player), streaks);
}

/** Her own case (§ 10): her medals, her two streaks, her trophies. */
export async function herTrophyCase(deps: CreatorRewardsDeps, userId: string): Promise<TrophyCase> {
  return caseOf(deps, userId, await deps.creators.herself(userId));
}

/** The reveals she has just seen: marked once, then her case as it stands (§ 11). */
export async function markHerRevealed(
  deps: CreatorRewardsDeps,
  userId: string,
  body: MarkRevealedBody,
): Promise<TrophyCase> {
  const player = await deps.creators.herself(userId);
  await deps.store.markRevealed(userId, body.kinds.map(gainKeyOf), deps.now());
  return caseOf(deps, userId, player);
}

/** Her case on her profile (§ 12), for the owner or an active manager; read only. */
export async function creatorTrophyCaseForAgency(
  deps: CreatorRewardsDeps,
  readerId: string,
  creatorId: string,
): Promise<TrophyCase> {
  const player = await deps.creators.forAgency(readerId, creatorId);
  if (player === null) throw new CreatorTrophyCaseNotFound();
  return caseOf(deps, readerId, player);
}
