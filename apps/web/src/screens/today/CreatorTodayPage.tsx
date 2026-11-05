import type { CreatorOnDuty } from '@impera/contracts';
import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import { useCreatorOnDuty } from '@/scheduling/api';
import '@/scheduling/scheduling.css';
import {
  addDays,
  clockAt,
  dayOf,
  dayWordOf,
  longDay,
  minuteOf,
  mondayOf,
  rangeAt,
  readerZone,
  untilOf,
} from '@/scheduling/time';
import { useNow } from '@/scheduling/useNow';
import { Glance } from '@/screens/agenda/DayView';
import { useAgenda, useWithPending } from '@/screens/agenda/api';
import '@/screens/agenda/agenda.css';
import { planOf } from '@/screens/agenda/model';
import { ServerSilent } from '@/shell/ServerSilent';
import { Page, PageHeader, Panel } from '@/shell/layout';

/**
 * Aujourd'hui, the creator's (CR-02, ADR 0042 § 8): the page she opens in the morning (CREA-19). Where her day stands
 * and what to start with, as at the top of her Agenda; what the agency proposes and waits on her; then who answers her
 * fans, in one line, by their display name alone (ADR 0023: nothing else of the team). Her last sales come once CR-04
 * exists. Agenda stays where she plans; this page only reads. Read in her own time, the browser's.
 */
export function CreatorTodayPage(): JSX.Element {
  const now = useNow();
  const today = dayOf(now, readerZone());
  return (
    <Page>
      <PageHeader eyebrow={longDay(today)} title="Aujourd’hui" lead="Ta journée, et qui répond à tes fans." />
      <div className="sc-today">
        <HerDay now={now} today={today} />
        <Fans now={now} today={today} />
      </div>
    </Page>
  );
}

/**
 * Her day from her agenda's week, the same read as Agenda's (her phone keeps it: offline too, CREA-04): the glance and
 * its way into Agenda, then « À décider » when the agency waits on her.
 */
function HerDay({ now, today }: { now: Date; today: string }): JSX.Element {
  const monday = mondayOf(today);
  const read = useAgenda(monday, addDays(monday, 6));
  const { agenda } = useWithPending(read.data);
  if (agenda === undefined)
    return read.isError ? (
      <ServerSilent
        text="Ton agenda n’a pas pu être lu. Il reste dans Agenda tel que ton téléphone l’a gardé."
        onRetry={() => {
          void read.refetch();
        }}
      />
    ) : (
      <Panel className="sc-fans">
        <div className="sc-skeleton" aria-hidden="true">
          <i />
          <i />
        </div>
      </Panel>
    );
  const plan = planOf(agenda, agenda.today);
  const waiting = agenda.suggestions.length;
  return (
    <>
      <Glance plan={plan} agenda={agenda} now={now} nowMinute={minuteOf(now, agenda.timeZone)}>
        <Link to="/agenda" className="nv-btn nv-btn--soft nv-btn--sm sc-day__open">
          Ouvrir l’agenda
        </Link>
      </Glance>
      {waiting === 0 ? null : (
        <section className="nv-plate sc-decide nv-enter">
          <div className="sc-decide__text">
            <h2 className="sc-fans__title">À décider</h2>
            <p className="sc-fans__line">
              {waiting > 1
                ? `${String(waiting)} propositions de l’agence attendent ta réponse cette semaine.`
                : 'Une proposition de l’agence attend ta réponse cette semaine.'}
            </p>
          </div>
          <Link to="/agenda" search={{ vue: 'semaine' }} className="nv-btn nv-btn--soft nv-btn--sm">
            Voir
          </Link>
        </section>
      )}
    </>
  );
}

/**
 * « Qui répond à tes fans »: who now, and until when; nobody now, then who starts and when, in one sentence (CREA-26:
 * « Léo à partir de 19 h 15 (dans 24 min), jusqu’à 23 h »), never the same shift said twice.
 */
function Fans({ now, today }: { now: Date; today: string }): JSX.Element {
  const onDuty = useCreatorOnDuty();
  const zone = readerZone();
  if (onDuty.isError)
    return (
      <Panel className="sc-fans">
        <h2 className="sc-fans__title">Qui répond à tes fans</h2>
        <p className="sc-fans__line">Le planning n’a pas pu être lu.</p>
        <button
          type="button"
          className="nv-btn nv-btn--plain nv-btn--sm sc-fans__retry"
          onClick={() => {
            void onDuty.refetch();
          }}
        >
          Réessayer
        </button>
      </Panel>
    );
  if (onDuty.data === undefined)
    return (
      <Panel className="sc-fans">
        <div className="sc-skeleton" aria-hidden="true">
          <i />
          <i />
        </div>
      </Panel>
    );
  const { current, next } = onDuty.data;
  const handles = handlesShown(onDuty.data);
  const [coming, ...later] = current.length === 0 ? next : [];
  const after = current.length === 0 ? later : next;
  return (
    <Panel className="sc-fans nv-enter">
      <h2 className="sc-fans__title">Qui répond à tes fans</h2>
      <p className="sc-fans__line">
        {current.length > 0 ? (
          <>
            En ce moment :{' '}
            <Names
              shifts={current}
              say={(shift) => `jusqu’à ${clockAt(shift.endsAt, zone)}`}
              handles={handles}
            />
            .
          </>
        ) : coming === undefined ? (
          'Personne n’est prévu dans les prochaines 24 heures.'
        ) : (
          <>
            <Names
              shifts={[coming]}
              say={(shift) => {
                const word = dayWordOf(shift.startsAt, zone, today);
                const day = dayOf(shift.startsAt, zone) === today ? '' : `${word.toLowerCase()} `;
                const until = untilOf(new Date(shift.startsAt).getTime() - now.getTime());
                return `${day}à partir de ${clockAt(shift.startsAt, zone)} (${until}), jusqu’à ${clockAt(shift.endsAt, zone)}`;
              }}
              handles={handles}
            />
            .
          </>
        )}
      </p>
      {after.length === 0 ? null : (
        <p className="sc-fans__line">
          Ensuite :{' '}
          <Names
            shifts={after}
            say={(shift) =>
              `${dayWordOf(shift.startsAt, zone, today).toLowerCase()} ${rangeAt(shift.startsAt, shift.endsAt, zone)}`
            }
            handles={handles}
          />
          .
        </p>
      )}
    </Panel>
  );
}

/** Her account is named only when several are on shift for her: one account goes without saying. */
const handlesShown = (list: { current: readonly CreatorOnDuty[]; next: readonly CreatorOnDuty[] }): boolean =>
  new Set([...list.current, ...list.next].map((shift) => shift.handle)).size > 1;

/** « **Iris** jusqu’à 18 h, **Théo** aujourd’hui 18 h – 0 h »: each name, then when. */
function Names({
  shifts,
  say,
  handles,
}: {
  shifts: readonly CreatorOnDuty[];
  say: (shift: CreatorOnDuty) => string;
  handles: boolean;
}): JSX.Element {
  return (
    <>
      {shifts.map((shift, index) => (
        <span key={`${shift.handle}-${shift.startsAt}`}>
          {index === 0 ? null : ', '}
          <b>{shift.displayName}</b> <span className="nv-num">{say(shift)}</span>
          {handles ? ` sur @${shift.handle}` : null}
        </span>
      ))}
    </>
  );
}
