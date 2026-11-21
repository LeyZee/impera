import {
  STEERING_LAPSED_DAYS,
  STEERING_PROFILE_MIN_SALES,
  type AgencySteering,
  type SteeringDaily,
  type SteeringDependency,
  type SteeringTraffic,
} from '@impera/contracts';
import { niceTicks } from '@impera/design-system';
import { useNavigate } from '@tanstack/react-router';
import type { JSX } from 'react';

import { FunnelPanel, type FunnelLabel } from '../Funnel';
import { CountUp, Section, type FloatingTip } from '../parts';

import { Comparable, Ring } from './AgencyInsights';
import { NotYours, useAgencySteering } from './api';
import { TOO_FEW_TO_CONCLUDE } from './period';
import { euros, exactEuros, shareOf, shortDay, shortEuros, type Slice } from './view';
import './steering.css';

import { Columns, Donut, Meter } from '@/shell/figures/figures';
import { Failure } from '@/shell/states';

/*
 * « Le pilotage » (ADR 0092, avenant du 21/11/2026): three cards, each tied to a decision the owner takes. The day's
 * objective (behind at 6 pm: push), traffic to money (the step that breaks says where to act), and the fans the revenue
 * hangs on (who to win back, whether to widen the base). Fixed windows, whatever the period read below.
 */

/** Whole euros on the cards: the cents are in the bars' tips. */
const wholeEuros = (cents: number): string => euros(Math.round(cents / 100) * 100);
const formatEuros = wholeEuros;
const formatCount = (value: number): string => Math.round(value).toLocaleString('fr-FR');

/** « Ça casse ici » needs enough fans in both windows to mean something (ADR 0092 § 5). */
const FUNNEL_MIN_FIRST = 30;

/**
 * The gauge of the day, the design system's donut against the day's target: today's revenue in the tone of the day,
 * the projection still to come as the same colour, lighter. Today's figure in its middle is the card's hero.
 */
function DayGauge({ daily }: { daily: SteeringDaily }): JSX.Element {
  const target = daily.targetMinor ?? Math.max(daily.averageMinor, daily.todayMinor, 1);
  const done = Math.min(target, Math.max(0, daily.todayMinor));
  const projected = Math.min(target, Math.max(done, daily.projectedMinor ?? done));
  const onTrack =
    daily.targetMinor !== null && (daily.projectedMinor ?? daily.todayMinor) >= daily.targetMinor;
  const colour =
    daily.targetMinor === null
      ? 'var(--nv-series-2)'
      : onTrack
        ? 'var(--nv-series-1)'
        : 'var(--nv-trend-down)';
  return (
    <div className="stg-gauge">
      <Donut
        label={`Aujourd’hui ${wholeEuros(daily.todayMinor)}${daily.targetMinor === null ? '' : ` sur ${wholeEuros(daily.targetMinor)}`}`}
        of={target}
        slices={[
          { key: 'done', colour, value: done },
          {
            key: 'ahead',
            colour: `color-mix(in oklab, ${colour} 35%, transparent)`,
            value: projected - done,
          },
        ]}
      >
        <CountUp className="nv-donut__value stg-gauge__value" value={daily.todayMinor} format={formatEuros} />
        <span className="nv-donut__sub">
          {daily.targetMinor === null ? 'aujourd’hui' : `sur ${wholeEuros(daily.targetMinor)}`}
        </span>
      </Donut>
    </div>
  );
}

/**
 * What the day says, in one sentence: on track, behind by how much, or why nothing is said yet. Only the tag carries the
 * tone (Design, 21/11): amber is a warning, never the colour of a sentence.
 */
