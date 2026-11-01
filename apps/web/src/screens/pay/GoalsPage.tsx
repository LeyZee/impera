import {
  collectiveGoalWindow,
  payPeriodLastDay,
  type BonusTierSet,
  type CollectiveGoal,
  type Me,
  type PayPeriod,
  type PayrollPeriod,
} from '@nirvana/contracts';
import { useState, type JSX } from 'react';

import { GoalDialog, TiersDialog } from './GoalForms';
import { PayNav } from './PayNav';
import { useAgencyToday, useCurrentPeriod, usePayNames } from './data';
import { Gauge, GoalTicks, Loading, LockIcon, PeriodArrows, PeriodHeading, Unreachable } from './parts';

import { usePayPeriod } from '@/payroll/api';
import {
  bonusTiersInOrder,
  forecastNet,
  gaugePercent,
  goalReachedBps,
  goalSpanBps,
  goalTiersInOrder,
  lateNetOf,
  momentAt,
  reachedBpsOf,
  rulePeriods,
  teamNetOf,
  tierAt,
  whoName,
} from '@/payroll/model';
import '@/payroll/pay.css';
import '@/reports/reports.css';
import { amountText, followingPeriod, percentText, periodLine, signedAmountText } from '@/reports/model';
import '@/scheduling/scheduling.css';
import { longDay } from '@/scheduling/time';
import { useNow } from '@/scheduling/useNow';
import '@/screens/team/team.css';
import { Page, PageHeader, Panel } from '@/shell/layout';

/** How many periods ahead new tiers may start. */
const TIER_PERIODS = 4;

/**
 * Paie › Objectifs (EQ-05, ADR 0024): the period's collective goal — its target, its tiers on the gauge, where the
 * team is and where it heads — then the individual tiers in force and the period they started with. The owner changes
 * them for a period not validated yet; a manager reads them. The gauge is the screen's one neon.
 */
