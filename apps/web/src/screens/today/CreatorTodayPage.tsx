import { DROP_CATEGORY_LABELS, type CreatorOnDuty } from '@impera/contracts';
import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import { DayHero } from './day-hero/DayHero';
import { HerFigures } from './her-figures/HerFigures';
import { HerLimits } from './her-limits/HerLimits';

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
import { DayCard } from '@/screens/agenda/DayCard';
import { Glance } from '@/screens/agenda/DayView';
import { FreshnessNote } from '@/screens/agenda/FreshnessNote';
import { useAgenda, useWithPending } from '@/screens/agenda/api';
import '@/screens/agenda/agenda.css';
import { planOf } from '@/screens/agenda/model';
import { useContent } from '@/screens/content/api';
import { CATEGORY_EMOJIS, dueNow, dueOf, toShoot, type ToShoot } from '@/screens/content/model';
import { Page, PageHeader, Panel } from '@/shell/layout';
import { Failure, Skeleton, SkeletonCard } from '@/shell/states';

import './creator-today.css';

/**
 * Aujourd'hui, the creator's (CR-02, ADR 0042 § 8): the page she opens in the morning (CREA-19). Where her day stands
 * and what to start with, as at the top of her Agenda; what the agency proposes and waits on her; what the agency asked
 * her to send that is due today or late (recette visuelle 16/11, CRE-01); then who answers her
 * fans, in one line, by their display name alone (ADR 0023: nothing else of the team). Her last sales come once CR-04
 * exists. Agenda stays where she plans; this page only reads. Read in her own time, the browser's.
 */
export function CreatorTodayPage(): JSX.Element {
  const now = useNow();
  const today = dayOf(now, readerZone());
  // Her agenda and who answers her fans are two reads of one server: when it is silent, the page says it once, on top,
  // and each card keeps quiet (recette visuelle 16/11, ETA-05).
  const monday = mondayOf(today);
  const day = useAgenda(monday, addDays(monday, 6));
  const onDuty = useCreatorOnDuty();
  const down = (day.isError && day.data === undefined) || onDuty.isError;
  return (
    <Page width="narrow">
      <PageHeader
        eyebrow={longDay(today)}
        title="Aujourd’hui"
        lead="Ce qu’on attend de toi aujourd’hui, puis tes chiffres."
      />
      <div className="sc-today">
        {down ? (
          <Failure
            onRetry={() => {
              void day.refetch();
              void onDuty.refetch();
            }}
          />
        ) : null}
        {/* The one big thing: all that is asked of her today, wherever it lives (Charles, 21/11). */}
        <DayHero today={today} />
        <DayCard />
        {/* What she owes next: an empty agenda under it is not a day off (recette visuelle 16/11, CRE-01). */}
        <ToSend today={today} />
        <HerDay now={now} today={today} quiet={down} />
        <HerFigures />
        <HerLimits today={today} />
        <Fans now={now} today={today} />
      </div>
    </Page>
  );
}

/**
 * Her day from her agenda's week, the same read as Agenda's (her phone keeps it: offline too, CREA-04): the glance and
 * its way into Agenda, then « À décider » when the agency waits on her.
 */
