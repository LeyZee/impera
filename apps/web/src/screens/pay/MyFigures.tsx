import type { BonusTier, Currency, MyFigures, PayrollPeriod } from '@impera/contracts';
import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import { useCurrentPeriod } from './data';
import './my-figures.css';

import { useMyFigures, usePayPeriod } from '@/payroll/api';
import { roundAmountText, tierProgress } from '@/payroll/model';
import {
  barHeight,
  bestSlot,
  changeText,
  changeWords,
  figuresCurrency,
  fortnightBars,
  fortnightChange,
  hasOtherCurrency,
  hasRecords,
  heatGrid,
  netIn,
  recordToday,
  slotWords,
  tierShare,
  WEEKDAY_NAMES,
  WEEKDAY_SHORT,
  type DayBar,
} from '@/payroll/my-figures';
import { amountText, periodLine } from '@/reports/model';
import { dayNumber, longDay } from '@/scheduling/time';
import { CountUp, useFloatingTip, type FloatingTip } from '@/screens/dashboard/parts';
import { Panel } from '@/shell/layout';

/*
 * « Mes chiffres » (CHF-01, ADR 0104 § A): the member's own figures, in the hand of the agency's Dashboard. Their own
 * only: never a ranking, a team's mean, the agency's share nor a fan. A fall is said in neutral ink, never in red
 * (§ 10); the days' list of « Mes ventes lues » is these charts' table.
 */

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
  const best = bars.findIndex((bar) => bar.netMinor === max && max > 0);
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
          style={{ '--_h': barHeight(bar.netMinor, max), '--nv-i': index }}
          {...(bar.ahead ? {} : tip.bind(dayTip(bar, currency), { above: true }))}
          tabIndex={bar.ahead ? undefined : 0}
        >
          <span className="mf-bar__col">
            {/* Selective labels: the best day, and today unless it stands beside it; never a figure on every bar. */}
            {tall && bar.netMinor > 0 && (index === best || (bar.today && Math.abs(index - best) !== 1)) ? (
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
}: {
  netMinor: number;
  tiers: readonly BonusTier[];
}): JSX.Element | null {
  const { reached, next } = tierProgress(netMinor, tiers);
  if (reached === null && next === null) return null;
  const radius = 34;
  const length = 2 * Math.PI * radius;
  const share = next === null ? 1 : tierShare(netMinor, reached?.thresholdMinor ?? 0, next.thresholdMinor);
  const label =
    next === null
      ? `Palier ${reached?.label ?? ''} atteint, le plus haut`
      : `Palier ${next.label} : encore ${amountText(next.thresholdMinor - netMinor, 'EUR')} de net`;
  return (
    <div className="mf-tier" data-done={next === null}>
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
      <div className="mf-tier__words">
        {next === null ? (
          <>
            <p className="mf-tier__title">Palier {reached?.label} atteint</p>
            <p className="mf-tier__sub">Le plus haut de la quinzaine.</p>
          </>
        ) : (
          <>
            <p className="mf-tier__title">Palier {next.label}</p>
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
export function MyFortnightCard(): JSX.Element | null {
  const figures = useMyFigures().data;
  const current = useCurrentPeriod();
  const period = usePayPeriod(current).data;
  const tip = useFloatingTip();
  if (figures === undefined || !hasFortnight(figures, period)) return null;
  const currency = figuresCurrency(figures);
  const statement = period?.statements[0];
  const tiers = tiersOf(period);
  return (
    <Panel
      className="nv-enter mf-card"
      eyebrow="Ma quinzaine"
      actions={
        <Link to="/commissions" className="nv-btn nv-btn--plain nv-btn--sm">
          Mes chiffres
        </Link>
      }
    >
      <div className="mf-card__body">
        <div className="mf-card__lead">
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
              <p className="mf-figure__label">pour toi à ce jour, avant validation</p>
            </>
          )}
          <Change change={fortnightChange(figures, currency)} />
          {recordToday(figures) ? (
            <p className="mf-record-now">Ton meilleur jour, c’est aujourd’hui.</p>
          ) : null}
        </div>
        {tiers.length === 0 ? null : <TierRing netMinor={statement?.netMinor ?? 0} tiers={tiers} />}
      </div>
      <div className="mf-card__bars">
        <DayBars bars={fortnightBars(figures, currency)} currency={currency} tip={tip} tall={false} />
      </div>
      {tip.element}
    </Panel>
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
  const max = Math.max(0, ...grid.flat().map((cell) => cell.netMinor));
  const slot = bestSlot(grid);
  return (
    <Panel className="nv-enter mf-wide" eyebrow="Quand je vends" title="Tes 8 dernières semaines">
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
        <div className="mf-heat" role="img" aria-label="Ton net par jour de la semaine et par heure">
          <span aria-hidden="true" />
          {Array.from({ length: 24 }, (_, hour) => (
            <span key={hour} className="mf-heat__hour" aria-hidden="true">
              {hour % 3 === 0 ? `${String(hour)}h` : ''}
            </span>
          ))}
          {grid.map((row, day) => (
            <div key={WEEKDAY_NAMES[day]} className="mf-heat__row" role="presentation">
              <span className="mf-heat__day" aria-hidden="true">
                {WEEKDAY_SHORT[day]}
              </span>
              {row.map((cell, hour) => (
                <span
                  key={hour}
                  className="mf-heat__cell"
                  style={{ '--_h': max <= 0 ? 0 : Math.max(0, cell.netMinor) / max }}
                  {...tip.bind({
                    title: `${WEEKDAY_NAMES[day] ?? ''}, ${String(hour)}h–${String((hour + 1) % 24)}h`,
                    rows: [
                      ['Net', amountText(cell.netMinor, currency)],
                      ['Ventes', String(cell.sales)],
                    ],
                  })}
                />
              ))}
            </div>
          ))}
        </div>
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
function Records({ figures }: { figures: MyFigures }): JSX.Element {
  const { bestDay, bestPeriod } = figures.records;
  const today =
    bestDay === null
      ? 0
      : netIn(figures.days.find((day) => day.day === figures.today)?.nets ?? [], bestDay.currency);
  return (
    <Panel className="nv-enter" eyebrow="Mes records">
      <div className="mf-sec mf-records">
        {bestDay === null ? null : (
          <div className="mf-record" data-now={recordToday(figures)}>
            <p className="mf-record__label">Meilleur jour</p>
            <p className="mf-record__value nv-num">{amountText(bestDay.netMinor, bestDay.currency)}</p>
            <p className="mf-record__when">
              {recordToday(figures) ? 'Aujourd’hui, et ça continue' : `Le ${longDay(bestDay.day)}`}
            </p>
          </div>
        )}
        {bestPeriod === null ? null : (
          <div className="mf-record" data-now={bestPeriod.period === figures.period}>
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
 * Commissions › « Mes chiffres » (ADR 0104 § 3, § 5, § 8): the fortnight day by day against the one before, when the
 * member sells, and their records. Each card shows only once it has something of theirs to say.
 */
export function MyFiguresBoard(): JSX.Element | null {
  const figures = useMyFigures().data;
  const tip = useFloatingTip();
  if (figures === undefined) return null;
  const currency = figuresCurrency(figures);
  const days = figures.days.length > 0;
  const hours = figures.hours.sales > 0;
  const records = hasRecords(figures);
  if (!days && !hours && !records) return null;
  const sales = figures.days.reduce((sum, day) => sum + day.sales, 0);
  return (
    <div className="mf-board py-me__wide">
      {days ? (
        <Panel
          className="nv-enter"
          eyebrow="Ma quinzaine, jour par jour"
          actions={
            <span className="mf-total nv-num">
              {amountText(netIn(figures.nets, currency), currency)} · {counted(sales, 'vente', 'ventes')}
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
        </Panel>
      ) : null}
      {records ? <Records figures={figures} /> : null}
      {hours ? <Hours figures={figures} currency={currency} tip={tip} /> : null}
      {tip.element}
    </div>
  );
}