export function GoalsPage({
  user,
  chosen,
  onPeriod,
}: {
  user: Me;
  chosen: PayPeriod | null;
  onPeriod: (period: PayPeriod | null) => void;
}): JSX.Element {
  const owner = user.role === 'owner';
  const me = { id: user.id, name: user.name };
  const now = useNow();
  const current = useCurrentPeriod();
  const today = useAgencyToday();
  const period = chosen ?? current;
  const read = usePayPeriod(period);
  const after = usePayPeriod(period === null ? null : followingPeriod(period));
  const names = usePayNames(period, true);
  const [editing, setEditing] = useState<
    | { readonly kind: 'goal'; readonly period: PayPeriod; readonly goal: CollectiveGoal | null }
    | { readonly kind: 'tiers' }
    | null
  >(null);

  const data = read.data?.period === period ? read.data : undefined;
  const next = period !== null && after.data?.period === followingPeriod(period) ? after.data : undefined;
  const who = (userId: string): string => whoName(userId, me, names.members);
  // PAIE-22: tiers start with a period that has not begun, as a rate; a goal is set until its period's 3rd day.
  const tierPeriods: PayPeriod[] = today === null ? [] : rulePeriods(today, TIER_PERIODS);
  const goalWindow = (one: PayPeriod) => (today === null ? 'closed' : collectiveGoalWindow(one, today));

  const head = (
    <PageHeader
      eyebrow="Paie"
      title={period === null ? 'Objectifs' : <PeriodHeading period={period} />}
      lead="Ce que l’équipe vise ensemble, et ce que chacun débloque seul."
      actions={
        <>
          {period === null ? null : <PeriodArrows period={period} current={current} onPeriod={onPeriod} />}
          <PayNav />
        </>
      }
    />
  );

  if (period === null || (data === undefined && !read.isError))
    return (
      <Page>
        {head}
        <div className="py-board">
          <Panel>
            <Loading rows={1} />
          </Panel>
          <Panel>
            <Loading rows={1} />
          </Panel>
        </div>
      </Page>
    );
  if (data === undefined)
    return (
      <Page>
        {head}
        <div className="py-board">
          <Panel eyebrow="Objectif collectif">
            <Unreachable
              what="la quinzaine"
              onRetry={() => {
                void read.refetch();
              }}
            />
          </Panel>
        </div>
      </Page>
    );

  const { closing } = data;
  const open = closing === null;
  const zone = data.window?.timeZone ?? null;
  const goal = data.collectiveGoal;

  return (
    <Page>
      {head}
      <div className="py-board">
        <Panel
          className="nv-enter"
          eyebrow="Objectif collectif"
          title={
            goal === null
              ? 'Pas d’objectif collectif'
              : `${amountText(goal.targetMinor, 'EUR')} de net pour l’équipe`
          }
        >
          <div className="rp-sec">
            {goal === null ? (
              <div className="py-empty">
                <p className="py-empty__whisper">
                  Pas d’objectif sur la quinzaine {periodLine(data.period)}.
                </p>
                <p className="py-empty__text">
                  {!open
                    ? 'La quinzaine est close : son objectif ne change plus.'
                    : goalWindow(data.period) === 'closed'
                      ? 'L’objectif d’une quinzaine se pose au plus tard son 3e jour : celle-ci n’en aura pas.'
                      : owner
                        ? 'Une cible de net pour l’équipe et ses paliers : chaque chatteur touche la prime du plus haut palier atteint.'
                        : 'Le propriétaire pose l’objectif d’une quinzaine.'}
                </p>
                {owner && open && goalWindow(data.period) !== 'closed' ? (
                  <button
                    type="button"
                    className="nv-btn nv-btn--soft"
                    onClick={() => {
                      setEditing({ kind: 'goal', period: data.period, goal: null });
                    }}
                  >
                    Poser l’objectif
                  </button>
                ) : null}
              </div>
            ) : (
              <GoalGauge data={data} goal={goal} now={now} />
            )}
            {goal === null ? null : (
              <p className="py-quiet">
                La prime va à chaque chatteur, ventes ou pas. Les ventes des managers comptent dans le net ;
                ils ne touchent pas la prime.
              </p>
            )}
            {goal === null ? null : (
              <div className="py-goal__foot">
                {closing === null ? (
                  <p className="py-quiet">
                    Posé{zone === null ? '' : ` le ${momentAt(goal.createdAt, zone)}`} par{' '}
                    {who(goal.createdBy)}.
                  </p>
                ) : (
                  <p className="py-quiet py-lock">
                    <LockIcon />
                    <span>
                      Close{zone === null ? '' : ` le ${momentAt(closing.closedAt, zone)}`} : l’objectif de
                      cette quinzaine ne change plus.
                    </span>
                  </p>
                )}
                {owner && open && goalWindow(data.period) !== 'closed' ? (
                  <button
                    type="button"
                    className="nv-btn nv-btn--soft nv-btn--sm"
                    onClick={() => {
                      setEditing({ kind: 'goal', period: data.period, goal });
                    }}
                  >
                    Changer
                  </button>
                ) : null}
              </div>
            )}
            {period === current && next !== undefined && (owner || next.collectiveGoal !== null) ? (
              <details className="nv-disclosure py-fold">
                <summary>
                  <span className="nv-disclosure__title">Quinzaine {periodLine(next.period)}</span>
                  <span className="nv-disclosure__sum nv-num">
                    {next.collectiveGoal === null
                      ? 'pas encore d’objectif'
                      : `${amountText(next.collectiveGoal.targetMinor, 'EUR')}, ${goalTiersLine(next.collectiveGoal)}`}
                  </span>
                </summary>
                <div className="nv-disclosure__body py-fold__body">
                  {owner ? (
                    <button
                      type="button"
                      className="nv-btn nv-btn--soft nv-btn--sm"
                      onClick={() => {
                        setEditing({ kind: 'goal', period: next.period, goal: next.collectiveGoal });
                      }}
                    >
                      {next.collectiveGoal === null ? 'Poser l’objectif' : 'Changer'}
                    </button>
                  ) : next.collectiveGoal === null ? null : (
                    <p className="py-quiet">Posé par {who(next.collectiveGoal.createdBy)}.</p>
                  )}
                </div>
              </details>
            ) : null}
          </div>
        </Panel>
        <TiersPanel
          set={data.bonusTiers}
          later={next?.bonusTiers ?? null}
          laterPeriod={next?.period ?? null}
          owner={owner && tierPeriods.length > 0}
          onChange={() => {
            setEditing({ kind: 'tiers' });
          }}
        />
      </div>
      {editing?.kind === 'goal' ? (
        <GoalDialog
          period={editing.period}
          started={goalWindow(editing.period) === 'started'}
          goal={editing.goal}
          onClose={() => {
            setEditing(null);
          }}
        />
      ) : editing?.kind === 'tiers' && tierPeriods[0] !== undefined ? (
        <TiersDialog
          periods={tierPeriods}
          first={tierPeriods.includes(data.period) ? data.period : tierPeriods[0]}
          set={data.bonusTiers}
          onClose={() => {
            setEditing(null);
          }}
        />
      ) : null}
    </Page>
  );
}

/** « 2 paliers, de 80 % à 100 % »: a goal's tiers in a few words. */
function goalTiersLine(goal: CollectiveGoal): string {
  const tiers = goalTiersInOrder(goal.tiers);
  const [first] = tiers;
  const last = tiers.at(-1);
  if (first === undefined || last === undefined) return 'sans palier';
  return tiers.length === 1
    ? `un palier à ${percentText(first.reachedBps)}`
    : `${String(tiers.length)} paliers, de ${percentText(first.reachedBps)} à ${percentText(last.reachedBps)}`;
}