function dayVerdict(daily: SteeringDaily): {
  readonly tag: string | null;
  readonly text: string;
  readonly tone: 'up' | 'down' | 'neutral';
} {
  if (daily.targetMinor === null)
    return {
      tag: null,
      text: 'Pose l’objectif du mois (période « Mois ») : celui du jour en découle.',
      tone: 'neutral',
    };
  if (daily.todayMinor >= daily.targetMinor)
    return { tag: 'Atteint', text: 'Objectif du jour tenu.', tone: 'up' };
  if (daily.projectedMinor === null)
    return {
      tag: null,
      text: 'Trop tôt, ou pas assez de ventes, pour estimer la fin de journée.',
      tone: 'neutral',
    };
  if (daily.projectedMinor >= daily.targetMinor)
    return { tag: 'En avance', text: 'En bonne voie pour l’objectif.', tone: 'up' };
  return {
    tag: 'En retard',
    text: `Il manquerait ${wholeEuros(daily.targetMinor - daily.projectedMinor)} au rythme habituel. C’est le moment de relancer.`,
    tone: 'down',
  };
}

/** The thirty days as bars, the target as a dashed line: a day held in ink, one missed on the pale track (Design, 21/11). */
function DayBars({ daily, tip }: { daily: SteeringDaily; tip: FloatingTip }): JSX.Element {
  const max = Math.max(1, daily.targetMinor ?? 0, ...daily.days.map((day) => day.revenueMinor));
  const ticks = niceTicks(max, 3);
  const top = ticks[ticks.length - 1] ?? max;
  const last = daily.days.length - 1;
  return (
    <div className="stg-bars">
      <Columns
        label="Chiffre d’affaires des 30 derniers jours face à l’objectif : flèches pour passer d’un jour à l’autre"
        top={top}
        ticks={ticks.map((value) => ({ value, text: shortEuros(value) }))}
        {...(daily.targetMinor === null ? {} : { mark: daily.targetMinor })}
        columns={daily.days.map((day, i) => {
          const held = daily.targetMinor === null ? null : day.revenueMinor >= daily.targetMinor;
          const today = i === last;
          const rows: [string, string][] = [['Chiffre d’affaires', exactEuros(day.revenueMinor)]];
          if (daily.targetMinor !== null) rows.push(['Objectif', exactEuros(daily.targetMinor)]);
          return {
            key: day.day,
            label: i % 7 === last % 7 ? shortDay(day.day) : '',
            says: `${shortDay(day.day)} : ${exactEuros(day.revenueMinor)}`,
            parts: [
              {
                key: 'revenue',
                colour: held === false ? 'var(--nv-series-3)' : 'var(--nv-series-1)',
                value: day.revenueMinor,
                // Today is still under way: hatched, like its key.
                ...(today ? { hatched: true } : {}),
              },
            ],
            handlers: tip.bind(
              {
                title: today ? `Aujourd’hui, ${shortDay(day.day)}` : shortDay(day.day),
                rows,
                ...(held === null || today ? {} : { aside: held ? 'Objectif tenu' : 'Objectif manqué' }),
              },
              { above: true },
            ),
          };
        })}
      />
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
            {verdict.tag === null ? null : <span className="stg-day__tag">{verdict.tag}</span>}
            {verdict.text}
          </p>
          <dl className="stg-figures">
            <div>
              <dt>
                {daily.projectedMinor === null ? null : (
                  <span className="stg-key" data-tone={verdict.tone} aria-hidden="true" />
                )}
                Fin de journée estimée
              </dt>
              <dd>{daily.projectedMinor === null ? '—' : wholeEuros(daily.projectedMinor)}</dd>
            </div>
            <div>
              <dt>Moyenne des 7 derniers jours</dt>
              <dd>{wholeEuros(daily.averageMinor)}</dd>
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
      {daily.targetMinor === null ? null : (
        <ul className="nv-keys stg-bars__keys" aria-label="Légende">
          <li>
            <span className="nv-key" style={{ '--_c': 'var(--nv-series-1)' }} aria-hidden="true" />
            Jour tenu
          </li>
          <li>
            <span className="nv-key" style={{ '--_c': 'var(--nv-series-3)' }} aria-hidden="true" />
            Jour manqué
          </li>
          <li>
            <span className="nv-key stg-bars__key-today" aria-hidden="true" />
            Aujourd’hui, en cours
          </li>
          <li>
            <span className="stg-bars__key-target" aria-hidden="true" />
            Objectif du jour
          </li>
        </ul>
      )}
      <DayBars daily={daily} tip={tip} />
    </div>
  );
}

