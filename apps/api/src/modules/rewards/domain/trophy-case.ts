import type { Currency, TrophyCase, TrophyCaseItem } from '@impera/contracts';

import type { GainKind } from './gains';
import { levelOfRank, nextStep, type LevelStep } from './levels';
import type { Streak } from './streak';
import { STREAK_TROPHIES, TROPHY_KINDS } from './trophies';

/*
 * The chatter's trophy case (ADR 0104 § 13 and § 15, contracts `trophy-case.ts`), pure: every trophy of the closed
 * list, earned or still ahead, then the tiers their statements reached. No amount and no bonus: a tier's progress is
 * read on the statement by the screen, never worked out here (§ 17).
 */

/** A gain as it is stored. */
export interface StoredGain {
  readonly kind: GainKind;
  readonly scopeKey: string;
  readonly earnedAt: Date;
  readonly revealedAt: Date | null;
  /** The threshold a rank was earned at (ADR 0118 § 7); `null` on anything else and on a rank noted before it. */
  readonly basisMinor: number | null;
}

/** A tier's `kind` in the case: `tier:<fortnight>:<threshold>`, what its gain is written once under. */
const tierItemKind = (scopeKey: string): string => `tier:${scopeKey}`;
/** A rank's `kind` in the case: `level:<rank>`. */
const levelItemKind = (scopeKey: string): string => `level:${scopeKey}`;

/** The stored gain a case item's `kind` names. */
export function gainKeyOf(itemKind: string): { readonly kind: string; readonly scopeKey: string } {
  for (const kind of ['tier', 'level']) {
    if (itemKind.startsWith(`${kind}:`)) return { kind, scopeKey: itemKind.slice(kind.length + 1) };
  }
  return { kind: itemKind, scopeKey: '' };
}

/** What the account's own read adds to say the rank ahead; left out of a read of someone else's case. */
export interface LevelProgress {
  readonly steps: readonly LevelStep[];
  readonly cumulatedNetMinor: number;
  readonly currency: Currency | null;
}

const isStreakTrophy = (kind: string): kind is keyof typeof STREAK_TROPHIES => kind in STREAK_TROPHIES;

export function trophyCaseOf(
  gains: readonly StoredGain[],
  streak: Streak,
  progress: LevelProgress | null,
): TrophyCase {
  const trophies: TrophyCaseItem[] = TROPHY_KINDS.map((kind) => {
    const gain = gains.find((one) => one.kind === kind);
    const target = isStreakTrophy(kind) ? STREAK_TROPHIES[kind] : null;
    return {
      kind,
      family: target === null ? 'trophy' : 'streak',
      earnedAt: gain?.earnedAt.toISOString() ?? null,
      progress:
        target === null || gain !== undefined
          ? null
          : { current: Math.min(streak.current, target), target, unit: 'shift' },
      revealedAt: gain?.revealedAt?.toISOString() ?? null,
    };
  });
  const tiers: TrophyCaseItem[] = gains
    .filter((gain) => gain.kind === 'tier')
    .toSorted((a, b) => a.scopeKey.localeCompare(b.scopeKey))
    .map((gain) => ({
      kind: tierItemKind(gain.scopeKey),
      family: 'medal',
      earnedAt: gain.earnedAt.toISOString(),
      progress: null,
      revealedAt: gain.revealedAt?.toISOString() ?? null,
    }));
  const ranks = gains
    .filter((gain) => gain.kind === 'level')
    .toSorted((a, b) => Number(a.scopeKey) - Number(b.scopeKey));
  // The threshold a rank was earned at is said to its owner alone, for the reveal: never on a read of someone else's.
  const currency = progress?.currency ?? null;
  const levels: TrophyCaseItem[] = ranks.map((gain) => ({
    kind: levelItemKind(gain.scopeKey),
    family: 'level',
    earnedAt: gain.earnedAt.toISOString(),
    progress: null,
    revealedAt: gain.revealedAt?.toISOString() ?? null,
    ...(currency === null || gain.basisMinor === null ? {} : { basis: { minor: gain.basisMinor, currency } }),
  }));
  const rank = Number(ranks.at(-1)?.scopeKey ?? 0);
  const ahead = progress === null ? null : nextStep(rank, progress.steps);
  return {
    items: [...trophies, ...tiers, ...levels],
    streaks: [{ kind: 'shift', current: streak.current, best: streak.best }],
    level: levelOfRank(rank),
    nextLevel:
      ahead === null || progress?.currency == null
        ? null
        : {
            rank: ahead.rank,
            name: ahead.name,
            thresholdMinor: ahead.thresholdMinor,
            // The true net, even past the threshold while the job has not noted the rank yet (recette CHT-08):
            // the screen caps its bar, not the figure. A refund may bring it under zero: never shown below.
            currentMinor: Math.max(0, progress.cumulatedNetMinor),
            currency: progress.currency,
          },
  };
}
