import type { TrophyCase, TrophyCaseItem } from '@impera/contracts';

import type { GainKind } from './gains';
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
}

/** A tier's `kind` in the case: `tier:<fortnight>:<threshold>`, what its gain is written once under. */
const tierItemKind = (scopeKey: string): string => `tier:${scopeKey}`;

/** The stored gain a case item's `kind` names. */
export function gainKeyOf(itemKind: string): { readonly kind: string; readonly scopeKey: string } {
  return itemKind.startsWith('tier:')
    ? { kind: 'tier', scopeKey: itemKind.slice('tier:'.length) }
    : { kind: itemKind, scopeKey: '' };
}

const isStreakTrophy = (kind: string): kind is keyof typeof STREAK_TROPHIES => kind in STREAK_TROPHIES;

export function trophyCaseOf(gains: readonly StoredGain[], streak: Streak): TrophyCase {
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
  return {
    items: [...trophies, ...tiers],
    streaks: [{ kind: 'shift', current: streak.current, best: streak.best }],
    level: null,
  };
}
