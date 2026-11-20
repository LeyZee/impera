import type { BonusTier, PayPeriod, TrophyCaseItem } from '@impera/contracts';
import type { ReactNode } from 'react';

import { LevelInsignia, levelName } from './LevelInsignia';
import { Medal } from './Medal';
import { TROPHY_NAMES, TrophyBadge, type TrophyKind } from './TrophyBadge';
import { tierMedals } from './metals';

import { roundAmountText } from '@/payroll/model';
import { amountText } from '@/reports/model';

/*
 * What a reveal says and shows for each thing a chatter earns (ADR 0104 § 12, § 15 and § 16). A tier's bonus is the one its
 * statement's tiers give, never worked out here (§ 17); no trophy shows an amount. A rank says the cumulated net it
 * was earned at when the server gives it: the chatter's own figure, the one « Mon rang » already counted toward.
 */

export interface RevealWords {
  readonly object: ReactNode;
  readonly kicker: string;
  readonly title: string;
  readonly text: string;
  readonly chip?: string;
  readonly tone: 'gold' | 'neon';
  /** A rank's insignia is forged, not turned over (`RewardReveal`). */
  readonly forge?: number;
}

const TROPHY_TEXTS: Readonly<Record<TrophyKind, string>> = {
  first_sale: 'Ta première vente est relevée. La suite commence ici.',
  day_record: 'Tu as battu ton meilleur jour.',
  fortnight_record: 'Tu as battu ta meilleure quinzaine.',
  fortnight_on_time: 'Tous tes rapports de la quinzaine rendus à l’heure.',
  streak_5: '5 shifts d’affilée avec le rapport rendu à l’heure.',
  streak_10: '10 shifts d’affilée avec le rapport rendu à l’heure.',
  streak_25: '25 shifts d’affilée avec le rapport rendu à l’heure.',
  ten_ppv_shift: 'Dix PPV achetés dans un même shift.',
};

const isTrophy = (kind: string): kind is TrophyKind => kind in TROPHY_NAMES;

/** The fortnight and the threshold a tier item names (`tier:<fortnight>:<threshold>`), or `null` for anything else. */
export function tierOfKind(
  kind: string,
): { readonly period: string; readonly thresholdMinor: number } | null {
  const match = /^tier:(\d{4}-\d{2}-\d{2}):(\d+)$/u.exec(kind);
  if (match === null) return null;
  const [, period, threshold] = match;
  return period === undefined || threshold === undefined
    ? null
    : { period, thresholdMinor: Number(threshold) };
}

/** The rank a level item names (`level:<rank>`), or `null` for anything else. */
export function rankOfKind(kind: string): number | null {
  const match = /^level:(\d{1,2})$/u.exec(kind);
  return match?.[1] === undefined ? null : Number(match[1]);
}

/**
 * How high a gain stands when several are owed at once: a rank, then a tier's medal, then a trophy, then a streak.
 * The highest gets the one ceremony; the others are named under it (Design's rule: one ceremony an arrival).
 */
export function heightOfKind(kind: string): number {
  if (rankOfKind(kind) !== null) return 3;
  if (tierOfKind(kind) !== null) return 2;
  return kind.startsWith('streak_') ? 0 : 1;
}

const OBJECT_SIZE = 220;

/**
 * The reveal of `item`, or `null` for a kind this screen does not know (a newer server): it is then marked seen
 * without a show. `tiers` are those of the fortnight under way, `current`: a tier of an earlier fortnight is named
 * without its label nor its bonus, which this screen has not read.
 */
export function revealWordsOf(
  item: Pick<TrophyCaseItem, 'kind' | 'basis'>,
  current: PayPeriod | null,
  tiers: readonly BonusTier[],
  /** The object's side: the reveal's own by default; a small one, without its light, for « Aussi gagné ». */
  size = OBJECT_SIZE,
): RevealWords | null {
  const glow = size === OBJECT_SIZE;
  if (isTrophy(item.kind)) {
    return {
      object: <TrophyBadge kind={item.kind} size={size} glow={glow} />,
      kicker: item.kind.startsWith('streak_') ? 'Série' : 'Trophée gagné',
      title: TROPHY_NAMES[item.kind],
      text: TROPHY_TEXTS[item.kind],
      tone: 'neon',
    };
  }
  const rank = rankOfKind(item.kind);
  if (rank !== null) {
    const name = levelName(rank);
    if (name === null) return null;
    return {
      object: <LevelInsignia rank={rank} size={size} glow={glow} />,
      kicker: 'Nouveau rang',
      title: name,
      text:
        item.basis === undefined
          ? rank === 1
            ? 'Ton premier rang. Il suit ton net cumulé.'
            : 'Ton net cumulé a passé le seuil.'
          : `Ton net depuis ton arrivée vient de passer ${roundAmountText(item.basis.minor, item.basis.currency)}.`,
      tone: 'neon',
      forge: rank,
    };
  }
  const tier = tierOfKind(item.kind);
  if (tier === null) return null;
  const known =
    tier.period === current ? tiers.find((one) => one.thresholdMinor === tier.thresholdMinor) : undefined;
  const fallback = { metal: 'or' as const, rank: 1 };
  const medal = known === undefined ? fallback : (tierMedals(tiers).of(known.thresholdMinor) ?? fallback);
  return {
    object: <Medal medal={medal} size={size} glow={glow} />,
    kicker: 'Palier atteint',
    title: known === undefined ? 'Palier atteint' : `Palier ${known.label}`,
    text: 'Ton net de la quinzaine a passé le seuil.',
    ...(known !== undefined && known.bonusMinor > 0
      ? { chip: `Prime prévue ${amountText(known.bonusMinor, 'EUR')}` }
      : {}),
    tone: 'gold',
  };
}
