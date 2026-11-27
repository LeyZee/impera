import type { CreatorFanInsights } from '@impera/contracts';

/**
 * Her figures on Aujourd'hui (Charles, 21/11: three at most, under her day). What her fans do, from the panel she
 * already reads in Ventes, never another count: her fans, the new ones of the month, who wrote this week. A count under
 * ten is never given exactly (ADR 0074 § 8), and is left out rather than shown as « moins de 10 », which taught her
 * nothing (recette 27/11, G3): with no figure left, the card stays away. What she earns joins once her share is read.
 */
export interface HerFigure {
  readonly key: 'fans' | 'new' | 'wrote';
  readonly label: string;
  readonly value: string;
}

export function herFiguresOf(insights: CreatorFanInsights): readonly HerFigure[] {
  const { fans } = insights;
  const counts: readonly (readonly [HerFigure['key'], string, number | null])[] = [
    ['fans', 'Tes fans', fans.total],
    ['new', 'Nouveaux ce mois', fans.newLast30Days],
    ['wrote', 'T’ont écrit cette semaine', fans.wroteLast7Days],
  ];
  return counts.flatMap(([key, label, n]) =>
    n === null ? [] : [{ key, label, value: `≈ ${n.toLocaleString('fr-FR')}` }],
  );
}
