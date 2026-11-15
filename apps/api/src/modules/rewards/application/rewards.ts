import type {
  LevelSettings,
  LevelThresholds,
  MarkRevealedBody,
  MyShiftChallenge,
  TeamMemberId,
  TrophyCase,
} from '@impera/contracts';

import { shiftChallenge, shownShift } from '../domain/challenge';
import { gainsOf } from '../domain/gains';
import { LEVEL_NAMES, levelSteps } from '../domain/levels';
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
    const { gains, streak } = gainsOf({ ...facts, now, levelSteps: levelSteps(facts.thresholdsMinor) });
    gained += await deps.store.record(player, gains, streak, now);
  }
  return { players: players.length, gained };
}

export async function myTrophyCase(deps: RewardsDeps, userId: string): Promise<TrophyCase> {
  const { gains, streak } = await deps.store.own(userId);
  const facts = await deps.store.ownFacts(userId, deps.now());
  return trophyCaseOf(
    gains,
    streak,
    facts === null
      ? null
      : {
          steps: levelSteps(facts.thresholdsMinor),
          cumulatedNetMinor: facts.cumulatedNetMinor,
          // The thresholds are read in the currency that brings the member the most: euros before a first sale.
          currency: facts.currency ?? 'EUR',
        },
  );
}

/**
 * The challenge of the session's shift under way, or of the last one for twelve hours after its end (§ 14): read
 * when asked, never stored, never sent to anyone, and with no effect on pay (§ 17).
 */
export async function myShiftChallenge(deps: RewardsDeps, userId: string): Promise<MyShiftChallenge> {
  const now = deps.now();
  const facts = await deps.store.ownFacts(userId, now);
  if (facts?.currency == null) return { challenge: null };
  const shift = shownShift(facts.shifts, now);
  if (shift === null) return { challenge: null };
  const challenge = shiftChallenge({
    shift,
    past: facts.shifts,
    nets: facts.timedNets,
    agencyZone: facts.agencyZone,
  });
  return {
    challenge:
      challenge === null
        ? null
        : {
            shiftStartsAt: shift.startsAt.toISOString(),
            shiftEndsAt: shift.endsAt.toISOString(),
            currency: facts.currency,
            ...challenge,
          },
  };
}

/** A member's trophies, streak and rank on their file, for the owner and an active manager (§ 20): read only. */
export async function memberTrophyCase(
  deps: RewardsDeps,
  viewerId: string,
  memberId: TeamMemberId,
): Promise<TrophyCase | null> {
  const found = await deps.store.ofMember(viewerId, memberId);
  return found === null ? null : trophyCaseOf(found.gains, found.streak, null);
}

const settingsOf = (thresholdsMinor: readonly number[]): LevelSettings => ({
  ranks: LEVEL_NAMES.map((name, index) => ({ rank: index + 1, name })),
  thresholdsMinor: [...thresholdsMinor],
});

export async function levelSettings(deps: RewardsDeps, userId: string): Promise<LevelSettings> {
  return settingsOf(await deps.store.thresholds(userId));
}

/** The owner sets the cumulated net that opens each rank (§ 16). A rank already reached is never taken back. */
export async function saveLevelThresholds(
  deps: RewardsDeps,
  userId: string,
  body: LevelThresholds,
): Promise<LevelSettings> {
  await deps.store.saveThresholds(userId, body.thresholdsMinor, deps.now());
  return settingsOf(body.thresholdsMinor);
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
