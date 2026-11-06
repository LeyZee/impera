import type { MyShift } from '@impera/contracts';
import { Link } from '@tanstack/react-router';
import type { ComponentProps, JSX } from 'react';

import { TrackingPage } from './TrackingPage';

import { MyAwayCard } from '@/scheduling/MyAwayCard';
import { useMyShifts } from '@/scheduling/api';
import { accessOpen, type MyAwayStatus } from '@/scheduling/model';
import '@/scheduling/scheduling.css';
import { addDays, dayOf, longDay, rangeAt, readerZone } from '@/scheduling/time';
import { useNow } from '@/scheduling/useNow';
import { Panel } from '@/shell/layout';

/**
 * Suivi of a chatter (ADR 0025, EQ-13): during his shift, widened by the planning's margin, he reads every conversation
 * of the creator he is on, decides the agent's drafts and takes over (Charles, « go recos » of 05/11, reco 7). Outside
 * it, the page says so with his next shift, and only a conversation he holds stays listed, until he gives the hand back.
 * The window is the server's (`shiftCreatorIds`, `accessStartsAt`): the page only says it.
 */
export function ChatterTrackingPage({
  away = null,
  ...props
}: Omit<ComponentProps<typeof TrackingPage>, 'offShift' | 'selfScope' | 'nothingListed'> & {
  /** His status when he is away from the team (suspended, on leave…): said first and alone (CHAT-09). */
  away?: MyAwayStatus | null;
}): JSX.Element {
  const mine = useMyShifts();
  const now = useNow();
  const off = mine.data !== undefined && !accessOpen(mine.data, now);
  return (
    <TrackingPage
      {...props}
      selfScope
      nothingListed={<NothingListed />}
      offShift={
        away !== null
          ? () => <MyAwayCard status={away} />
          : off
            ? (holdsHandover: boolean) => (
                <OffShift next={mine.data.next} holdsHandover={holdsHandover} now={now} zone={readerZone()} />
              )
            : undefined
      }
    />
  );
}

function OffShift({
  next,
  holdsHandover,
  now,
  zone,
}: {
  next: MyShift | null;
  holdsHandover: boolean;
  now: Date;
  zone: string;
}): JSX.Element {
  const today = dayOf(now, zone);
  const day = next === null ? null : dayOf(next.startsAt, zone);
  const when =
    day === null
      ? ''
      : day === today
        ? 'aujourd’hui'
        : day === addDays(today, 1)
          ? 'demain'
          : `le ${longDay(day)}`;
  return (
    <Panel className="sc-off nv-swap">
      <div className="sc-off__in" role="status">
        <span className="sc-off__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 7.5V12l3 2" />
          </svg>
        </span>
        <div className="sc-off__text">
          <h2 className="sc-off__title">Tu n’es pas en poste</h2>
          <p className="sc-off__lead">
            {next === null
              ? 'Aucun shift prévu pour l’instant.'
              : `Prochain shift ${when}, ${rangeAt(next.startsAt, next.endsAt, zone)} sur ${next.creatorName}.`}
            {holdsHandover
              ? ' La passation que tu as prise reste ici jusqu’à ce que tu rendes la main.'
              : null}
          </p>
        </div>
        <Link to="/planning" className="nv-btn nv-btn--soft nv-btn--sm sc-off__go">
          Mon planning
        </Link>
      </div>
    </Panel>
  );
}

/**
 * On shift with nothing listed: no fan has written to his creator yet. What arrives here, what he does meanwhile, and
 * where his shift is said; never a blank (CHAT-14).
 */
function NothingListed(): JSX.Element {
  return (
    <Panel className="nv-coming">
      <div className="nv-coming__in tr-notice" role="status">
        <h2>Aucune conversation pour l’instant</h2>
        <p>
          Pendant ton shift, toutes les conversations de ta créatrice arrivent ici, ce qui attend une réponse
          en tête. Tu y valides les brouillons de l’agent ; tu réponds aux fans dans Reveal.
        </p>
        <Link to="/aujourdhui" className="nv-btn nv-btn--soft nv-btn--sm">
          Voir mon shift
        </Link>
      </div>
    </Panel>
  );
}
