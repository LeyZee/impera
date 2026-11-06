import type { AgencyInsights, AgencyPeriod } from '@impera/contracts';
import { chartPoints, linePath, niceTicks, placeSegmentThumb } from '@impera/design-system';
import { Link } from '@tanstack/react-router';
import { useLayoutEffect, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import { CountUp, Section, type FloatingTip } from '../parts';

import { NotYours, useAgencyInsights } from './api';
import {
  AGAINST,
  arcs,
  bestSlot,
  busiest,
  changeOf,
  creatorColours,
  dayLabel,
  dayStacks,
  deltaText,
  euros,
  heatOf,
  kindSlices,
  OTHER,
  OTHER_KINDS_NOTE,
  PERIOD_OPTIONS,
  SELLER_NOTES,
  sellerSlices,
  shareOf,
  shortDay,
  shortEuros,
  slotLabel,
  stackSeries,
  weekdayIndex,
  WEEKDAYS,
  WEEKDAYS_SHORT,
  type Slice,
} from './view';
import './agency.css';

import { initialOf } from '@/lib/utils';
import { ServerSilent } from '@/shell/ServerSilent';

/*
 * « L'agence en chiffres » (ADR 0078): what the registers of sales say about the agency, or about one creator, over a
 * period against the one before. The server computes every figure from the local register; this screen never calls a
 * platform and never receives a fan. Colours follow the entity (a creator, a kind of sale), never its rank.
 */

const STEPS: Readonly<Record<string, 1 | -1>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
const formatEuros = (cents: number): string => euros(Math.round(cents));
const formatCount = (n: number): string => Math.round(n).toLocaleString('fr-FR');

/** The four periods, a segment whose thumb slides; a radio group, one stop in the Tab order. */
export function AgencyPeriodControl({
  period,
  onChange,
}: {
  period: AgencyPeriod;
  onChange: (period: AgencyPeriod) => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const index = PERIOD_OPTIONS.findIndex((p) => p.id === period);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    placeSegmentThumb(
      element,
      index,
      PERIOD_OPTIONS.length,
      placed.current ? (thumbRef.current ?? undefined) : undefined,
    );
    placed.current = true;
  }, [index]);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = STEPS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = PERIOD_OPTIONS[(index + step + PERIOD_OPTIONS.length) % PERIOD_OPTIONS.length];
    if (next === undefined) return;
    ref.current?.querySelector<HTMLButtonElement>(`[data-period="${next.id}"]`)?.focus();
    onChange(next.id);
  };
  return (
    <div
      className="nv-seg nv-glass nv-glass--thin ag-period"
      role="radiogroup"
      aria-label="Période"
      ref={ref}
      onKeyDown={onKeyDown}
    >
      <span className="nv-seg__thumb nv-glass nv-glass--thin" ref={thumbRef} aria-hidden="true" />
      {PERIOD_OPTIONS.map((p) => (
        <button
          key={p.id}
          type="button"
          role="radio"
          className="nv-seg__opt"
          data-period={p.id}
          aria-checked={p.id === period}
          tabIndex={p.id === period ? 0 : -1}
          onClick={() => {
            onChange(p.id);
          }}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

/** « +18 % » in the colour of better or worse; nothing when there is nothing to compare with. */
function Delta({
  current,
  previous,
  lowerIsBetter = false,
}: {
  current: number;
  previous: number;
  lowerIsBetter?: boolean;
}): JSX.Element | null {
  const change = changeOf(current, previous);
  if (change === null) return null;
  const better = lowerIsBetter ? change < 0 : change > 0;
  const tone = change === 0 ? '' : better ? ' nv-delta--better' : ' nv-delta--worse';
  return <span className={`nv-delta${tone}`}>{deltaText(change)}</span>;
}

/** The revenue of every day, a quiet line under the lead figure. */
function Spark({ values }: { values: readonly number[] }): JSX.Element | null {
  if (values.length < 2 || values.every((value) => value === 0)) return null;
  const frame = { width: 240, height: 48, padTop: 4, padBottom: 4 };
  const points = chartPoints(values, frame, { min: Math.min(0, ...values) });
  return (
    <svg className="ag-spark" viewBox="0 0 240 48" preserveAspectRatio="none" aria-hidden="true">
      <path className="ag-spark__line" d={linePath(points)} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Figures({ insights, period }: { insights: AgencyInsights; period: AgencyPeriod }): JSX.Element {
  const { current, previous } = insights.totals;
  const { fans } = insights;
  return (
    <div className="ag-figures">
      <div className="nv-plate ag-lead nv-enter" style={{ '--nv-i': 1 }}>
        <div className="nv-figure">
          <span className="nv-figure__label">Chiffre d’affaires</span>
          <CountUp
            className="nv-figure__value ag-lead__value"
            value={current.revenueMinor}
            format={formatEuros}
          />
          <span className="nv-figure__note">
            <Delta current={current.revenueMinor} previous={previous.revenueMinor} />
            <span>
              {changeOf(current.revenueMinor, previous.revenueMinor) === null
                ? 'rien à comparer sur la période d’avant'
                : `${AGAINST[period]} (${euros(previous.revenueMinor)})`}
            </span>
          </span>
        </div>
        <Spark values={insights.days.map((day) => day.revenueMinor)} />
      </div>
      <dl className="ag-tiles">
        {(
          [
            {
              label: 'Part de l’agence',
              value: euros(current.agencyMinor),
              note: `${String(shareOf(current.agencyMinor, current.revenueMinor))} % du chiffre d’affaires`,
              delta: [current.agencyMinor, previous.agencyMinor],
            },
            {
              label: 'Net',
              value: euros(current.netMinor),
              note: 'agence et créatrices, après la plateforme',
              delta: [current.netMinor, previous.netMinor],
            },
            {
              label: 'Fans qui ont payé',
              value: fans.paying.toLocaleString('fr-FR'),
              note:
                fans.paying === 0
                  ? 'aucun sur la période'
                  : `dont ${fans.newPaying.toLocaleString('fr-FR')} pour la première fois`,
              delta: [fans.paying, fans.previousPaying],
            },
            {
              label: 'Dépense moyenne par fan',
              value: fans.averagePerPayingMinor === null ? '—' : euros(fans.averagePerPayingMinor),
              note: 'ce qu’un fan payeur a dépensé sur la période',
              delta: null,
            },
            {
              label: 'Ventes',
              value: current.sales.toLocaleString('fr-FR'),
              note: 'abonnements, PPV, tips… une ligne chacune',
              delta: [current.sales, previous.sales],
            },
            {
              label: 'Remboursements',
              value: current.refunds.toLocaleString('fr-FR'),
              note:
                current.sales === 0
                  ? 'aucune vente sur la période'
                  : `${String(shareOf(current.refunds, current.sales))} % des ventes`,
              delta: [current.refunds, previous.refunds],
              lowerIsBetter: true,
            },
          ] as const
        ).map((tile, i) => (
          <div key={tile.label} className="nv-plate ag-tile nv-enter" style={{ '--nv-i': i + 2 }}>
            <dt>{tile.label}</dt>
            <dd>
              <span className="ag-tile__value">{tile.value}</span>
              {tile.delta === null ? null : (
                <Delta
                  current={tile.delta[0]}
                  previous={tile.delta[1]}
                  lowerIsBetter={'lowerIsBetter' in tile}
                />
              )}
            </dd>
            <dd className="ag-tile__note">{tile.note}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The revenue day by day (or hour by hour today), stacked by creator for the agency, by kind for one creator. */
function Daily({
  insights,
  oneCreator,
  tip,
}: {
  insights: AgencyInsights;
  oneCreator: boolean;
  tip: FloatingTip;
}): JSX.Element {
  const today = insights.period === 'day';
  const stacks = today ? [] : stackSeries(insights, oneCreator);
  const columns = today
    ? (insights.hours[weekdayIndex(insights.to)] ?? []).map((cents, hour) => ({
        key: String(hour),
        label: `${String(hour)}h`,
        title: `${String(hour)}h–${String((hour + 1) % 24)}h`,
        parts: [cents],
        total: cents,
      }))
    : insights.days.map((day) => {
        const parts = dayStacks(day, stacks, oneCreator);
        return {
          key: day.day,
          label: shortDay(day.day),
          title: dayLabel(day.day),
          parts,
          total: day.revenueMinor,
        };
      });
  const max = Math.max(
    0,
    ...columns.map((column) => column.parts.reduce((sum, part) => sum + Math.max(0, part), 0)),
  );
  const ticks = niceTicks(max, 3);
  const top = ticks[ticks.length - 1] ?? 1;
  // A label under one column in every few: a week shows each day, three months one in fifteen.
  const every = columns.length <= 8 ? 1 : columns.length <= 24 ? 3 : columns.length <= 31 ? 5 : 15;
  const colours = today ? ['var(--nv-series-1)'] : stacks.map((stack) => stack.colour);
  return (
    <div className="nv-plate ag-daily">
      {stacks.length > 1 ? (
        <ul className="ag-keys" aria-label="Légende">
          {stacks.map((stack) => (
            <li key={stack.key}>
              <span className="ag-key" style={{ '--_c': stack.colour }} aria-hidden="true" />
              {stack.label}
            </li>
          ))}
        </ul>
      ) : null}
      <div
        className="ag-daily__plot"
        role="img"
        aria-label={`Chiffre d’affaires ${today ? 'heure par heure' : 'jour par jour'}, au plus ${euros(max)}`}
      >
        <div className="ag-daily__grid" aria-hidden="true">
          {ticks.map((value) => (
            <span key={value} style={{ '--_y': `${String((value / top) * 100)}%` }}>
              <i>{shortEuros(value)}</i>
            </span>
          ))}
        </div>
        <div className="ag-daily__bars" style={{ '--_n': columns.length }}>
          {columns.map((column, i) => (
            <button
              type="button"
              key={column.key}
              className="ag-col"
              style={{ '--_i': i }}
              aria-label={`${column.title} : ${euros(column.total)}`}
              {...tip.bind({
                title: column.title,
                rows: [
                  ...(today
                    ? []
                    : stacks
                        .map((stack, s) => [stack.label, column.parts[s] ?? 0] as const)
                        .filter(([, cents]) => cents !== 0)
                        .map(([label, cents]) => [label, euros(cents)] as const)),
                  ['Total', euros(column.total)],
                ],
              })}
            >
              <span className="ag-col__stack">
                {column.parts.map((cents, s) =>
                  cents <= 0 ? null : (
                    <span
                      // Bottom to top, in the legend's order.
                      key={s}
                      className="ag-col__part"
                      style={{ '--_c': colours[s] ?? OTHER, '--_h': `${String((cents / top) * 100)}%` }}
                    />
                  ),
                )}
              </span>
              <span className="ag-col__label" aria-hidden="true">
                {i % every === 0 ? column.label : ''}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A ring and its legend: a slice lit on hover, focus or touch shows in the middle and in the legend. */
function Ring({
  title,
  slices,
  notes,
  tipFor,
}: {
  title: string;
  slices: readonly Slice[];
  notes?: Readonly<Record<string, string>>;
  tipFor?: string;
}): JSX.Element {
  const [lit, setLit] = useState<number | null>(null);
  const radius = 52;
  const shown = slices.filter((slice) => slice.cents > 0);
  const total = shown.reduce((sum, slice) => sum + slice.cents, 0);
  const geometry = arcs(
    shown.map((slice) => slice.cents),
    radius,
  );
  const litSlice = lit === null ? null : shown[lit];
  return (
    <article className="nv-plate ag-ring-card">
      <h3 className="ag-card__title">{title}</h3>
      {total <= 0 ? (
        <p className="ag-empty">Aucune vente sur la période.</p>
      ) : (
        <div className="ag-ring-row">
          <div
            className={lit === null ? 'ag-ring' : 'ag-ring is-lit'}
            role="img"
            aria-label={`${title} : ${shown.map((s) => `${s.label} ${String(shareOf(s.cents, total))} %`).join(', ')}`}
          >
            <svg viewBox="0 0 132 132" aria-hidden="true">
              <circle className="ag-ring__track" cx="66" cy="66" r={radius} />
              {shown.map((slice, i) => {
                const arc = geometry[i];
                if (arc === undefined) return null;
                return (
                  <circle
                    key={slice.key}
                    className={lit === i ? 'ag-ring__arc is-on' : 'ag-ring__arc'}
                    cx="66"
                    cy="66"
                    r={radius}
                    style={{ '--_c': slice.colour, '--_dash': arc.dash, '--_i': i }}
                    strokeDashoffset={arc.offset}
                    onPointerEnter={() => {
                      setLit(i);
                    }}
                    onPointerLeave={(event) => {
                      if (event.pointerType === 'mouse') setLit(null);
                    }}
                  />
                );
              })}
            </svg>
            <span className="ag-ring__middle" aria-hidden="true">
              {litSlice === null || litSlice === undefined ? (
                <>
                  <b className="ag-ring__value">{shortEuros(total)}</b>
                  <span className="ag-ring__sub">au total</span>
                </>
              ) : (
                <>
                  <b className="ag-ring__value">{String(shareOf(litSlice.cents, total))}&nbsp;%</b>
                  <span className="ag-ring__sub">{litSlice.label}</span>
                </>
              )}
            </span>
          </div>
          <ul className="ag-legend">
            {shown.map((slice, i) => (
              <li key={slice.key}>
                <button
                  type="button"
                  className={lit === i ? 'ag-legend__row is-on' : 'ag-legend__row'}
                  title={slice.key === tipFor ? OTHER_KINDS_NOTE : notes?.[slice.key]}
                  onPointerEnter={() => {
                    setLit(i);
                  }}
                  onPointerLeave={(event) => {
                    if (event.pointerType === 'mouse') setLit(null);
                  }}
                  onFocus={() => {
                    setLit(i);
                  }}
                  onBlur={() => {
                    setLit(null);
                  }}
                  onClick={() => {
                    setLit(lit === i ? null : i);
                  }}
                >
                  <span className="ag-key" style={{ '--_c': slice.colour }} aria-hidden="true" />
                  <span className="ag-legend__label">{slice.label}</span>
                  <span className="ag-legend__value">{euros(slice.cents)}</span>
                  <span className="ag-legend__share">{String(shareOf(slice.cents, total))}&nbsp;%</span>
                  <Delta current={slice.cents} previous={slice.previousCents} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

const SELLER_MARK: Readonly<Record<'agent' | 'unlinked' | 'none', string>> = {
  agent: '✦',
  unlinked: '?',
  none: '–',
};
const SELLER_NAME: Readonly<Record<'agent' | 'unlinked' | 'none', string>> = {
  agent: 'Agent IA',
  unlinked: 'Chatteur non relié',
  none: 'Sans chatteur',
};

/** Who sold, one line each, bars from the same start: widths are shares of the best seller's revenue. */
function Sellers({ insights, tip }: { insights: AgencyInsights; tip: FloatingTip }): JSX.Element {
  const best = Math.max(0, ...insights.sellers.map((seller) => seller.revenueMinor));
  if (insights.sellers.length === 0) return <p className="nv-plate ag-empty">Aucune vente sur la période.</p>;
  return (
    <ol className="nv-plate ag-rank" aria-label="Classement de qui a vendu">
      {insights.sellers.map((one, i) => {
        const name = one.seller.kind === 'member' ? one.seller.name : SELLER_NAME[one.seller.kind];
        const average = one.sales > 0 ? Math.round(one.revenueMinor / one.sales) : null;
        return (
          <li
            key={one.seller.kind === 'member' ? one.seller.memberId : one.seller.kind}
            className="ag-rank__row nv-enter"
            style={{ '--nv-i': i }}
            data-kind={one.seller.kind}
            tabIndex={0}
            {...tip.bind({
              title: name,
              rows: [
                ['Chiffre d’affaires', euros(one.revenueMinor)],
                ['Part de l’agence', euros(one.agencyMinor)],
                ['Ventes', one.sales.toLocaleString('fr-FR')],
                ...(one.refunds > 0
                  ? [['Remboursements', one.refunds.toLocaleString('fr-FR')] as const]
                  : []),
                ...(average === null ? [] : [['Panier moyen', euros(average)] as const]),
              ],
              ...(one.seller.kind === 'member' ? {} : { note: SELLER_NOTES[one.seller.kind] }),
            })}
          >
            <span className="ag-rank__pos" aria-hidden="true">
              {String(i + 1)}
            </span>
            <span className="nv-avatar ag-rank__face" aria-hidden="true">
              {one.seller.kind === 'member' ? initialOf(one.seller.name) : SELLER_MARK[one.seller.kind]}
            </span>
            <span className="ag-rank__who">
              <span className="ag-rank__name">{name}</span>
              <span className="ag-rank__line">
                {one.sales.toLocaleString('fr-FR')} vente{one.sales > 1 ? 's' : ''}
                {average === null ? '' : ` · panier moyen ${euros(average)}`}
              </span>
            </span>
            <span className="ag-rank__bar" aria-hidden="true">
              <span
                style={{
                  '--_w': `${String(best > 0 ? Math.max(2, (Math.max(0, one.revenueMinor) / best) * 100) : 0)}%`,
                }}
              />
            </span>
            <span className="ag-rank__value">
              {euros(one.revenueMinor)}
              <Delta current={one.revenueMinor} previous={one.previousRevenueMinor} />
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The creators side by side, a click opens hers. */
function Creators({
  insights,
  onCreator,
  tip,
}: {
  insights: AgencyInsights;
  onCreator: ((creatorId: string) => void) | undefined;
  tip: FloatingTip;
}): JSX.Element {
  const colours = creatorColours(insights.creators);
  const names = new Map(insights.creators.map((creator) => [creator.creatorId, creator.name] as const));
  const total = insights.totals.current.revenueMinor;
  const best = Math.max(0, ...insights.byCreator.map((one) => one.revenueMinor));
  return (
    <ul className="nv-plate ag-creators">
      {insights.byCreator.map((one, i) => {
        const name = names.get(one.creatorId) ?? 'Créatrice';
        return (
          <li key={one.creatorId} className="nv-enter" style={{ '--nv-i': i }}>
            <button
              type="button"
              className="ag-creator"
              disabled={onCreator === undefined}
              onClick={() => onCreator?.(one.creatorId)}
              {...tip.bind({
                title: name,
                rows: [
                  ['Chiffre d’affaires', euros(one.revenueMinor)],
                  ['Part de l’agence', euros(one.agencyMinor)],
                  ['Net', euros(one.netMinor)],
                  ['Ventes', one.sales.toLocaleString('fr-FR')],
                ],
                note: 'Ouvrir son Dashboard',
              })}
            >
              <span className="ag-creator__name">
                <span
                  className="ag-key"
                  style={{ '--_c': colours.get(one.creatorId) ?? OTHER }}
                  aria-hidden="true"
                />
                {name}
              </span>
              <span className="ag-creator__bar" aria-hidden="true">
                <span
                  style={{
                    '--_c': colours.get(one.creatorId) ?? OTHER,
                    '--_w': `${String(best > 0 ? Math.max(1, (Math.max(0, one.revenueMinor) / best) * 100) : 0)}%`,
                  }}
                />
              </span>
              <span className="ag-creator__value">{euros(one.revenueMinor)}</span>
              <span className="ag-creator__share">{String(shareOf(one.revenueMinor, total))}&nbsp;%</span>
              <span className="ag-creator__delta">
                <Delta current={one.revenueMinor} previous={one.previousRevenueMinor} />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** « Quand ça vend »: a day-of-the-week by hour map, darker where the money comes in. */
function Hours({ insights, tip }: { insights: AgencyInsights; tip: FloatingTip }): JSX.Element {
  const max = Math.max(0, ...insights.hours.flat());
  const peak = busiest(insights.hours);
  const slot = bestSlot(insights.hours);
  if (peak === null || slot === null)
    return <p className="nv-plate ag-empty">Aucune vente sur la période.</p>;
  return (
    <div className="nv-plate ag-hours">
      <p className="ag-hours__lead">
        Le créneau qui rapporte le plus : <b>{slotLabel(slot.from)}</b>, {String(slot.share)}&nbsp;% du
        chiffre d’affaires. Le pic :{' '}
        <b>
          {WEEKDAYS[peak.day]?.toLowerCase()} {String(peak.hour)}h
        </b>
        .
      </p>
      <div className="ag-heat" role="img" aria-label="Chiffre d’affaires par jour de la semaine et par heure">
        <span aria-hidden="true" />
        {Array.from({ length: 24 }, (_, hour) => (
          <span key={hour} className="ag-heat__hour" aria-hidden="true">
            {hour % 3 === 0 ? `${String(hour)}h` : ''}
          </span>
        ))}
        {insights.hours.map((row, day) => (
          <div key={WEEKDAYS[day]} className="ag-heat__row" role="presentation">
            <span className="ag-heat__day" aria-hidden="true">
              {WEEKDAYS_SHORT[day]}
            </span>
            {row.map((cents, hour) => (
              <span
                key={hour}
                className="ag-heat__cell"
                style={{ '--_h': heatOf(cents, max) }}
                {...tip.bind({
                  title: `${WEEKDAYS[day] ?? ''}, ${String(hour)}h–${String((hour + 1) % 24)}h`,
                  rows: [
                    ['Chiffre d’affaires', euros(cents)],
                    [
                      'Part de la période',
                      `${String(
                        shareOf(
                          cents,
                          insights.hours.flat().reduce((s, c) => s + c, 0),
                        ),
                      )} %`,
                    ],
                  ],
                })}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="ag-heat__scale" aria-hidden="true">
        <span>moins</span>
        <i />
        <span>plus</span>
      </div>
    </div>
  );
}

/** The paying fans: how many, how many new, and how much the ten biggest weigh. */
function Fans({ insights }: { insights: AgencyInsights }): JSX.Element {
  const { fans } = insights;
  if (fans.paying === 0) return <p className="nv-plate ag-empty">Aucun fan n’a payé sur la période.</p>;
  const newShare = shareOf(fans.newPaying, fans.paying);
  const top = fans.topTenShare ?? 0;
  return (
    <div className="nv-plate ag-fans">
      <div className="ag-fans__meter">
        <p className="ag-fans__lead">
          Les 10 fans qui dépensent le plus font <b>{String(top)}&nbsp;%</b> du chiffre d’affaires.
        </p>
        <span className="ag-meter" role="img" aria-label={`${String(top)} % fait par les 10 plus gros fans`}>
          <span style={{ '--_w': `${String(top)}%` }} />
        </span>
        <p className="ag-fans__hint">
          {top >= 60
            ? 'Très concentré : perdre un de ces fans se sentirait tout de suite. Il faut élargir la base.'
            : top >= 35
              ? 'Assez concentré : quelques gros fans portent une bonne part des ventes.'
              : 'Bien réparti : les ventes ne dépendent pas de quelques fans.'}
        </p>
      </div>
      <dl className="ag-fans__figures">
        <div>
          <dt>Fans qui ont payé</dt>
          <dd>
            <CountUp value={fans.paying} format={formatCount} />
            <Delta current={fans.paying} previous={fans.previousPaying} />
          </dd>
        </div>
        <div>
          <dt>Nouveaux payeurs</dt>
          <dd>
            <CountUp value={fans.newPaying} format={formatCount} />
            <span className="ag-fans__part">{String(newShare)}&nbsp;%</span>
          </dd>
        </div>
        <div>
          <dt>Dépense moyenne</dt>
          <dd>{fans.averagePerPayingMinor === null ? '—' : euros(fans.averagePerPayingMinor)}</dd>
        </div>
      </dl>
    </div>
  );
}

/** Sections' reading lines, by period. */
const DAILY_SUB: Readonly<Record<AgencyPeriod, string>> = {
  day: 'heure par heure depuis minuit, heure de Paris',
  week: 'jour par jour, les 7 derniers jours',
  month: 'jour par jour, les 30 derniers jours',
  quarter: 'jour par jour, les 3 derniers mois',
};

/**
 * The insights of the agency (`creatorId` null) or of one creator, from `index` in the page's entrance order. The
 * period control sits on the first section.
 */
export function AgencyInsightsPanel({
  period,
  onPeriod,
  creatorId,
  creatorName,
  onCreator,
  canOpenSettings,
  tip,
  index = 1,
}: {
  period: AgencyPeriod;
  onPeriod: (period: AgencyPeriod) => void;
  creatorId: string | null;
  creatorName?: string;
  onCreator?: ((creatorId: string) => void) | undefined;
  /** The owner links the registers (Réglages › Ventes): the empty screen leads there. */
  canOpenSettings: boolean;
  tip: FloatingTip;
  index?: number;
}): JSX.Element | null {
  const query = useAgencyInsights(period, creatorId);
  const control = <AgencyPeriodControl period={period} onChange={onPeriod} />;
  const oneCreator = creatorId !== null;
  const title = oneCreator ? `Les chiffres de ${creatorName ?? 'la créatrice'}` : 'L’agence en chiffres';

  if (query.error instanceof NotYours) return null;
  if (query.data === undefined) {
    return (
      <Section title={title} sub="lus dans le registre des ventes" index={index} control={control}>
        {query.isError ? (
          <ServerSilent
            text="Les chiffres reviennent dès qu’il répond."
            onRetry={() => void query.refetch()}
          />
        ) : (
          <div
            className="db-loading nv-plate ag-loading"
            aria-label="Chargement des chiffres"
            role="status"
          />
        )}
      </Section>
    );
  }
  const insights = query.data;
  if (insights.creators.length === 0) {
    return (
      <Section title={title} sub="lus dans le registre des ventes" index={index} control={control}>
        <div className="nv-plate ag-none">
          <p>
            {oneCreator
              ? 'Aucun de ses comptes n’est relié au registre des ventes : ses chiffres arriveront dès qu’il le sera.'
              : 'Aucune créatrice n’est encore reliée au registre des ventes : les chiffres de l’agence arriveront dès la première vente lue.'}
          </p>
          {canOpenSettings ? (
            <Link to="/reglages/ventes" className="nv-btn nv-btn--soft">
              Relier dans Réglages › Ventes
            </Link>
          ) : null}
        </div>
      </Section>
    );
  }
  const several = !oneCreator && insights.creators.length >= 2;
  const kinds = kindSlices(insights.kinds);
  const sellers = sellerSlices(insights.sellers);
  let at = index;
  const next = (): number => {
    at += 1;
    return at;
  };
  return (
    <>
      <Section
        title={title}
        sub={`${AGAINST[period]}, lus dans le registre des ventes`}
        index={at}
        control={control}
      >
        <Figures insights={insights} period={period} />
        {insights.dollarsLeftOut ? (
          <p className="ag-note" role="note">
            Des ventes en dollars sont laissées de côté : aucun taux de change n’est encore connu (Équipe ›
            Paie).
          </p>
        ) : null}
      </Section>

      <Section title="Chiffre d’affaires" sub={DAILY_SUB[period]} index={next()}>
        <Daily insights={insights} oneCreator={oneCreator} tip={tip} />
      </Section>

      <div className="ag-pair nv-enter" style={{ '--nv-i': next() }}>
        <Ring title="D’où vient l’argent" slices={kinds} tipFor="other" />
        <Ring title="Qui vend" slices={sellers} notes={SELLER_NOTES} />
      </div>

      <Section
        title="Qui a vendu"
        sub="chaque chatteur, l’agent et le reste, le plus gros chiffre d’abord"
        index={next()}
      >
        <Sellers insights={insights} tip={tip} />
      </Section>

      {several ? (
        <Section title="Les créatrices" sub="côte à côte ; un clic ouvre la sienne" index={next()}>
          <Creators insights={insights} onCreator={onCreator} tip={tip} />
        </Section>
      ) : null}

      <Section
        title="Quand ça vend"
        sub="jour de la semaine et heure de chaque vente, heure de Paris"
        index={next()}
      >
        <Hours insights={insights} tip={tip} />
      </Section>

      <Section
        title="Les fans qui paient"
        sub="un fan compte une fois par compte de créatrice, jamais nommé ici"
        index={next()}
      >
        <Fans insights={insights} />
      </Section>
    </>
  );
}
