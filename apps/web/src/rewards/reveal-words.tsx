import type { BonusTier, PayPeriod, TrophyCaseItem } from '@impera/contracts';
import type { ReactNode } from 'react';

import { Medal } from './Medal';
import { TROPHY_NAMES, TrophyBadge, type TrophyKind } from './TrophyBadge';
import { tierMedals } from './metals';

import { amountText } from '@/reports/model';

/*
 * What a reveal says and shows for each thing a chatter earns (ADR 0104 § 12 and § 15). A tier's bonus is the one its
 * statement's tiers give, never worked out here (§ 17); no trophy shows an amount.
 */

export interface RevealWords {
  readonly object: ReactNode;
  readonly kicker: string;
  readonly title: string;
  readonly text: string;
  readonly chip?: string;
  readonly tone: 'gold' | 'neon';
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

const OBJECT_SIZE = 220;

/**
 * The reveal of `item`, or `null` for a kind this screen does not know (a newer server): it is then marked seen
 * without a show. `tiers` are those of the fortnight under way, `current`: a tier of an earlier fortnight is named
 * without its label nor its bonus, which this screen has not read.
 */
export function revealWordsOf(
  item: Pick<TrophyCaseItem, 'kind'>,
  current: PayPeriod | null,
  tiers: readonly BonusTier[],
): RevealWords | null {
  if (isTrophy(item.kind)) {
    return {
      object: <TrophyBadge kind={item.kind} size={OBJECT_SIZE} glow />,
      kicker: item.kind.startsWith('streak_') ? 'Série' : 'Trophée gagné',
      title: TROPHY_NAMES[item.kind],
      text: TROPHY_TEXTS[item.kind],
      tone: 'neon',
    };
  }
  const tier = tierOfKind(item.kind);
  if (tier === null) return null;
  const known =
    tier.period === current ? tiers.find((one) => one.thresholdMinor === tier.thresholdMinor) : undefined;
  const fallback = { metal: 'or' as const, rank: 1 };
  const medal = known === undefined ? fallback : (tierMedals(tiers).of(known.thresholdMinor) ?? fallback);
  return {
    object: <Medal medal={medal} size={OBJECT_SIZE} glow />,
    kicker: 'Palier atteint',
    title: known === undefined ? 'Palier atteint' : `Palier ${known.label}`,
    text: 'Ton net de la quinzaine a passé le seuil.',
    ...(known !== undefined && known.bonusMinor > 0
      ? { chip: `Prime prévue ${amountText(known.bonusMinor, 'EUR')}` }
      : {}),
    tone: 'gold',
  };
}
