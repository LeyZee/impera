import type { CreatorFanInsights } from '@impera/contracts';

/**
 * Her figures on Aujourd'hui (Charles, 21/11: three at most, under her day). What her fans do, from the panel she
 * already reads in Ventes, never another count: her fans, the new ones of the month, who wrote this week. A count under
 * ten is never given exactly (ADR 0074 § 8). What she earns joins once her share is read (Équipe).
 */
export interface HerFigure {
  readonly key: 'fans' | 'new' | 'wrote';
  readonly label: string;
  readonly value: string;
}

const count = (n: number | null): string => (n === null ? 'moins de 10' : `≈ ${n.toLocaleString('fr-FR')}`);

export function herFiguresOf(insights: CreatorFanInsights): readonly HerFigure[] {
  const { fans } = insights;
  return [
    { key: 'fans', label: 'Tes fans', value: count(fans.total) },
    { key: 'new', label: 'Nouveaux ce mois', value: count(fans.newLast30Days) },
    { key: 'wrote', label: 'T’ont écrit cette semaine', value: count(fans.wroteLast7Days) },
  ];
}
