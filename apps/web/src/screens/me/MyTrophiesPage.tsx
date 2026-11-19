import type { Me, TrophyCase } from '@impera/contracts';
import type { JSX } from 'react';

import { HerTrophiesPage } from './HerTrophiesPage';
import { MeNav } from './MeNav';

import { useMyFigures, usePayPeriod } from '@/payroll/api';
import { roundAmountText } from '@/payroll/model';
import { figuresCurrency, netIn } from '@/payroll/my-figures';
import { LevelInsignia } from '@/rewards/LevelInsignia';
import { useMarkRevealed, useMyTrophyCase, usePreferences } from '@/rewards/api';
import { TrophyCaseDown, TrophyCaseLoading, TrophyCaseView } from '@/rewards/case/TrophyCaseView';
import { chatterCase } from '@/rewards/chatter-case';
import { tiersOf } from '@/screens/pay/MyFigures';
import { useCurrentPeriod } from '@/screens/pay/data';
import { Page, PageHeader } from '@/shell/layout';
import { screenLabel } from '@/shell/nav';

/** Without tiers set by the agency, the medal shelf still stands and says why it is empty (CHT-17). */
const NO_TIERS = {
  medal: 'L’agence n’a pas encore posé de paliers de prime. Tes médailles apparaîtront ici.',
} as const;

const shifts = (count: number): string => `${String(count)} ${count > 1 ? 'shifts' : 'shift'}`;

/** The rank at the head of the case: the one held, or the first one ahead while none is (recette 16/11, CHT-17). */
function rankLine(trophyCase: TrophyCase): { art: JSX.Element; text: string } | null {
  const { level } = trophyCase;
  if (level !== null)
    return {
      art: <LevelInsignia rank={level.rank} size={44} />,
      text: `Rang ${level.name}\u00a0: il monte avec ton net depuis ton arrivée et ne redescend jamais`,
    };
  const next = trophyCase.nextLevel ?? null;
  if (next === null) return null;
  return {
    art: <LevelInsignia rank={next.rank} earned={false} size={44} />,
    text: `Premier rang\u00a0: ${next.name}, à ${roundAmountText(next.thresholdMinor, next.currency)} de net depuis ton arrivée`,
  };
}

/** Moi › Trophées (ADR 0108): the creator's case, or the chatter's. */
export function MyTrophiesPage({ user }: { user: Me }): JSX.Element {
  return user.role === 'creator' ? <HerTrophiesPage user={user} /> : <ChatterTrophiesPage user={user} />;
}

/**
 * The chatter's case, on the shared view. His tiers' progress is read on his statement,
 * as on Commissions; everything else is the server's trophy case. Nothing here is worked out by the screen.
 */
function ChatterTrophiesPage({ user }: { user: Me }): JSX.Element {
  const caseRead = useMyTrophyCase(true);
  const read = caseRead.data;
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
    <Page width="narrow">
      <PageHeader
        eyebrow="Moi"
        title={screenLabel('/moi/trophees')}
        lead="Ce que tu as gagné, et ce qui vient ensuite."
        tabs={<MeNav trophies />}
      />
      {shown === null ? (
        caseRead.isError ? (
          <TrophyCaseDown onRetry={() => void caseRead.refetch()} />
        ) : (
          <TrophyCaseLoading />
        )
      ) : (
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
          level={rankLine(shown.trophyCase)}
          emptyShelves={NO_TIERS}
          sound={preferences.sounds}
          onRevealed={(item) => {
            markRevealed(shown.toStoredKinds([item.kind]));
          }}
        />
      )}
    </Page>
  );
}
