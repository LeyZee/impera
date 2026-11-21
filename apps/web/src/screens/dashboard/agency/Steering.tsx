import {
  STEERING_LAPSED_DAYS,
  STEERING_PROFILE_MIN_SALES,
  type AgencySteering,
  type SteeringDaily,
  type SteeringDependency,
  type SteeringTraffic,
} from '@impera/contracts';
import { useNavigate } from '@tanstack/react-router';
import type { JSX } from 'react';

import { FunnelPanel, type FunnelLabel } from '../Funnel';
import { CountUp, Section, type FloatingTip } from '../parts';

import { Comparable, Ring } from './AgencyInsights';
import { NotYours, useAgencySteering } from './api';
import { TOO_FEW_TO_CONCLUDE } from './period';
import { euros, exactEuros, shareOf, shortDay, type Slice } from './view';
import './steering.css';

import { Failure } from '@/shell/states';

/*
 * « Le pilotage » (ADR 0092, avenant du 21/11/2026): three cards, each tied to a decision the owner takes. The day's
 * objective (behind at 6 pm: push), traffic to money (the step that breaks says where to act), and the fans the revenue
 * hangs on (who to win back, whether to widen the base). Fixed windows, whatever the period read below.
 */

const formatEuros = (cents: number): string => euros(Math.round(cents));
const formatCount = (value: number): string => Math.round(value).toLocaleString('fr-FR');

/** « Ça casse ici » needs enough fans in both windows to mean something (ADR 0092 § 5). */
const FUNNEL_MIN_FIRST = 30;

/** The gauge of the day: today's revenue towards the target, its projection as a lighter arc. */
function DayGauge({ daily }: { daily: SteeringDaily }): JSX.Element {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const target = daily.targetMinor ?? Math.max(daily.averageMinor, daily.todayMinor, 1);
  const done = Math.min(1, Math.max(0, daily.todayMinor / target));
  const projected = daily.projectedMinor === null ? done : Math.min(1, daily.projectedMinor / target);
  const onTrack =
    daily.targetMinor !== null && (daily.projectedMinor ?? daily.todayMinor) >= daily.targetMinor;
  const tone = daily.targetMinor === null ? 'neutral' : onTrack ? 'up' : 'down';
  return (
    <div className="stg-gauge" data-tone={tone} aria-hidden="true">
      <svg viewBox="0 0 132 132">
        <circle className="stg-gauge__track" cx="66" cy="66" r={radius} />
        {projected > done ? (
          <circle
            className="stg-gauge__ghost"
            cx="66"
            cy="66"
            r={radius}
            style={{ '--_dash': `${String(projected * circumference)} ${String(circumference)}` }}
          />
        ) : null}
        <circle
          className="stg-gauge__arc"
          cx="66"
          cy="66"
          r={radius}
          style={{ '--_dash': `${String(done * circumference)} ${String(circumference)}` }}
        />
      </svg>
      <span className="stg-gauge__middle">
        <CountUp className="stg-gauge__value" value={daily.todayMinor} format={formatEuros} />
        <span className="stg-gauge__sub">
          {daily.targetMinor === null ? 'aujourd’hui' : `sur ${euros(daily.targetMinor)}`}
        </span>
      </span>
    </div>
  );
}

/** What the day says, in one sentence: on track, behind by how much, or why nothing is said yet. */
function dayVerdict(daily: SteeringDaily): {
  readonly text: string;
  readonly tone: 'up' | 'down' | 'neutral';
} {
  if (daily.targetMinor === null)
    return {
      text: 'Pose l’objectif du mois (période « Mois ») : celui du jour en découle.',
      tone: 'neutral',
    };
  if (daily.todayMinor >= daily.targetMinor) return { text: 'Objectif du jour atteint.', tone: 'up' };
  if (daily.projectedMinor === null)
    return { text: 'Trop tôt, ou pas assez de ventes, pour estimer la fin de journée.', tone: 'neutral' };
  if (daily.projectedMinor >= daily.targetMinor)
    return { text: 'En bonne voie pour l’objectif.', tone: 'up' };
  return {
    text: `En retard : il manquerait ${euros(daily.targetMinor - daily.projectedMinor)} au rythme habituel. C’est le moment de relancer.`,
    tone: 'down',
  };
}

