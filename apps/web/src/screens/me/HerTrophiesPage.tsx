import type { Me } from '@impera/contracts';
import type { JSX } from 'react';

import { MeNav } from './MeNav';

import { useHerTrophyCase, useMarkHerRevealed, usePreferences } from '@/rewards/api';
import { TrophyCaseView } from '@/rewards/case/TrophyCaseView';
import { creatorEntry } from '@/rewards/creator-case';
import { Page, PageHeader } from '@/shell/layout';

const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count > 1 ? many : one}`;

/** Her medals are already streaks of days: her second shelf says what it holds (Design, 14/11). */
const HER_SHELVES = { streak: 'Livraisons à l’heure' } as const;

/**
 * Moi › Trophées for the creator (ADR 0108): her case on the shared view, read as she is at a glance, her routine's
 * streak and her deliveries on time, with no level (§ 3). Everything is the server's; the screen only lays it out.
 */
export function HerTrophiesPage({ user }: { user: Me }): JSX.Element {
  const read = useHerTrophyCase(true).data;
  const markRevealed = useMarkHerRevealed();
  const { preferences } = usePreferences(user);
  const day = read?.streaks.find((streak) => streak.kind === 'day');
  const delivery = read?.streaks.find((streak) => streak.kind === 'delivery');
  return (
    <Page>
      <PageHeader eyebrow="Moi" title="Mes trophées" actions={<MeNav creator />} />
      {read === undefined ? null : (
        <TrophyCaseView
          trophyCase={{ ...read, level: null }}
          entry={creatorEntry}
          shelfTitles={HER_SHELVES}
          chips={[
            ...(day === undefined
              ? []
              : [{ label: 'Série en cours', value: plural(day.current, 'jour', 'jours') }]),
            ...(delivery === undefined
              ? []
              : [{ label: 'Livraisons à l’heure', value: `${String(delivery.current)} de suite` }]),
          ]}
          sound={preferences.sounds}
          onRevealed={(item) => {
            markRevealed([item.kind]);
          }}
        />
      )}
    </Page>
  );
}
