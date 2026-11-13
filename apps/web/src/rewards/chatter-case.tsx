import type { BonusTier, Currency, PayPeriod, TrophyCase, TrophyCaseItem } from '@impera/contracts';

import { Medal } from './Medal';
import { TROPHY_NAMES, TrophyBadge, type TrophyKind } from './TrophyBadge';
import type { TrophyCaseEntry } from './case/TrophyCaseView';
import { tierMedals } from './metals';
import { tierOfKind } from './reveal-words';

import { roundAmountText } from '@/payroll/model';

/*
 * The chatter's trophy case as « Mes trophées » shows it (ADR 0104 § 12 to § 16, ADR 0108). The server keeps one gain
 * per tier and per fortnight (`tier:<fortnight>:<threshold>`); the shelf shows one medal per threshold of the ladder
 * under way: earned as soon as one fortnight reached it, with how many times, and still ahead with what is left,
 * read on the statement and never worked out here (§ 17). Trophies pass through as the server gives them.
 */

/** What the view says and draws for one object: the shape of `TrophyCaseEntry` (apps/web/src/rewards/case/). */

const TROPHY_HOW: Readonly<Record<TrophyKind, string>> = {
  first_sale: 'Ta première vente relevée.',
  day_record: 'Bats ton meilleur jour.',
  fortnight_record: 'Bats ta meilleure quinzaine.',
  fortnight_on_time: 'Tous tes rapports d’une quinzaine rendus à l’heure.',
  streak_5: '5 shifts d’affilée avec le rapport rendu à l’heure.',
  streak_10: '10 shifts d’affilée avec le rapport rendu à l’heure.',
  streak_25: '25 shifts d’affilée avec le rapport rendu à l’heure.',
  ten_ppv_shift: 'Dix PPV achetés dans un même shift.',
};

const isTrophy = (kind: string): kind is TrophyKind => kind in TROPHY_NAMES;

const shownKind = (thresholdMinor: number): string => `tier:${String(thresholdMinor)}`;

const dayText = (iso: string): string =>
  new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(new Date(iso));

/**
 * `trophyCase` for the view, its `entry`, and `toStoredKinds`, which turns the kinds the view marks as revealed back
 * into the server's. `netMinor` is the net of the fortnight under way, `current`, as the statement gives it; `tiers`
 * its ladder. A tier of an older ladder, whose threshold is no longer in `tiers`, is not shown.
 */
export function chatterCase(
  trophyCase: TrophyCase,
  current: PayPeriod | null,
  netMinor: number,
  currency: Currency,
  tiers: readonly BonusTier[],
): {
  readonly trophyCase: TrophyCase;
  readonly entry: (item: TrophyCaseItem) => TrophyCaseEntry | null;
  readonly toStoredKinds: (kinds: readonly string[]) => string[];
} {
  const medals = tierMedals(tiers);
  const gains = new Map<number, TrophyCaseItem[]>();
  for (const item of trophyCase.items) {
    const tier = tierOfKind(item.kind);
    if (tier === null) continue;
    gains.set(tier.thresholdMinor, [...(gains.get(tier.thresholdMinor) ?? []), item]);
  }
  const notes = new Map<string, string>();
  const stored = new Map<string, string[]>();
  const tierItems = tiers
    .toSorted((a, b) => a.thresholdMinor - b.thresholdMinor)
    .map((tier): TrophyCaseItem => {
      const kind = shownKind(tier.thresholdMinor);
      const earned = (gains.get(tier.thresholdMinor) ?? [])
        .filter((gain) => gain.earnedAt !== null)
        .toSorted((a, b) => (a.earnedAt ?? '').localeCompare(b.earnedAt ?? ''));
      const last = earned.at(-1);
      if (last?.earnedAt === undefined || last.earnedAt === null) {
        return {
          kind,
          family: 'medal',
          earnedAt: null,
          progress:
            current === null
              ? null
              : {
                  current: Math.max(0, Math.min(netMinor, tier.thresholdMinor)),
                  target: tier.thresholdMinor,
                  unit: 'cents',
                },
          revealedAt: null,
        };
      }
      const owed = earned.filter((gain) => gain.revealedAt === null);
      stored.set(
        kind,
        owed.map((gain) => gain.kind),
      );
      if (earned.length > 1) {
        notes.set(kind, `${String(earned.length)} fois · dernière le ${dayText(last.earnedAt)}`);
      }
      return {
        kind,
        family: 'medal',
        earnedAt: last.earnedAt,
        progress: null,
        // One unseen fortnight is enough for the medal to be new.
        revealedAt: owed.length > 0 ? null : last.revealedAt,
      };
    });
  const others = trophyCase.items.filter((item) => tierOfKind(item.kind) === null);

  const entry = (item: TrophyCaseItem): TrophyCaseEntry | null => {
    if (isTrophy(item.kind)) {
      const kind = item.kind;
      const left =
        item.earnedAt === null && item.progress !== null
          ? `Encore ${String(item.progress.target - item.progress.current)}`
          : undefined;
      return {
        name: TROPHY_NAMES[kind],
        how: TROPHY_HOW[kind],
        ...(left === undefined ? {} : { left }),
        art: (size, earned) => <TrophyBadge kind={kind} size={size} earned={earned} />,
        reveal: {
          kicker: kind.startsWith('streak_') ? 'Série' : 'Trophée gagné',
          text: TROPHY_HOW[kind],
          tone: 'neon',
        },
      };
    }
    const tier = tiers.find((one) => shownKind(one.thresholdMinor) === item.kind);
    const medal = tier === undefined ? undefined : medals.of(tier.thresholdMinor);
    if (tier === undefined || medal === undefined || medal === null) return null;
    const note = notes.get(item.kind);
    const missing = tier.thresholdMinor - netMinor;
    return {
      name: `Palier ${tier.label}`,
      how: `${roundAmountText(tier.thresholdMinor, currency)} de net dans une quinzaine.`,
      ...(item.earnedAt === null && current !== null && missing > 0
        ? { left: `Encore ${roundAmountText(missing, currency)}` }
        : {}),
      ...(note === undefined ? {} : { earnedNote: note }),
      art: (size, earned) => <Medal medal={medal} size={size} earned={earned} />,
      reveal: { kicker: 'Palier atteint', text: 'Ton net de la quinzaine a passé le seuil.', tone: 'gold' },
    };
  };

  return {
    trophyCase: { ...trophyCase, items: [...tierItems, ...others] },
    entry,
    toStoredKinds: (kinds) => kinds.flatMap((kind) => stored.get(kind) ?? [kind]),
  };
}