/** The thirty days as bars, the target as a dashed line: a day held in the trend's colour, one missed in amber. */
function DayBars({ daily, tip }: { daily: SteeringDaily; tip: FloatingTip }): JSX.Element {
  const top = Math.max(1, daily.targetMinor ?? 0, ...daily.days.map((day) => day.revenueMinor));
  const last = daily.days.length - 1;
  return (
    <div className="stg-bars" role="group" aria-label="Chiffre d’affaires des 30 derniers jours">
      {daily.targetMinor === null ? null : (
        <span
          className="stg-bars__target"
          style={{ '--_y': `${String((daily.targetMinor / top) * 100)}%` }}
          aria-hidden="true"
        />
      )}
      {daily.days.map((day, i) => {
        const held = daily.targetMinor === null ? null : day.revenueMinor >= daily.targetMinor;
        const today = i === last;
        const rows: [string, string][] = [['Chiffre d’affaires', exactEuros(day.revenueMinor)]];
        if (daily.targetMinor !== null) rows.push(['Objectif', exactEuros(daily.targetMinor)]);
        return (
          <button
            key={day.day}
            type="button"
            className="stg-bars__day"
            data-held={held === null ? undefined : String(held)}
            data-today={today ? '' : undefined}
            style={{ '--_h': `${String(Math.max(2, (day.revenueMinor / top) * 100))}%`, '--_i': i }}
            aria-label={`${shortDay(day.day)} : ${exactEuros(day.revenueMinor)}`}
            {...tip.bind({
              title: today ? `Aujourd’hui, ${shortDay(day.day)}` : shortDay(day.day),
              rows,
              ...(held === null || today ? {} : { aside: held ? 'Objectif tenu' : 'Objectif manqué' }),
            })}
          >
            <span className="stg-bars__bar" />
          </button>
        );
      })}
    </div>
  );
}

function DayCard({ daily, tip }: { daily: SteeringDaily; tip: FloatingTip }): JSX.Element {
  const verdict = dayVerdict(daily);
  const past = daily.days.slice(0, -1);
  const held =
    daily.targetMinor === null
      ? null
      : past.filter((day) => day.revenueMinor >= (daily.targetMinor ?? 0)).length;
  return (
    <div className="nv-plate stg-day">
      <div className="stg-day__head">
        <DayGauge daily={daily} />
        <div className="stg-day__words">
          <p className="stg-day__verdict" data-tone={verdict.tone}>
            {verdict.text}
          </p>
          <dl className="stg-figures">
            <div>
              <dt>Fin de journée estimée</dt>
              <dd>{daily.projectedMinor === null ? '—' : euros(daily.projectedMinor)}</dd>
            </div>
            <div>
              <dt>Moyenne des 7 derniers jours</dt>
              <dd>{euros(daily.averageMinor)}</dd>
            </div>
            {held === null ? null : (
              <div>
                <dt>Jours tenus sur les {String(past.length)} derniers</dt>
                <dd>{String(held)}</dd>
              </div>
            )}
          </dl>
        </div>
      </div>
      <DayBars daily={daily} tip={tip} />
    </div>
  );
}

/** The path's steps the server could count: a step it cannot read is left out, never drawn at zero. */
function trafficSteps(traffic: SteeringTraffic): {
  readonly labels: readonly FunnelLabel[];
  readonly counts: readonly number[];
  readonly before: readonly number[];
} {
  const steps: { label: FunnelLabel; now: number; then: number | null }[] = [];
  if (traffic.newSubscribers !== null)
    steps.push({
      label: {
        name: 'Nouveaux abonnés',
        hint: 'gratuits et payants, lus chez Reveal',
        meaning: 'Les abonnés arrivés sur les 30 derniers jours : c’est le trafic.',
      },
      now: traffic.newSubscribers,
      then: traffic.previous.newSubscribers,
    });
  if (traffic.wrote !== null)
    steps.push({
      label: {
        name: 'Ont écrit',
        hint: 'premier message du fan',
        meaning:
          'Les fans dont le premier message est arrivé sur la période, dans les conversations lues par Impera.',
      },
      now: traffic.wrote,
      then: traffic.previous.wrote,
    });
  steps.push(
    {
      label: {
        name: '1er achat',
        hint: 'premier achat de leur vie ici',
        meaning:
          'Les fans qui ont acheté pour la première fois sur la période, lus dans le registre des ventes.',
      },
      now: traffic.firstPurchase,
      then: traffic.previous.firstPurchase,
    },
    {
      label: {
        name: 'Payeurs réguliers',
        hint: 'deux achats ou plus',
        meaning: 'Parmi ces nouveaux payeurs, ceux qui ont acheté au moins deux fois sur la période.',
      },
      now: traffic.regular,
      then: traffic.previous.regular,
    },
  );
  return {
    labels: steps.map((step) => step.label),
    counts: steps.map((step) => step.now),
    before: steps.map((step) => step.then ?? 0),
  };
}