/** The path's steps the server could count: a step it cannot read is left out, never drawn at zero. */
function trafficSteps(traffic: SteeringTraffic): {
  readonly labels: readonly FunnelLabel[];
  readonly counts: readonly number[];
  readonly before: readonly number[];
  readonly colours: readonly string[];
} {
  const steps: { label: FunnelLabel; now: number; then: number | null; colour: string }[] = [];
  if (traffic.newSubscribers !== null)
    steps.push({
      label: {
        name: 'Nouveaux abonnés',
        hint: 'gratuits et payants',
        meaning: 'Les abonnés arrivés sur les 30 derniers jours : c’est le trafic.',
      },
      now: traffic.newSubscribers,
      then: traffic.previous.newSubscribers,
      colour: 'var(--nv-series-2)',
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
      colour: 'var(--nv-kind-3)',
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
      colour: 'var(--nv-kind-1)',
    },
    {
      label: {
        name: 'Payeurs réguliers',
        hint: 'deux achats ou plus',
        meaning: 'Parmi ces nouveaux payeurs, ceux qui ont acheté au moins deux fois sur la période.',
      },
      now: traffic.regular,
      then: traffic.previous.regular,
      colour: 'var(--nv-series-1)',
    },
  );
  return {
    colours: steps.map((step) => step.colour),
    labels: steps.map((step) => step.label),
    counts: steps.map((step) => step.now),
    before: steps.map((step) => step.then ?? 0),
  };
}

function TrafficCard({ traffic, tip }: { traffic: SteeringTraffic; tip: FloatingTip }): JSX.Element {
  const { labels, counts, before, colours } = trafficSteps(traffic);
  if (counts.every((count) => count === 0))
    return <p className="nv-plate ins-empty">Aucun abonné ni acheteur lu sur les 30 derniers jours.</p>;
  // A comparison only when both windows hold enough fans at the top: a « Ça casse ici » on three fans is noise.
  const compared =
    (counts[0] ?? 0) >= FUNNEL_MIN_FIRST &&
    (before[0] ?? 0) >= FUNNEL_MIN_FIRST &&
    before.every((n) => n >= 0);
  const top = counts[0] ?? 0;
  const bought = traffic.firstPurchase;
  // The answer first (Charles, 21/11: read at a glance): how many of the traffic end up paying.
  const rate = top > 0 ? (bought / top) * 100 : null;
  return (
    <div className="nv-plate stg-traffic">
      <p className="stg-hero">
        <b className="stg-hero__figure">
          {rate === null
            ? String(bought)
            : `${rate.toLocaleString('fr-FR', { maximumFractionDigits: rate < 10 ? 1 : 0 })} %`}
        </b>
        <span className="stg-hero__words">
          {rate === null
            ? `fan${bought > 1 ? 's' : ''} ${bought > 1 ? 'ont' : 'a'} acheté pour la première fois`
            : `des nouveaux abonnés achètent : ${String(bought)} sur ${top.toLocaleString('fr-FR')}`}
        </span>
      </p>
      <FunnelPanel
        labels={labels}
        counts={counts}
        colours={colours}
        soft
        {...(compared ? { before } : {})}
        breakNote="La plus forte baisse face aux 30 jours d’avant : c’est ici qu’il faut agir."
        tip={tip}
      />
      <p className="stg-traffic__scale">Largeurs resserrées pour garder les petites étapes lisibles.</p>
      {traffic.wrote === null ? (
        <p className="ins-note" role="note">
          L’étape « Ont écrit » apparaîtra quand Impera lira les conversations (session Reveal capturée).
        </p>
      ) : null}
    </div>
  );
}

