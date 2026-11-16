import type { Me } from '@impera/contracts';
import type { JSX } from 'react';

import { HerTrophiesPage } from './HerTrophiesPage';
import { MeNav } from './MeNav';

import { useMyFigures, usePayPeriod } from '@/payroll/api';
import { figuresCurrency, netIn } from '@/payroll/my-figures';
import { useMarkRevealed, useMyTrophyCase, usePreferences } from '@/rewards/api';
import { TrophyCaseView } from '@/rewards/case/TrophyCaseView';
import { chatterCase } from '@/rewards/chatter-case';
import { tiersOf } from '@/screens/pay/MyFigures';
import { useCurrentPeriod } from '@/screens/pay/data';
import { Page, PageHeader } from '@/shell/layout';

const shifts = (count: number): string => `${String(count)} ${count > 1 ? 'shifts' : 'shift'}`;

/** Moi › Trophées (ADR 0108): the creator's case, or the chatter's. */
export function MyTrophiesPage({ user }: { user: Me }): JSX.Element {
  return user.role === 'creator' ? <HerTrophiesPage user={user} /> : <ChatterTrophiesPage user={user} />;
}

/**
 * The chatter's case, on the shared view. His tiers' progress is read on his statement,
 * as on Commissions; everything else is the server's trophy case. Nothing here is worked out by the screen.
 */
function ChatterTrophiesPage({ user }: { user: Me }): JSX.Element {
  const read = useMyTrophyCase(true).data;
  const figures = useMyFigures().data;
  const current = useCurrentPeriod();
  const period = usePayPeriod(current).data;
  const markRevealed = useMarkRevealed();
  const { preferences } = usePreferences(user);
  const currency = figures === undefined ? 'EUR' : figuresCurrency(figures);
  const net = figures === undefined ? 0 : netIn(figures.nets, currency);
  const shift = read?.streaks.find((streak) => streak.kind === 'shift');
  const shown = read === undefined ? null : chatterCase(read, current, net, currency, tiersOf(period));
  return (
    <Page>
      <PageHeader eyebrow="Moi" title="Mes trophées" actions={<MeNav trophies />} />
      {shown === null ? null : (
        <TrophyCaseView
          trophyCase={shown.trophyCase}
          entry={shown.entry}
          chips={
            shift === undefined
              ? []
              : [
                  { label: 'Série en cours', value: shifts(shift.current) },
                  { label: 'Meilleure série', value: shifts(shift.best) },
                ]
          }
          level={
            shown.trophyCase.level === null
              ? null
              : `Rang ${shown.trophyCase.level.name} : il monte avec ton net depuis ton arrivée et ne redescend jamais`
          }
          sound={preferences.sounds}
          onRevealed={(item) => {
            markRevealed(shown.toStoredKinds([item.kind]));
          }}
        />
      )}
    </Page>
  );
}