function TrafficCard({ traffic, tip }: { traffic: SteeringTraffic; tip: FloatingTip }): JSX.Element {
  const { labels, counts, before } = trafficSteps(traffic);
  if (counts.every((count) => count === 0))
    return <p className="nv-plate ins-empty">Aucun abonné ni acheteur lu sur les 30 derniers jours.</p>;
  // A comparison only when both windows hold enough fans at the top: a « Ça casse ici » on three fans is noise.
  const compared =
    (counts[0] ?? 0) >= FUNNEL_MIN_FIRST &&
    (before[0] ?? 0) >= FUNNEL_MIN_FIRST &&
    before.every((n) => n >= 0);
  return (
    <div className="stg-traffic">
      <FunnelPanel
        labels={labels}
        counts={counts}
        {...(compared ? { before } : {})}
        breakNote="La plus forte baisse face aux 30 jours d’avant : c’est ici qu’il faut agir."
        tip={tip}
      />
      {traffic.wrote === null ? (
        <p className="ins-note" role="note">
          L’étape « Ont écrit » apparaîtra quand Impera lira les conversations (session Reveal capturée).
        </p>
      ) : null}
    </div>
  );
}

/** One sentence on the spread, once there are enough sales to say it (ADR 0092 § 5). */
function spreadText(dependency: SteeringDependency): string {
  if (dependency.sales < STEERING_PROFILE_MIN_SALES) return TOO_FEW_TO_CONCLUDE;
  const one = shareOf(dependency.topOneMinor, dependency.totalMinor);
  const five = shareOf(dependency.topOneMinor + dependency.nextFourMinor, dependency.totalMinor);
  if (one >= 40) return `Un seul fan fait ${String(one)} % du chiffre : s’il part, ça se sent tout de suite.`;
  if (five >= 70)
    return `Cinq fans font ${String(five)} % du chiffre : très concentré, il faut élargir la base.`;
  if (five >= 45) return `Cinq fans font ${String(five)} % du chiffre : assez concentré.`;
  return 'Bien réparti : le chiffre ne dépend pas de quelques fans.';
}

