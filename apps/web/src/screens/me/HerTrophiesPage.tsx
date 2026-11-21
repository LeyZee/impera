import type { Me, TrophyCaseStreak } from '@impera/contracts';
import type { JSX } from 'react';

import { MeNav } from './MeNav';

import { useHerTrophyCase, useMarkHerRevealed, usePreferences } from '@/rewards/api';
import { TrophyCaseDown, TrophyCaseLoading, TrophyCaseView } from '@/rewards/case/TrophyCaseView';
import { creatorEntry } from '@/rewards/creator-case';
import { Page, PageHeader } from '@/shell/layout';
import { screenLabel } from '@/shell/nav';

const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count > 1 ? many : one}`;

/** Her medals are already streaks of days: her second shelf says what it holds (Design, 14/11). */
const HER_SHELVES = { streak: 'Livraisons à l’heure' } as const;

/**
 * A streak and, once it broke, her best beside it: a break is never read as a loss (ADR 0108 § 3 and § 9, recette 16/11
 * CRE-02). One chip each, the view keeps two beside « gagnés ».
 */
const withBest = (streak: TrophyCaseStreak, current: string): string =>
  streak.best > streak.current ? `${current} · meilleure : ${String(streak.best)}` : current;

function chipsOf(
  day: TrophyCaseStreak | undefined,
  delivery: TrophyCaseStreak | undefined,
): { label: string; value: string }[] {
  return [
    ...(day === undefined
      ? []
      : [{ label: 'Série en cours', value: withBest(day, plural(day.current, 'jour', 'jours')) }]),
    ...(delivery === undefined
      ? []
      : [
          {
            label: 'Livraisons à l’heure',
            value: withBest(delivery, `${String(delivery.current)} de suite`),
          },
        ]),
  ];
}

/**
 * Moi › Trophées for the creator (ADR 0108): her case on the shared view, read as she is at a glance, her routine's
 * streak and her deliveries on time, with no level (§ 3). Everything is the server's; the screen only lays it out.
 */
export function HerTrophiesPage({ user }: { user: Me }): JSX.Element {
  const caseRead = useHerTrophyCase(true);
  const read = caseRead.data;
  const markRevealed = useMarkHerRevealed();
  const { preferences } = usePreferences(user);
  const day = read?.streaks.find((streak) => streak.kind === 'day');
  const delivery = read?.streaks.find((streak) => streak.kind === 'delivery');
  return (
    <Page width="narrow">
      <PageHeader
        eyebrow="Moi"
        title={screenLabel('/moi/trophees')}
        lead="Ce que tu as gagné, et ce qui vient ensuite."
        tabs={<MeNav creator />}
      />
      {read === undefined ? (
        caseRead.isError ? (
          <TrophyCaseDown onRetry={() => void caseRead.refetch()} />
        ) : (
          <TrophyCaseLoading />
        )
      ) : (
        <TrophyCaseView
          trophyCase={{ ...read, level: null }}
          entry={creatorEntry}
          shelfTitles={HER_SHELVES}
          chips={chipsOf(day, delivery)}
          sound={preferences.sounds}
          onRevealed={(item) => {
            markRevealed([item.kind]);
          }}
        />
      )}
    </Page>
  );
}
