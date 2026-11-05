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
 * Suivi of a chatter (ADR 0025): he reads the conversations routed to him (a handover, a draft of the agent to decide).
 * The access to every conversation of his creators during his shift (EQ-13) is not built yet: until it is, Suivi says
 * so plainly instead of an empty list (Charles, « go recos » of 05/11, reco 7; recette CHAT-02, CHAT-14). Outside his
 * shift, it says so too, with his next shift; only a handover he took stays readable, until he gives it back.
 */
export function ChatterTrackingPage({
  away = null,
  ...props
}: Omit<ComponentProps<typeof TrackingPage>, 'offShift' | 'routedOnly' | 'nothingListed'> & {
  /** His status when he is away from the team (suspended, on leave…): said first and alone (CHAT-09). */
  away?: MyAwayStatus | null;
}): JSX.Element {
  const mine = useMyShifts();
  const now = useNow();
  const off = mine.data !== undefined && !accessOpen(mine.data, now);
  return (
    <TrackingPage
      {...props}
      routedOnly
      nothingListed={<NothingRouted />}
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
 * On shift with nothing routed to him: what Suivi holds for now, what he does meanwhile, and where his shift is said.
 * Never a promise of what EQ-13 will open (CHAT-02), never a blank (CHAT-14).
 */
function NothingRouted(): JSX.Element {
  return (
    <Panel className="nv-coming">
      <div className="nv-coming__in tr-notice" role="status">
        <h2>Rien pour toi pour l’instant</h2>
        <p>
          Tu chattes dans Reveal. Ici arrivent seulement les conversations qu’on te confie : une passation, un
          brouillon de l’agent à valider.
        </p>
        <p>
          Voir toutes les conversations de ta créatrice pendant ton shift n’est pas encore ouvert dans Impera
          : en attendant, tout se passe dans Reveal.
        </p>
        <Link to="/aujourdhui" className="nv-btn nv-btn--soft nv-btn--sm">
          Voir mon shift
        </Link>
      </div>
    </Panel>
  );
}