function DependencyCard({
  steering,
  opensTracking,
  tip,
}: {
  steering: AgencySteering;
  opensTracking: boolean;
  tip: FloatingTip;
}): JSX.Element {
  const { dependency } = steering;
  const navigate = useNavigate();
  const names = new Map(steering.creators.map((one) => [one.creatorId, one.name] as const));
  const several = steering.creators.length >= 2;
  const slices: Slice[] = [
    { key: 'one', label: 'Le plus gros fan', colour: 'var(--nv-kind-1)', cents: dependency.topOneMinor },
    { key: 'four', label: 'Les 4 suivants', colour: 'var(--nv-kind-3)', cents: dependency.nextFourMinor },
    { key: 'rest', label: 'Tous les autres', colour: 'var(--nv-series-other)', cents: dependency.restMinor },
  ].map((slice) => ({ ...slice, previousCents: slice.cents, sales: 0 }));
  const pending = dependency.sales < STEERING_PROFILE_MIN_SALES;
  return (
    <div className="stg-dep">
      <div className="stg-dep__top">
        {/* No comparison on this ring: its window is fixed, its slices say how the money spreads. */}
        <Comparable.Provider value={false}>
          <Ring title="Qui fait le chiffre" slices={slices} tip={tip} />
        </Comparable.Provider>
        <div className="nv-plate stg-dep__figures" data-pending={pending ? '' : undefined}>
          <p className="stg-dep__lead">{spreadText(dependency)}</p>
          <dl className="stg-figures">
            <div>
              <dt>Fans qui ont payé</dt>
              <dd>
                <CountUp value={dependency.payingFans} format={formatCount} />
              </dd>
            </div>
            <div>
              <dt>Font 80 % du chiffre</dt>
              <dd>
                {dependency.fansForEighty === 0
                  ? '—'
                  : `${String(dependency.fansForEighty)} fan${dependency.fansForEighty > 1 ? 's' : ''}`}
              </dd>
            </div>
            <div>
              <dt>Dépense du fan médian</dt>
              <dd>{dependency.medianMinor === null ? '—' : euros(dependency.medianMinor)}</dd>
            </div>
          </dl>
        </div>
      </div>
      <article className="nv-plate stg-lapsed">
        <h3 className="nv-h3 ins-card__title">
          Ont décroché
          <span className="stg-lapsed__sub">
            rien acheté depuis {String(STEERING_LAPSED_DAYS)} jours ou plus
          </span>
        </h3>
        {dependency.lapsed.length === 0 ? (
          <p className="stg-lapsed__none">
            Aucun payeur n’a décroché : tous ont acheté ces dernières semaines.
          </p>
        ) : (
          <ul className="stg-lapsed__list">
            {dependency.lapsed.map((fan, i) => {
              const conversation = fan.conversationId;
              const open =
                opensTracking && conversation !== null
                  ? () => void navigate({ to: '/suivi', search: { conversation, creatrice: fan.creatorId } })
                  : undefined;
              const body = (
                <>
                  <span className="stg-lapsed__name">{fan.fanName}</span>
                  {several ? <span className="stg-lapsed__who">{names.get(fan.creatorId) ?? ''}</span> : null}
                  <span className="stg-lapsed__spent">{euros(fan.spentMinor)}</span>
                  <span className="stg-lapsed__since">
                    {fan.daysSince} j
                    <span className="stg-lapsed__day"> · {shortDay(fan.lastPurchaseDay)}</span>
                  </span>
                </>
              );
              return (
                <li key={`${fan.creatorId}:${fan.fanName}:${String(i)}`} style={{ '--_i': i }}>
                  {open === undefined ? (
                    <div className="stg-lapsed__row">{body}</div>
                  ) : (
                    <button
                      type="button"
                      className="stg-lapsed__row is-link"
                      onClick={open}
                      aria-label={`Ouvrir la conversation de ${fan.fanName}`}
                    >
                      {body}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </article>
    </div>
  );
}

/**
 * The steering's three cards, above the figures of the period. Nothing for an account whose scope is its own, the
 * shape of the cards while they load.
 */
export function SteeringPanel({
  creatorId,
  opensTracking,
  tip,
  index = 1,
}: {
  creatorId: string | null;
  /** The account opens Suivi: a lapsed payer's line leads to his conversation. */
  opensTracking: boolean;
  tip: FloatingTip;
  index?: number;
}): JSX.Element | null {
  const query = useAgencySteering(creatorId);
  if (query.error instanceof NotYours) return null;
  if (query.data === undefined) {
    return (
      <Section title="Objectif du jour" sub="le chiffre d’affaires d’aujourd’hui" index={index}>
        {query.isError ? (
          <Failure onRetry={() => void query.refetch()} />
        ) : (
          <div
            className="db-loading nv-plate stg-loading"
            role="status"
            aria-busy="true"
            aria-label="Chargement"
          />
        )}
      </Section>
    );
  }
  const steering = query.data;
  if (steering.creators.length === 0) return null;
  return (
    <div className="stg-body" aria-busy={query.isPlaceholderData}>
      <Section
        title="Objectif du jour"
        sub="le chiffre d’affaires d’aujourd’hui face à l’objectif du mois divisé par ses jours"
        index={index}
      >
        <DayCard daily={steering.daily} tip={tip} />
      </Section>
      <Section
        title="Du trafic à l’argent"
        sub="les 30 derniers jours, comparés aux 30 d’avant"
        index={index + 1}
      >
        <TrafficCard traffic={steering.traffic} tip={tip} />
      </Section>
      <Section
        title="Dépendance aux gros fans"
        sub="les 30 derniers jours, remboursements déduits ; nommés pour l’agence seulement"
        index={index + 2}
      >
        <DependencyCard steering={steering} opensTracking={opensTracking} tip={tip} />
      </Section>
      {steering.dollarsLeftOut ? (
        <p className="ins-note" role="note">
          Des ventes en dollars sont laissées de côté : aucun taux de change n’est encore connu (Équipe ›
          Paie).
        </p>
      ) : null}
    </div>
  );
}
