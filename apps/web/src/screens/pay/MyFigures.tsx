import type { BonusTier, Currency, MyFigures, PayrollPeriod } from '@impera/contracts';
import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import { useCurrentPeriod } from './data';
import './my-figures.css';

import { useMyFigures, usePayPeriod } from '@/payroll/api';
import { roundAmountText, tierProgress } from '@/payroll/model';
import {
  barHeight,
  barLabelled,
  bestSlot,
  changeText,
  changeWords,
  figuresCurrency,
  fortnightBars,
  fortnightChange,
  hasOtherCurrency,
  hasRecords,
  heatGrid,
  heatSlots,
  hourEndText,
  hourText,
  netIn,
  recordToday,
  slotWords,
  tierShare,
  WEEKDAY_NAMES,
  WEEKDAY_SHORT,
  type DayBar,
  type HeatCell,
} from '@/payroll/my-figures';
import { amountText, periodLine } from '@/reports/model';
import { Medal } from '@/rewards/Medal';
import { tierMedals } from '@/rewards/metals';
import { dayNumber, longDay } from '@/scheduling/time';
import { Chevron, CountUp, useFloatingTip, type FloatingTip } from '@/screens/dashboard/parts';
import { Panel } from '@/shell/layout';

/*
 * « Mes chiffres » (CHF-01, ADR 0104 § A): the member's own figures, in the hand of the agency's Dashboard. Their own
 * only: never a ranking, a team's mean, the agency's share nor a fan. A fall is said in neutral ink, never in red
 * (§ 10); the days' list of « Mes ventes lues » is these charts' table.
 *
 * One colour a nature of figure, the same on every card (`my-figures.css`): rose what the member sells, blue the way
 * to a tier, gold a record. The figures themselves stay in ink; every one of them explains itself under the pointer.
 */

/** A card's name with the dot of what it counts. */
function Named({ kind, children }: { kind: 'sales' | 'tier' | 'record'; children: string }): JSX.Element {
  return (
    <>
      <i className="mf-dot" data-kind={kind} aria-hidden="true" />
      {children}
    </>
  );
}

const counted = (count: number, one: string, many: string): string =>
  `${String(count)}\u00a0${count > 1 ? many : one}`;

/** What a day's bar says under the pointer. */
function dayTip(bar: DayBar, currency: Currency): Parameters<FloatingTip['bind']>[0] {
  const day = longDay(bar.day);
  return {
    title: `${day.charAt(0).toUpperCase()}${day.slice(1)}`,
    rows: [
      ['Net', amountText(bar.netMinor, currency)],
      ['Ventes', String(bar.sales)],
      ...(bar.refunds === 0 ? [] : [['Remboursements', String(bar.refunds)] as const]),
    ],
  };
}