/** Where the team is on its goal, and while the period runs, where it heads; each tier on the gauge. */
function GoalGauge({
  data,
  goal,
  now,
}: {
  data: PayrollPeriod;
  goal: CollectiveGoal;
  now: Date;
}): JSX.Element {
  const net = teamNetOf(data.statements);
  const reached = goalReachedBps(data, goal);
  const span = goalSpanBps(goal);
  const forecast =
    data.ended || data.window === null
      ? null
      : forecastNet(net, lateNetOf(data.statements), data.window, now);
  const forecastBps = forecast === null ? null : reachedBpsOf(forecast, goal.targetMinor);
  const tier = tierAt(goal.tiers, reached);
  const ahead = forecastBps === null ? null : tierAt(goal.tiers, forecastBps);
  const lastDay = payPeriodLastDay(data.period);
  return (
    <div className="py-goal">
      <div className="py-goal__top">
        <p className="py-goal__value nv-num">
          {amountText(net, 'EUR')}{' '}
          <small>
            {percentText(Math.floor(reached / 100) * 100)} {data.ended ? 'atteint' : 'à ce jour'}
          </small>
        </p>
        <p className="py-quiet nv-num">
          {forecast === null || forecastBps === null
            ? tier === null
              ? 'aucun palier atteint'
              : `palier ${percentText(tier.reachedBps)} : ${signedAmountText(tier.bonusMinor, 'EUR')} par chatteur`
            : `prévu le ${longDay(lastDay)} : ${amountText(forecast, 'EUR')}, ${percentText(Math.floor(forecastBps / 100) * 100)}${
                ahead === null ? '' : `, ${signedAmountText(ahead.bonusMinor, 'EUR')} par chatteur`
              }`}
        </p>
      </div>
      <Gauge
        neon
        value={gaugePercent(reached, span)}
        mark={forecastBps === null ? null : gaugePercent(forecastBps, span)}
      />
      <GoalTicks
        tiers={goal.tiers}
        span={span}
        reached={reached}
        title={(one) =>
          `À ${percentText(one.reachedBps)} de ${amountText(goal.targetMinor, 'EUR')}, soit ${amountText(Math.ceil((goal.targetMinor * one.reachedBps) / 10_000), 'EUR')} de net : ${signedAmountText(one.bonusMinor, 'EUR')} par chatteur`
        }
      />
    </div>
  );
}

/** The individual tiers in force for the period, and those that come after it when the owner changed them. */
function TiersPanel({
  set,
  later,
  laterPeriod,
  owner,
  onChange,
}: {
  set: BonusTierSet | null;
  later: BonusTierSet | null;
  laterPeriod: PayPeriod | null;
  owner: boolean;
  onChange: () => void;
}): JSX.Element {
  const tiers = set === null ? [] : bonusTiersInOrder(set.tiers);
  const changes = laterPeriod !== null && (later?.id ?? null) !== (set?.id ?? null);
  return (
    <Panel
      className="nv-enter"
      eyebrow="Paliers individuels"
      title={
        set === null || tiers.length === 0
          ? 'Aucun palier en vigueur'
          : `En vigueur depuis la quinzaine ${periodLine(set.fromPeriod)}`
      }
      actions={
        owner ? (
          <button type="button" className="nv-btn nv-btn--soft nv-btn--sm" onClick={onChange}>
            Nouveaux paliers
          </button>
        ) : undefined
      }
    >
      <div className="rp-sec">
        {tiers.length === 0 ? (
          <p className="py-quiet">
            Pas de prime de palier sur cette quinzaine.{' '}
            {owner ? '« Nouveaux paliers » en pose à partir d’une quinzaine pas encore validée.' : ''}
          </p>
        ) : (
          <ul className="py-tiers">
            {tiers.map((tier, index) => (
              <li key={tier.thresholdMinor} className="py-tier nv-enter" style={{ '--nv-i': index }}>
                <p className="py-tier__name">{tier.label}</p>
                <p className="py-tier__bonus nv-num">{signedAmountText(tier.bonusMinor, 'EUR')}</p>
                <p className="py-tier__at nv-num">à {amountText(tier.thresholdMinor, 'EUR')} de net</p>
              </li>
            ))}
          </ul>
        )}
        {changes ? (
          <div className="rp-notice">
            <p className="rp-notice__text">
              À partir de la quinzaine {periodLine(laterPeriod)} :{' '}
              {later === null || later.tiers.length === 0
                ? 'plus aucun palier.'
                : `${bonusTiersInOrder(later.tiers)
                    .map(
                      (tier) =>
                        `${tier.label} à ${amountText(tier.thresholdMinor, 'EUR')}, ${signedAmountText(tier.bonusMinor, 'EUR')}`,
                    )
                    .join(' ; ')}.`}
            </p>
          </div>
        ) : null}
        <p className="py-quiet">
          Le plus haut palier atteint compte, seuil compris. Les managers n’en ont pas : leur part d’équipe en
          tient lieu.
        </p>
      </div>
    </Panel>
  );
}