/**
 * The spread, as a big share and the words after it, once there are enough sales to say it (ADR 0092 § 5): the share
 * is said once, in the figure.
 */
function spreadHero(dependency: SteeringDependency): { readonly figure: string; readonly words: string } {
  const one = shareOf(dependency.topOneMinor, dependency.totalMinor);
  const five = shareOf(dependency.topOneMinor + dependency.nextFourMinor, dependency.totalMinor);
  if (dependency.totalMinor <= 0) return { figure: '—', words: 'Aucune vente sur les 30 derniers jours.' };
  if (dependency.sales < STEERING_PROFILE_MIN_SALES)
    return { figure: `${String(five)} %`, words: `du chiffre vient de cinq fans. ${TOO_FEW_TO_CONCLUDE}` };
  if (one >= 40)
    return {
      figure: `${String(one)} %`,
      words: 'du chiffre vient d’un seul fan : s’il part, ça se sent tout de suite.',
    };
  if (five >= 70)
    return {
      figure: `${String(five)} %`,
      words: 'du chiffre vient de cinq fans : très concentré, il faut élargir la base.',
    };
  if (five >= 45)
    return { figure: `${String(five)} %`, words: 'du chiffre vient de cinq fans : assez concentré.' };
  return { figure: `${String(five)} %`, words: 'du chiffre vient de cinq fans : bien réparti.' };
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
    { key: 'one', label: 'Le plus gros fan', colour: 'var(--nv-kind-2)', cents: dependency.topOneMinor },
    { key: 'four', label: 'Les 4 suivants', colour: 'var(--nv-series-2)', cents: dependency.nextFourMinor },
    { key: 'rest', label: 'Tous les autres', colour: 'var(--nv-series-other)', cents: dependency.restMinor },
  ].map((slice) => ({ ...slice, previousCents: slice.cents, sales: 0 }));
  const pending = dependency.sales < STEERING_PROFILE_MIN_SALES;
  const hero = spreadHero(dependency);
  const biggest = Math.max(1, ...dependency.lapsed.map((fan) => fan.spentMinor));
  return (
    <div className="stg-dep">
      {/* One subject, one card (Design, 21/11): the sentence titles it, the ring on the left, the figures on the right. */}
      <article className="nv-plate stg-dep__card" data-pending={pending ? '' : undefined}>
        <h3 className="nv-h3 stg-hero stg-dep__lead">
          <b className="stg-hero__figure">{hero.figure}</b>{' '}
          <span className="stg-hero__words">{hero.words}</span>
        </h3>
        <div className="stg-dep__body">
          {/* No comparison on this ring: its window is fixed, its slices say how the money spreads. */}
          <Comparable.Provider value={false}>
            <Ring title="Qui fait le chiffre" slices={slices} tip={tip} bare />
          </Comparable.Provider>
          <dl className="stg-figures stg-dep__figures">
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
              <dd>{dependency.medianMinor === null ? '—' : wholeEuros(dependency.medianMinor)}</dd>
            </div>
          </dl>
        </div>
      </article>
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
                  <span className="stg-lapsed__who">{several ? (names.get(fan.creatorId) ?? '') : ''}</span>
                  <span className="stg-lapsed__meter">
                    {/* What he spent against the biggest of them, in the colour of his rank's slice. */}
                    <Meter
                      percent={(fan.spentMinor / biggest) * 100}
                      colour={
                        i === 0 ? 'var(--nv-kind-2)' : i < 5 ? 'var(--nv-series-2)' : 'var(--nv-series-other)'
                      }
                    />
                  </span>
                  <span className="stg-lapsed__spent">{wholeEuros(fan.spentMinor)}</span>
                  <span className="stg-lapsed__since">{fan.daysSince} j</span>
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