/** The fortnight's days as bars, the days ahead as a floor: `tall` on Commissions, a strip on Aujourd'hui. */
function DayBars({
  bars,
  currency,
  tip,
  tall,
}: {
  bars: readonly DayBar[];
  currency: Currency;
  tip: FloatingTip;
  tall: boolean;
}): JSX.Element {
  const max = Math.max(0, ...bars.map((bar) => bar.netMinor));
  return (
    <div
      className="mf-bars"
      data-tall={tall}
      role="img"
      aria-label="Ton net jour par jour sur la quinzaine en cours"
    >
      {bars.map((bar, index) => (
        <div
          key={bar.day}
          className="mf-bar"
          data-today={bar.today}
          data-ahead={bar.ahead}
          data-best={bar.netMinor === max && max > 0}
          style={{ '--_h': barHeight(bar.netMinor, max), '--nv-i': index }}
          {...(bar.ahead ? {} : tip.bind(dayTip(bar, currency), { above: true }))}
          tabIndex={bar.ahead ? undefined : 0}
        >
          <span className="mf-bar__col">
            {tall && barLabelled(bars, index) ? (
              <span className="mf-bar__value nv-num">{roundAmountText(bar.netMinor, currency)}</span>
            ) : null}
            <i className="mf-bar__fill" />
          </span>
          {tall ? (
            <span className="mf-bar__day nv-num" aria-hidden="true">
              {dayNumber(bar.day)}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** The change against the fortnight before, stopped at the same day: neutral ink whichever way it goes. */
function Change({ change }: { change: number | null }): JSX.Element | null {
  if (change === null) return null;
  return (
    <p className="mf-change">
      {change === 0 ? null : (
        <>
          <svg className="mf-arrow" data-up={change > 0} viewBox="0 0 12 12" aria-hidden="true">
            <path d={change > 0 ? 'M6 2l4.5 7h-9z' : 'M6 10l4.5-7h-9z'} />
          </svg>
          <b className="nv-num">{changeText(change)}</b>{' '}
        </>
      )}
      {changeWords(change)}
    </p>
  );
}

/** The way to the next tier as a ring, with what is left in its heart. */
function TierRing({
  netMinor,
  tiers,
  tip,
}: {
  netMinor: number;
  tiers: readonly BonusTier[];
  tip: FloatingTip;
}): JSX.Element | null {
  const { reached, next } = tierProgress(netMinor, tiers);
  if (reached === null && next === null) return null;
  const radius = 34;
  const length = 2 * Math.PI * radius;
  const share = next === null ? 1 : tierShare(netMinor, reached?.thresholdMinor ?? 0, next.thresholdMinor);
  // The coin of the tier in sight before its name, hollow until it is reached; the full medal in its laurel once
  // the highest is. The ring keeps its blue.
  const medal = tierMedals(tiers).of((next ?? reached)?.thresholdMinor ?? 0);
  const label =
    next === null
      ? `Palier ${reached?.label ?? ''} atteint, le plus haut`
      : `Palier ${next.label} : encore ${amountText(next.thresholdMinor - netMinor, 'EUR')} de net`;
  return (
    <div
      className="mf-tier"
      data-done={next === null}
      tabIndex={0}
      {...tip.bind(
        {
          title: next === null ? 'Tous les paliers atteints' : `Vers le palier ${next.label}`,
          rows: [
            ['Ton net vendu', amountText(netMinor, 'EUR')],
            ...(reached === null ? [] : [['Palier atteint', reached.label] as const]),
            ...(next === null
              ? []
              : [
                  ['Prochain palier', `${next.label} à ${amountText(next.thresholdMinor, 'EUR')}`] as const,
                  ['Il reste', amountText(next.thresholdMinor - netMinor, 'EUR')] as const,
                ]),
          ],
        },
        { above: true },
      )}
    >
      <svg className="mf-ring" viewBox="0 0 80 80" role="img" aria-label={label}>
        <circle className="mf-ring__track" cx="40" cy="40" r={radius} />
        <circle
          className="mf-ring__fill"
          cx="40"
          cy="40"
          r={radius}
          style={{ '--_len': length, '--_gap': length * (1 - share) }}
        />
        <text className="mf-ring__text nv-num" x="40" y="44" textAnchor="middle">
          {String(Math.floor(share * 100))}&nbsp;%
        </text>
      </svg>
      {medal === null || next !== null ? null : <Medal medal={medal} size={40} />}
      <div className="mf-tier__words">
        {next === null ? (
          <>
            <p className="mf-tier__title">Palier {reached?.label} atteint</p>
            <p className="mf-tier__sub">Le plus haut de la quinzaine.</p>
          </>
        ) : (
          <>
            <p className="mf-tier__title mf-tier__title--medal">
              {medal === null ? null : <Medal medal={medal} earned={false} size={28} />}
              Palier {next.label}
            </p>
            <p className="mf-tier__sub">
              encore <b className="nv-num">{amountText(next.thresholdMinor - netMinor, 'EUR')}</b> de net
            </p>
          </>
        )}
      </div>
    </div>
  );
}

const tiersOf = (period: PayrollPeriod | undefined): readonly BonusTier[] =>
  period?.statements[0]?.rules.bonusTiers ?? period?.bonusTiers?.tiers ?? [];

/** Whether the fortnight has anything of the member's to show yet. */
const hasFortnight = (figures: MyFigures, period: PayrollPeriod | undefined): boolean =>
  figures.days.length > 0 || figures.nets.length > 0 || period?.statements[0] !== undefined;

/**
 * Aujourd'hui › « Ma quinzaine » (ADR 0104 § 2, § 3, § 4): one compact card under the shift, what the member has
 * earned so far, the fortnight day by day and the way to the next tier. Nothing shows before their first line.
 */
export function MyFortnightCard({ manager = false }: { manager?: boolean }): JSX.Element | null {
  const figures = useMyFigures().data;
  const current = useCurrentPeriod();
  const period = usePayPeriod(current).data;
  const tip = useFloatingTip();
  if (figures === undefined || !hasFortnight(figures, period)) return null;
  const currency = figuresCurrency(figures);
  const statement = period?.statements[0];
  // A manager's statement never takes a tier (the pay engine gives them none): no ring to promise one.
  const tiers = manager ? [] : tiersOf(period);
  const net = netIn(figures.nets, currency);
  const sales = figures.days.reduce((sum, day) => sum + day.sales, 0);
  return (
    <Panel
      className="nv-enter mf mf-card"
      eyebrow={<Named kind="sales">Ma quinzaine</Named>}
      actions={
        <Link to="/commissions" className="mf-more">
          Mes chiffres
          <Chevron className="mf-more__chev" />
        </Link>
      }
    >
      <div className="mf-card__body">
        <div
          className="mf-card__lead"
          tabIndex={0}
          {...tip.bind({
            title: 'Ta quinzaine à ce jour',
            rows: [
              [
                'Net vendu',
                amountText(statement?.netMinor ?? net, statement === undefined ? currency : 'EUR'),
              ],
              ...(figures.days.length === 0 ? [] : [['Ventes', String(sales)] as const]),
              ...(statement === undefined
                ? []
                : [['Gagné', amountText(statement.totalMinor, 'EUR')] as const]),
            ],
            text:
              statement === undefined
                ? 'Ton gain s’affiche dès que ton relevé existe.'
                : 'Avant validation : le relevé peut encore bouger.',
          })}
        >
          {statement === undefined ? (
            <>
              <CountUp
                className="mf-figure nv-num"
                value={netIn(figures.nets, currency)}
                format={(value) => amountText(Math.round(value), currency)}
              />
              <p className="mf-figure__label">de net vendu à ce jour</p>
            </>
          ) : (
            <>
              <CountUp
                className="mf-figure nv-num"
                value={statement.totalMinor}
                format={(value) => amountText(Math.round(value), 'EUR')}
              />
              <p className="mf-figure__label">gagné à ce jour, avant validation</p>
            </>
          )}
          <Change change={fortnightChange(figures, currency)} />
          {recordToday(figures) ? (
            <p className="mf-record-now">Ton meilleur jour, c’est aujourd’hui.</p>
          ) : null}
        </div>
        {tiers.length === 0 ? null : <TierRing netMinor={statement?.netMinor ?? 0} tiers={tiers} tip={tip} />}
      </div>
      <div className="mf-card__bars">
        {figures.days.length === 0 ? (
          // A statement paid on reports has no day to draw: one line, never fifteen flat bars.
          <p className="mf-note">Le jour par jour arrive avec les ventes relevées.</p>
        ) : (
          <DayBars bars={fortnightBars(figures, currency)} currency={currency} tip={tip} tall={false} />
        )}
      </div>
      {tip.element}
    </Panel>
  );
}

/** The week as a grid of one hue: every hour on a wide screen (`by` 1), eight slots of three hours on a narrow one. */
function HeatGrid({
  grid,
  by,
  currency,
  tip,
}: {
  grid: readonly (readonly HeatCell[])[];
  by: 1 | 3;
  currency: Currency;
  tip: FloatingTip;
}): JSX.Element {
  const max = Math.max(0, ...grid.flat().map((cell) => cell.netMinor));
  const columns = 24 / by;
  return (
    <div className="mf-heat" data-by={by} role="img" aria-label="Ton net par jour de la semaine et par heure">
      <span aria-hidden="true" />
      {Array.from({ length: columns }, (_, column) => (
        <span key={column} className="mf-heat__hour" aria-hidden="true">
          {by === 3 || column % 3 === 0 ? hourText(column * by) : ''}
        </span>
      ))}
      {grid.map((row, day) => (
        <div key={WEEKDAY_NAMES[day]} className="mf-heat__row" role="presentation">
          <span className="mf-heat__day" aria-hidden="true">
            {WEEKDAY_SHORT[day]}
          </span>
          {row.map((cell, column) => (
            <span
              key={column}
              className="mf-heat__cell"
              data-best={cell.netMinor === max && max > 0}
              style={{ '--_h': max <= 0 ? 0 : Math.max(0, cell.netMinor) / max }}
              {...tip.bind(
                {
                  title: `${WEEKDAY_NAMES[day] ?? ''}, de ${hourText(column * by)} à ${hourEndText((column + 1) * by)}`,
                  rows: [
                    ['Net', amountText(cell.netMinor, currency)],
                    ['Ventes', String(cell.sales)],
                  ],
                },
                { above: true },
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** « Quand je vends » (§ 5): the last eight weeks by weekday and hour, in the member's own zone. */
function Hours({
  figures,
  currency,
  tip,
}: {
  figures: MyFigures;
  currency: Currency;
  tip: FloatingTip;
}): JSX.Element {
  const grid = heatGrid(figures.hours.cells, currency);
  const slot = bestSlot(grid);
  return (
    <Panel
      className="nv-enter mf"
      eyebrow={<Named kind="sales">Quand je vends</Named>}
      title="Tes 8 dernières semaines"
    >
      <div className="mf-sec">
        <p className="mf-lead">
          {figures.hours.enough && slot !== null ? (
            <>
              Tu vends le plus <b>{slotWords(slot)}</b> : {String(slot.share)}&nbsp;% de ton net.
            </>
          ) : (
            <>
              Pas encore assez de ventes pour conclure : {counted(figures.hours.sales, 'vente', 'ventes')} sur
              les 30 qu’il faut.
            </>
          )}
        </p>
        <HeatGrid grid={grid} by={1} currency={currency} tip={tip} />
        <HeatGrid grid={heatSlots(grid)} by={3} currency={currency} tip={tip} />
        <div className="mf-heat__scale" aria-hidden="true">
          <span>moins</span>
          <i />
          <span>plus</span>
        </div>
        <p className="mf-note">Heures de ton fuseau ({figures.timeZone.replace(/_/gu, ' ')}).</p>
      </div>
    </Panel>
  );
}

/** « Mes records » (§ 8): the best day and the best fortnight, and what today still lacks to take the first. */
function Records({ figures, tip }: { figures: MyFigures; tip: FloatingTip }): JSX.Element {
  const { bestDay, bestPeriod } = figures.records;
  const today =
    bestDay === null
      ? 0
      : netIn(figures.days.find((day) => day.day === figures.today)?.nets ?? [], bestDay.currency);
  return (
    <Panel className="nv-enter mf" eyebrow={<Named kind="record">Mes records</Named>}>
      <div className="mf-sec mf-records">
        {bestDay === null ? null : (
          <div
            className="mf-record"
            data-now={recordToday(figures)}
            tabIndex={0}
            {...tip.bind(
              {
                title: 'Ton meilleur jour',
                rows: [
                  ['Record', amountText(bestDay.netMinor, bestDay.currency)],
                  ['Aujourd’hui', amountText(today, bestDay.currency)],
                  ...(recordToday(figures)
                    ? []
                    : [['Il manque', amountText(bestDay.netMinor - today, bestDay.currency)] as const]),
                ],
                text: 'En net vendu, sur une journée.',
              },
              { above: true },
            )}
          >
            <p className="mf-record__label">Meilleur jour</p>
            <p className="mf-record__value nv-num">{amountText(bestDay.netMinor, bestDay.currency)}</p>
            <p className="mf-record__when">
              {recordToday(figures) ? 'Aujourd’hui, et ça continue' : `Le ${longDay(bestDay.day)}`}
            </p>
          </div>
        )}
        {bestPeriod === null ? null : (
          <div
            className="mf-record"
            data-now={bestPeriod.period === figures.period}
            tabIndex={0}
            {...tip.bind(
              {
                title: 'Ta meilleure quinzaine',
                rows: [
                  ['Record', amountText(bestPeriod.netMinor, bestPeriod.currency)],
                  [
                    'Celle en cours',
                    amountText(netIn(figures.nets, bestPeriod.currency), bestPeriod.currency),
                  ],
                ],
                text: 'En net vendu, sur une quinzaine entière.',
              },
              { above: true },
            )}
          >
            <p className="mf-record__label">Meilleure quinzaine</p>
            <p className="mf-record__value nv-num">{amountText(bestPeriod.netMinor, bestPeriod.currency)}</p>
            <p className="mf-record__when">
              {bestPeriod.period === figures.period
                ? 'Celle-ci, en cours'
                : `Quinzaine ${periodLine(bestPeriod.period)}`}
            </p>
          </div>
        )}
        {bestDay !== null && !recordToday(figures) && today > 0 ? (
          <p className="mf-note mf-records__left">
            Aujourd’hui : encore{' '}
            <b className="nv-num">{amountText(bestDay.netMinor - today, bestDay.currency)}</b> pour battre ton
            meilleur jour.
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

/**
 * Commissions › « Ma quinzaine, jour par jour » (ADR 0104 § 3): the fortnight under way against the one before, in
 * the column of the member's statement. Nothing shows without a day of theirs.
 */
export function MyDaysCard(): JSX.Element | null {
  const figures = useMyFigures().data;
  const tip = useFloatingTip();
  if (figures === undefined || figures.days.length === 0) return null;
  const currency = figuresCurrency(figures);
  const net = netIn(figures.nets, currency);
  const sales = figures.days.reduce((sum, day) => sum + day.sales, 0);
  const refunds = figures.days.reduce((sum, day) => sum + day.refunds, 0);
  const before = figures.previous === null ? null : netIn(figures.previous.toDateNets, currency);
  return (
    <Panel
      className="nv-enter mf mf-days"
      eyebrow={<Named kind="sales">Ma quinzaine, jour par jour</Named>}
      actions={
        <span
          className="mf-total nv-num"
          tabIndex={0}
          {...tip.bind({
            title: 'Ta quinzaine à ce jour',
            rows: [
              ['Net vendu', amountText(net, currency)],
              ['Ventes', String(sales)],
              ...(refunds === 0 ? [] : [['Remboursements', String(refunds)] as const]),
              ...(before === null
                ? []
                : [['Au même jour, quinzaine d’avant', amountText(before, currency)] as const]),
            ],
          })}
        >
          {amountText(net, currency)} de net · {counted(sales, 'vente', 'ventes')}
        </span>
      }
    >
      <div className="mf-sec">
        <Change change={fortnightChange(figures, currency)} />
        <DayBars bars={fortnightBars(figures, currency)} currency={currency} tip={tip} tall />
        {hasOtherCurrency(figures, currency) ? (
          <p className="mf-note">
            En {currency} seulement : tes ventes dans une autre devise sont dans « Mes ventes lues ».
          </p>
        ) : null}
      </div>
      {tip.element}
    </Panel>
  );
}

/**
 * Commissions › « Mes records » and « Quand je vends » (ADR 0104 § 5, § 8), in the column of the member's
 * performance. Each card shows only once it has something of theirs to say.
 */
export function MyFiguresAside(): JSX.Element | null {
  const figures = useMyFigures().data;
  const tip = useFloatingTip();
  if (figures === undefined) return null;
  const hours = figures.hours.sales > 0;
  const records = hasRecords(figures);
  if (!hours && !records) return null;
  return (
    <>
      {records ? <Records figures={figures} tip={tip} /> : null}
      {hours ? <Hours figures={figures} currency={figuresCurrency(figures)} tip={tip} /> : null}
      {tip.element}
    </>
  );
}