function HerDay({
  now,
  today,
  quiet,
}: {
  now: Date;
  today: string;
  /** The page says the server is silent: the card's own line about it keeps quiet. */
  quiet: boolean;
}): JSX.Element | null {
  const monday = mondayOf(today);
  const sunday = addDays(monday, 6);
  const read = useAgenda(monday, sunday);
  const { agenda } = useWithPending(read.data);
  const content = useContent().data;
  const owes = content !== undefined && dueNow(toShoot(content.requests, content.drops), today).length > 0;
  if (agenda === undefined)
    // The page says the server is silent, once (ETA-05).
    return read.isError ? null : (
      <Skeleton label="Chargement de ta journée…">
        <SkeletonCard lines={2} />
      </Skeleton>
    );
  const plan = planOf(agenda, agenda.today);
  const waiting = agenda.suggestions.length;
  // The glance counts today's; « À décider » the week's, saying how many of them are today's (CRE-05).
  const ofToday = plan.suggestions.length;
  return (
    <>
      {/* A copy kept on her phone says so: being updated, or old, and why (CRE-02). */}
      <FreshnessNote read={read} from={monday} to={sunday} quiet={quiet} />
      <Glance plan={plan} agenda={agenda} now={now} nowMinute={minuteOf(now, agenda.timeZone)} owes={owes}>
        <Link to="/agenda" className="nv-btn nv-btn--soft nv-btn--sm sc-day__open">
          Ouvrir l’agenda
        </Link>
      </Glance>
      {waiting === 0 ? null : (
        <section className="nv-plate sc-decide nv-enter">
          <div className="sc-decide__text">
            <h2 className="nv-h2 sc-fans__title">À décider</h2>
            <p className="sc-fans__line">
              {waiting > 1
                ? `${String(waiting)} propositions de l’agence attendent ta réponse cette semaine`
                : 'Une proposition de l’agence attend ta réponse cette semaine'}
              {ofToday === 0 || waiting === 1
                ? '.'
                : ofToday === waiting
                  ? ', toutes pour aujourd’hui.'
                  : `, dont ${String(ofToday)} pour aujourd’hui.`}
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

/** What the morning card shows of what is due, at most: the rest is counted, Contenu lists it. */
const TO_SEND_SHOWN = 2;

/**
 * « À envoyer » (recette visuelle 16/11, CRE-01): the requests of the agency due today or late, the late first, two
 * lines at most, and « Déposer », the page's one neon, which opens Contenu's sheet on the first. Nothing at all while
 * nothing is due, or while Contenu is not read: Contenu says when its server is silent, this page does not twice.
 */
function ToSend({ today }: { today: string }): JSX.Element | null {
  const content = useContent();
  if (content.data === undefined) return null;
  const due = dueNow(toShoot(content.data.requests, content.data.drops), today);
  const [first] = due;
  if (first === undefined) return null;
  const rest = due.length - TO_SEND_SHOWN;
  return (
    <section className="nv-plate sc-send nv-enter" aria-labelledby="sc-send-title">
      <h2 id="sc-send-title" className="nv-h2">
        À envoyer
      </h2>
      <ul className="sc-send__list">
        {due.slice(0, TO_SEND_SHOWN).map((item) => (
          <SendLine key={item.kind === 'script' ? item.drop.id : item.request.id} item={item} today={today} />
        ))}
      </ul>
      {rest > 0 ? (
        <p className="sc-send__more">
          {rest > 1 ? `Et ${String(rest)} autres dans Contenu.` : 'Et une autre dans Contenu.'}
        </p>
      ) : null}
      <SendAction item={first} alone={due.length === 1} />
    </section>
  );
}

function SendLine({ item, today }: { item: ToShoot; today: string }): JSX.Element | null {
  const { request } = item;
  if (request === null) return null;
  const due = dueOf(request.dueOn, today);
  return (
    <li className="sc-send__line">
      <span aria-hidden="true">{CATEGORY_EMOJIS[request.category]}</span>
      <b>{DROP_CATEGORY_LABELS[request.category]}</b>
      <span className={due.late ? 'sc-send__due sc-send__due--late' : 'sc-send__due'}>{due.text}</span>
    </li>
  );
}

/**
 * The first one's way: « Déposer » opens Contenu's sheet on its request; a script is begun or continued card by card
 * from its own page, so it opens Contenu, or the script she began.
 */
function SendAction({ item, alone }: { item: ToShoot; alone: boolean }): JSX.Element {
  const className = 'nv-btn nv-btn--neon nv-btn--sm sc-send__go';
  if (item.kind === 'script')
    return (
      <Link to="/contenu/script/$dropId" params={{ dropId: item.drop.id }} className={className}>
        Continuer
      </Link>
    );
  const { request } = item;
  return request.category === 'script' && request.structureVersionId !== null ? (
    <Link to="/contenu" className={className}>
      Ouvrir Contenu
    </Link>
  ) : (
    <Link to="/contenu" search={{ demande: request.id }} className={className}>
      {alone ? 'Déposer' : 'Déposer la première'}
    </Link>
  );
}

/**
 * « Qui répond à tes fans »: who now, and until when; nobody now, then who starts and when, in one sentence (CREA-26:
 * « Léo à partir de 19 h 15 (dans 24 min), jusqu’à 23 h »), never the same shift said twice.
 */
function Fans({ now, today }: { now: Date; today: string }): JSX.Element | null {
  const onDuty = useCreatorOnDuty();
  const zone = readerZone();
  // The page says the server is silent, once (ETA-05).
  if (onDuty.isError) return null;
  if (onDuty.data === undefined)
    return (
      <Skeleton label="Chargement de qui répond à tes fans…">
        <SkeletonCard lines={1} />
      </Skeleton>
    );
  const { current, next } = onDuty.data;
  const handles = handlesShown(onDuty.data);
  const [coming, ...later] = current.length === 0 ? next : [];
  const after = current.length === 0 ? later : next;
  return (
    <Panel className="sc-fans nv-enter">
      <h2 className="nv-h2 sc-fans__title">Qui répond à tes fans</h2>
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
