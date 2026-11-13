import type { AgencyInsights, AgencyPeriod } from '@impera/contracts';
import { chartPoints, linePath, niceTicks, placeSegmentThumb } from '@impera/design-system';
import { Link } from '@tanstack/react-router';
import { useLayoutEffect, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import { CountUp, Section, type FloatingTip } from '../parts';

import { NotYours, useAgencyInsights } from './api';
import { useNarrow } from './useNarrow';
import {
  AGAINST,
  arcs,
  bestSlot,
  busiest,
  changeOf,
  dayLabel,
  byWeek,
  dayStacks,
  deltaText,
  euros,
  heatOf,
  kindSlices,
  moneyParts,
  OTHER,
  OTHER_KINDS_NOTE,
  PERIOD_OPTIONS,
  ppvRate,
  readAtLabel,
  SELLER_NOTES,
  sellerSlices,
  shareOf,
  shortDay,
  shortEuros,
  signedCount,
  slotLabel,
  STACKS,
  WEEKDAYS,
  WEEKDAYS_SHORT,
  zoneLabel,
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
      className="nv-seg nv-glass nv-glass--thin ins-period"
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
  // Nothing then and nothing now is no change: « 0 % », as every other tile shows its pill.
  const change = current === 0 && previous === 0 ? 0 : changeOf(current, previous);
  if (change === null) return null;
  const better = lowerIsBetter ? change < 0 : change > 0;
  const tone = change === 0 ? ' ins-delta-flat' : better ? ' nv-delta--better' : ' nv-delta--worse';
  return <span className={`nv-delta${tone}`}>{deltaText(change)}</span>;
}

/** The revenue of every day, a quiet line under the lead figure. */
function Spark({ values }: { values: readonly number[] }): JSX.Element | null {
  if (values.length < 2 || values.every((value) => value === 0)) return null;
  const frame = { width: 240, height: 48, padTop: 4, padBottom: 4 };
  const points = chartPoints(values, frame, { min: Math.min(0, ...values) });
  return (
    <svg className="ins-spark" viewBox="0 0 240 48" preserveAspectRatio="none" aria-hidden="true">
      <path className="ins-spark__line" d={linePath(points)} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

interface Tile {
  readonly label: string;
  readonly value: string;
  readonly note: string;
  readonly delta: readonly [number, number] | null;
  readonly lowerIsBetter?: boolean;
}

function Tiles({ tiles, from, label }: { tiles: readonly Tile[]; from: number; label: string }): JSX.Element {
  return (
    <dl className="ins-tiles" aria-label={label}>
      {tiles.map((tile, i) => (
        <div key={tile.label} className="nv-plate ins-tile nv-enter" style={{ '--nv-i': from + i }}>
          <dt>{tile.label}</dt>
          <dd>
            <span className="ins-tile__value">{tile.value}</span>
            {tile.delta === null ? null : (
              <Delta
                current={tile.delta[0]}
                previous={tile.delta[1]}
                lowerIsBetter={tile.lowerIsBetter === true}
              />
            )}
          </dd>
          <dd className="ins-tile__note">{tile.note}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * « Où va l'argent » (ADR 0106 § 5): the period's revenue as one tall segmented bar, the fans' VAT and the platform's
 * commission first, then the net's two parts. One ink in four steps, the agency's the fullest: the other blocks wear
 * the series' and the team's colours. The legend is the table: every amount and its share of the revenue.
 */
function MoneySplit({
  insights,
  several,
  tip,
}: {
  insights: AgencyInsights;
  several: boolean;
  tip: FloatingTip;
}): JSX.Element {
  const figures = insights.totals.current;
  const parts = moneyParts(figures, several);
  const whole = parts.reduce((sum, part) => sum + part.cents, 0);
  return (
    <article className="nv-plate ins-money nv-enter" style={{ '--nv-i': 6 }}>
      <h3 className="ins-card__title">
        Où va l’argent
        {whole > 0 ? <span className="ins-card__total">{euros(figures.revenueMinor)}</span> : null}
      </h3>
      {whole <= 0 ? (
        <p className="ins-empty">Aucune vente sur la période.</p>
      ) : (
        <>
          <div
            className="ins-money__bar"
            role="img"
            aria-label={`Où va l’argent : ${parts
              .filter((part) => part.cents > 0)
              .map((part) => `${part.label} ${euros(part.cents)}, ${String(shareOf(part.cents, whole))} %`)
              .join(' ; ')}`}
          >
            {parts.map((part) =>
              part.cents <= 0 ? null : (
                <span
                  key={part.key}
                  className="ins-money__part"
                  data-part={part.key}
                  style={{ flexGrow: part.cents }}
                  {...tip.bind(
                    {
                      title: part.label,
                      rows: [
                        ['Montant', euros(part.cents)],
                        ['Part du chiffre d’affaires', `${String(shareOf(part.cents, whole))} %`],
                      ],
                      note: part.note,
                    },
                    { above: true },
                  )}
                />
              ),
            )}
          </div>
          <ul className="ins-money__legend">
            {parts.map((part) => (
              <li key={part.key}>
                <span className="ins-money__key" data-part={part.key} aria-hidden="true" />
                <span className="ins-money__label">{part.label}</span>
                <span className="ins-money__value">{euros(part.cents)}</span>
                <span className="ins-money__share">{String(shareOf(part.cents, whole))}&nbsp;%</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </article>
  );
}

function Figures({
  insights,
  period,
  several,
  tip,
}: {
  insights: AgencyInsights;
  period: AgencyPeriod;
  several: boolean;
  tip: FloatingTip;
}): JSX.Element {
  const { current, previous } = insights.totals;
  const { fans } = insights;
  const fansVat = current.revenueMinor - current.revenueExclVatMinor;
  const commission = current.revenueExclVatMinor - current.netMinor;
  // ADR 0106 § 4: the parts say their share of the net, the base a percentage agreed with a creator is set on.
  const ofNet = (cents: number): string =>
    current.netMinor > 0
      ? `${String(shareOf(cents, current.netMinor))} % du net`
      : 'aucun net sur la période';
  const money: readonly Tile[] = [
    {
      label: 'Net',
      value: euros(current.netMinor),
      note: `après ${euros(fansVat)} de TVA des fans et ${euros(commission)} de commission de la plateforme`,
      delta: [current.netMinor, previous.netMinor],
    },
    {
      label: 'Part de l’agence',
      value: euros(current.agencyMinor),
      note: ofNet(current.agencyMinor),
      delta: [current.agencyMinor, previous.agencyMinor],
    },
    {
      label: several ? 'Part des créatrices' : 'Part de la créatrice',
      value: euros(current.creatorMinor),
      note: ofNet(current.creatorMinor),
      delta: [current.creatorMinor, previous.creatorMinor],
    },
    {
      label: 'TVA en plus sur les virements',
      value: euros(current.agencyTransferVatMinor),
      note: 'estimation, 20 % de la part de l’agence, à reverser à l’État',
      delta: null,
    },
  ];
  const activity: readonly Tile[] = [
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
  ];
  return (
    <div className="ins-figures-stack">
      <div className="ins-figures">
        <div className="nv-plate ins-lead nv-enter" style={{ '--nv-i': 1 }}>
          <div className="nv-figure">
            <span className="nv-figure__label">Chiffre d’affaires</span>
            <CountUp
              className="nv-figure__value ins-lead__value"
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
            <span className="ins-lead__sub">ce que les fans ont payé, TVA comprise</span>
          </div>
          <Spark values={insights.days.map((day) => day.revenueMinor)} />
        </div>
        <Tiles tiles={money} from={2} label="L’argent" />
      </div>
      <MoneySplit insights={insights} several={several} tip={tip} />
      <Tiles tiles={activity} from={7} label="Les fans et les ventes" />
    </div>
  );
}

/**
 * The revenue day by day (hour by hour today, week by week over three months on a phone), stacked by kind of sale, the
 * ring's colours. One stop for the keyboard, the arrows walk the columns.
 */
function Daily({ insights, tip }: { insights: AgencyInsights; tip: FloatingTip }): JSX.Element {
  const narrow = useNarrow();
  const today = insights.period === 'day';
  const days = today
    ? insights.hourly.map((hour) => ({
        key: String(hour.hour),
        label: `${String(hour.hour)}h`,
        title: `${String(hour.hour)}h–${String((hour.hour + 1) % 24)}h`,
        parts: dayStacks(hour),
        total: hour.revenueMinor,
      }))
    : insights.days.map((day) => ({
        key: day.day,
        label: shortDay(day.day),
        title: dayLabel(day.day),
        parts: dayStacks(day),
        total: day.revenueMinor,
      }));
  const weekly = narrow && insights.period === 'quarter';
  const columns = weekly ? byWeek(days) : days;
  const [focus, setFocus] = useState(columns.length - 1);
  const current = Math.min(Math.max(0, focus), columns.length - 1);
  const bars = useRef<HTMLDivElement>(null);
  const max = Math.max(
    0,
    ...columns.map((column) => column.parts.reduce((sum, part) => sum + Math.max(0, part), 0)),
  );
  const ticks = niceTicks(max, 3);
  const top = ticks[ticks.length - 1] ?? 1;
  // A label under one column in every few: a week shows each day, three months one in fifteen (a week in four).
  const every =
    columns.length <= 8
      ? 1
      : columns.length <= 14
        ? 4
        : columns.length <= 24
          ? 3
          : columns.length <= 31
            ? 5
            : 15;
  const used = STACKS.filter((_, s) => columns.some((column) => (column.parts[s] ?? 0) > 0));
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step =
      event.key === 'Home' ? -columns.length : event.key === 'End' ? columns.length : STEPS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = Math.min(Math.max(0, current + step), columns.length - 1);
    setFocus(next);
    bars.current?.querySelectorAll<HTMLButtonElement>('.ins-col')[next]?.focus();
  };
  const span = today ? 'heure par heure' : weekly ? 'semaine par semaine' : 'jour par jour';
  return (
    <div className="nv-plate ins-daily">
      {used.length > 1 ? (
        <ul className="ins-keys" aria-label="Légende">
          {used.map((stack) => (
            <li key={stack.key}>
              <span className="ins-key" style={{ '--_c': stack.colour }} aria-hidden="true" />
              {stack.label}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="ins-daily__plot">
        <div className="ins-daily__grid" aria-hidden="true">
          {ticks.map((value) => (
            <span key={value} style={{ '--_y': `${String((value / top) * 100)}%` }}>
              <i>{shortEuros(value)}</i>
            </span>
          ))}
        </div>
        <div
          className="ins-daily__bars"
          style={{ '--_n': columns.length }}
          role="group"
          aria-label={`Chiffre d’affaires ${span}, au plus ${euros(max)} : flèches pour passer d’une colonne à l’autre`}
          ref={bars}
          onKeyDown={onKeyDown}
          onFocus={(event) => {
            const at = Number(event.target.getAttribute('data-i'));
            if (Number.isInteger(at)) setFocus(at);
          }}
        >
          {columns.map((column, i) => (
            <button
              type="button"
              key={column.key}
              className="ins-col"
              style={{ '--_i': i }}
              tabIndex={i === current ? 0 : -1}
              aria-label={`${column.title} : ${euros(column.total)}`}
              data-i={i}
              {...tip.bind(
                {
                  title: column.title,
                  rows: [
                    ...STACKS.map((stack, s) => [stack.label, column.parts[s] ?? 0] as const)
                      .filter(([, cents]) => cents !== 0)
                      .map(([label, cents]) => [label, euros(cents)] as const),
                    ['Total', euros(column.total)],
                  ],
                },
                { above: true },
              )}
            >
              <span className="ins-col__stack">
                {column.parts.map((cents, s) =>
                  cents <= 0 ? null : (
                    <span
                      // Bottom to top, in the legend's order.
                      key={s}
                      className="ins-col__part"
                      style={{
                        '--_c': STACKS[s]?.colour ?? OTHER,
                        '--_h': `${String((cents / top) * 100)}%`,
                      }}
                    />
                  ),
                )}
              </span>
              <span className="ins-col__label" aria-hidden="true">
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
  // The pointer that pressed a legend row: its focus and its click are that pointer's, not the keyboard's.
  const pressedBy = useRef<string | null>(null);
  const radius = 52;
  const shown = slices.filter((slice) => slice.cents > 0);
  const total = shown.reduce((sum, slice) => sum + slice.cents, 0);
  const geometry = arcs(
    shown.map((slice) => slice.cents),
    radius,
  );
  const litSlice = lit === null ? null : shown[lit];
  return (
    <article className="nv-plate ins-ring-card">
      <h3 className="ins-card__title">
        {title}
        {total > 0 ? <span className="ins-card__total">{euros(total)}</span> : null}
      </h3>
      {total <= 0 ? (
        <p className="ins-empty">Aucune vente sur la période.</p>
      ) : (
        <div className="ins-ring-row">
          <div
            className={lit === null ? 'ins-ring' : 'ins-ring is-lit'}
            role="img"
            aria-label={`${title} : ${shown.map((s) => `${s.label} ${String(shareOf(s.cents, total))} %`).join(', ')}`}
          >
            <svg viewBox="0 0 132 132" aria-hidden="true">
              <circle className="ins-ring__track" cx="66" cy="66" r={radius} />
              {shown.map((slice, i) => {
                const arc = geometry[i];
                if (arc === undefined) return null;
                return (
                  <circle
                    key={slice.key}
                    className={lit === i ? 'ins-ring__arc is-on' : 'ins-ring__arc'}
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
            <span className="ins-ring__middle" aria-hidden="true">
              {litSlice === null || litSlice === undefined ? (
                <>
                  <b className="ins-ring__value">
                    {slices.reduce((sum, one) => sum + one.sales, 0).toLocaleString('fr-FR')}
                  </b>
                  <span className="ins-ring__sub">ventes</span>
                </>
              ) : (
                <>
                  <b className="ins-ring__value">{String(shareOf(litSlice.cents, total))}&nbsp;%</b>
                  <span className="ins-ring__sub">{litSlice.label}</span>
                </>
              )}
            </span>
          </div>
          <ul className="ins-legend">
            {shown.map((slice, i) => (
              <li key={slice.key}>
                <button
                  type="button"
                  className={lit === i ? 'ins-legend__row is-on' : 'ins-legend__row'}
                  title={slice.key === tipFor ? OTHER_KINDS_NOTE : notes?.[slice.key]}
                  // A mouse lights on entering and leaving puts out; a finger's tap lights or puts out (`onClick`);
                  // the keyboard lights on focus. A tap's own entering and focus would light before its click undoes it.
                  onPointerEnter={(event) => {
                    if (event.pointerType === 'mouse') setLit(i);
                  }}
                  onPointerLeave={(event) => {
                    if (event.pointerType === 'mouse') setLit(null);
                  }}
                  onPointerDown={(event) => {
                    pressedBy.current = event.pointerType;
                  }}
                  onFocus={() => {
                    if (pressedBy.current === null) setLit(i);
                  }}
                  onBlur={() => {
                    pressedBy.current = null;
                    setLit(null);
                  }}
                  onClick={() => {
                    const by = pressedBy.current;
                    pressedBy.current = null;
                    if (by === 'mouse') setLit(i);
                    else setLit(lit === i ? null : i);
                  }}
                >
                  <span className="ins-key" style={{ '--_c': slice.colour }} aria-hidden="true" />
                  <span className="ins-legend__label">{slice.label}</span>
                  <span className="ins-legend__value">{euros(slice.cents)}</span>
                  <span className="ins-legend__share">{String(shareOf(slice.cents, total))}&nbsp;%</span>
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
  if (insights.sellers.length === 0)
    return <p className="nv-plate ins-empty">Aucune vente sur la période.</p>;
  return (
    <ol className="nv-plate ins-rank" aria-label="Classement de qui a vendu">
      {insights.sellers.map((one, i) => {
        const name = one.seller.kind === 'member' ? one.seller.name : SELLER_NAME[one.seller.kind];
        const average = one.sales > 0 ? Math.round(one.revenueMinor / one.sales) : null;
        return (
          <li
            key={one.seller.kind === 'member' ? one.seller.memberId : one.seller.kind}
            className="ins-rank__row nv-enter"
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
            <span className="ins-rank__pos" aria-hidden="true">
              {String(i + 1)}
            </span>
            <span className="nv-avatar ins-rank__face" aria-hidden="true">
              {one.seller.kind === 'member' ? initialOf(one.seller.name) : SELLER_MARK[one.seller.kind]}
            </span>
            <span className="ins-rank__who">
              <span className="ins-rank__name">{name}</span>
              <span className="ins-rank__line">
                {one.sales.toLocaleString('fr-FR')} vente{one.sales > 1 ? 's' : ''}
                {average === null ? null : (
                  <>
                    {' · '}
                    <span className="ins-nowrap">panier moyen {euros(average)}</span>
                  </>
                )}
              </span>
            </span>
            <span className="ins-rank__bar" aria-hidden="true">
              <span
                style={{
                  '--_w': `${String(best > 0 ? Math.max(2, (Math.max(0, one.revenueMinor) / best) * 100) : 0)}%`,
                }}
              />
            </span>
            <span className="ins-rank__value">
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
  const names = new Map(insights.creators.map((creator) => [creator.creatorId, creator.name] as const));
  const total = insights.totals.current.revenueMinor;
  const best = Math.max(0, ...insights.byCreator.map((one) => one.revenueMinor));
  return (
    <ul className="nv-plate ins-creators">
      {insights.byCreator.map((one, i) => {
        const name = names.get(one.creatorId) ?? 'Créatrice';
        return (
          <li key={one.creatorId} className="nv-enter" style={{ '--nv-i': i }}>
            <button
              type="button"
              className="ins-creator"
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
              <span className="ins-creator__name">{name}</span>
              <span className="ins-creator__bar" aria-hidden="true">
                <span
                  style={{
                    '--_w': `${String(best > 0 ? Math.max(1, (Math.max(0, one.revenueMinor) / best) * 100) : 0)}%`,
                  }}
                />
              </span>
              <span className="ins-creator__value">{euros(one.revenueMinor)}</span>
              <span className="ins-creator__share">{String(shareOf(one.revenueMinor, total))}&nbsp;%</span>
              <span className="ins-creator__delta">
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
    return <p className="nv-plate ins-empty">Aucune vente sur la période.</p>;
  return (
    <div className="nv-plate ins-hours">
      <p className="ins-hours__lead">
        Le créneau qui rapporte le plus : <b>{slotLabel(slot.from)}</b>, {String(slot.share)}&nbsp;% du
        chiffre d’affaires. Le pic :{' '}
        <b>
          {WEEKDAYS[peak.day]?.toLowerCase()} {String(peak.hour)}h
        </b>
        .
      </p>
      <div
        className="ins-heat"
        role="img"
        aria-label="Chiffre d’affaires par jour de la semaine et par heure"
      >
        <span aria-hidden="true" />
        {Array.from({ length: 24 }, (_, hour) => (
          <span key={hour} className="ins-heat__hour" aria-hidden="true">
            {hour % 3 === 0 ? `${String(hour)}h` : ''}
          </span>
        ))}
        {insights.hours.map((row, day) => (
          <div key={WEEKDAYS[day]} className="ins-heat__row" role="presentation">
            <span className="ins-heat__day" aria-hidden="true">
              {WEEKDAYS_SHORT[day]}
            </span>
            {row.map((cents, hour) => (
              <span
                key={hour}
                className="ins-heat__cell"
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
      <div className="ins-heat__scale" aria-hidden="true">
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
  if (fans.paying === 0) return <p className="nv-plate ins-empty">Aucun fan n’a payé sur la période.</p>;
  const newShare = shareOf(fans.newPaying, fans.paying);
  const top = fans.topTenShare ?? 0;
  return (
    <div className="nv-plate ins-fans">
      <div className="ins-fans__meter">
        <p className="ins-fans__lead">
          Les 10 fans qui dépensent le plus font <b>{String(top)}&nbsp;%</b> du chiffre d’affaires.
        </p>
        <span className="ins-meter" role="img" aria-label={`${String(top)} % fait par les 10 plus gros fans`}>
          <span style={{ '--_w': `${String(top)}%` }} />
        </span>
        <p className="ins-fans__hint">
          {top >= 60
            ? 'Très concentré : perdre un de ces fans se sentirait tout de suite. Il faut élargir la base.'
            : top >= 35
              ? 'Assez concentré : quelques gros fans portent une bonne part des ventes.'
              : 'Bien réparti : les ventes ne dépendent pas de quelques fans.'}
        </p>
      </div>
      <dl className="ins-fans__figures">
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
            <span className="ins-fans__part">{String(newShare)}&nbsp;%</span>
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

/** A count of the snapshot: « en calcul » while the platform has not computed it. */
const LATER = 'en calcul chez Reveal';
const countText = (n: number | null): string => (n === null ? '—' : n.toLocaleString('fr-FR'));

/** Active subscribers day by day: a line over the read days, broken where a day is not read yet. */
function ActiveLine({
  days,
  tip,
}: {
  days: NonNullable<AgencyInsights['subscribers']>['days'];
  tip: FloatingTip;
}): JSX.Element | null {
  const read = days.map((one) => one.active).filter((n): n is number => n !== null);
  if (read.length < 2) return null;
  const low = Math.min(...read);
  const high = Math.max(...read);
  const unread = days.length - read.length;
  // Not from zero: a few subscribers more on a thousand must show. A flat week stays a flat line.
  const pad = Math.max(1, Math.round((high - low) * 0.15));
  const frame = { width: 600, height: 120, padTop: 8, padBottom: 8 };
  const points = chartPoints(
    days.map((one) => one.active ?? low),
    frame,
    { min: low - pad, max: high + pad },
  );
  // One path per run of read days: a day not read breaks the line rather than inventing it.
  const runs: (typeof points)[] = [];
  days.forEach((one, i) => {
    const point = points[i];
    if (one.active === null || point === undefined) {
      runs.push([]);
      return;
    }
    const last = runs.at(-1);
    if (last === undefined) runs.push([point]);
    else last.push(point);
  });
  const drawn = runs.filter((run) => run.length > 0);
  // A faint dash across each gap, so a missing day reads as missing and not as a drawing fault.
  const gaps = drawn.slice(1).flatMap((run, i) => {
    const from = drawn[i]?.at(-1);
    const to = run[0];
    return from === undefined || to === undefined ? [] : [{ from, to }];
  });
  // The scale's numbers sit at the height of the line's extremes, padding included.
  const at = (value: number): string => {
    const i = days.findIndex((one) => one.active === value);
    return `${String(((points[i]?.y ?? 0) / frame.height) * 100)}%`;
  };
  const first = read[0]?.toLocaleString('fr-FR') ?? '';
  const last = read.at(-1)?.toLocaleString('fr-FR') ?? '';
  const missing =
    unread === 0
      ? ''
      : `, ${String(unread)} jour${unread > 1 ? 's' : ''} pas encore lu${unread > 1 ? 's' : ''}`;
  return (
    <div
      className="ins-subs__chart"
      role="img"
      aria-label={`Abonnés actifs jour par jour, de ${first} à ${last}${missing}`}
    >
      <div className="ins-subs__scale" aria-hidden="true">
        {/* In the flow, unseen: it gives the column the width of the widest number. */}
        <i className="ins-subs__sizer">{high.toLocaleString('fr-FR')}</i>
        <span style={{ top: at(high) }}>{high.toLocaleString('fr-FR')}</span>
        {low === high ? null : <span style={{ top: at(low) }}>{low.toLocaleString('fr-FR')}</span>}
      </div>
      <div className="ins-subs__plot">
        <svg viewBox="0 0 600 120" preserveAspectRatio="none" aria-hidden="true">
          {gaps.map(({ from, to }) => (
            <line
              key={`gap-${String(from.x)}`}
              className="ins-subs__gap"
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {drawn.map((run) =>
            run.length === 1 && run[0] !== undefined ? (
              <line
                key={String(run[0].x)}
                className="ins-subs__line ins-subs__dot"
                x1={run[0].x}
                y1={run[0].y}
                x2={run[0].x}
                y2={run[0].y}
                vectorEffect="non-scaling-stroke"
              />
            ) : (
              <path
                key={String(run[0]?.x)}
                className="ins-subs__line"
                d={linePath(run)}
                vectorEffect="non-scaling-stroke"
              />
            ),
          )}
        </svg>
        <div className="ins-subs__hits" aria-hidden="true">
          {days.map((one) => (
            <span
              key={one.day}
              className="ins-subs__hit"
              {...tip.bind(
                {
                  title: dayLabel(one.day),
                  ...(one.active === null
                    ? { text: 'Pas encore lu chez Reveal.' }
                    : { rows: [['Abonnés actifs, en fin de journée', one.active.toLocaleString('fr-FR')]] }),
                },
                { above: true },
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** The change of a rate, in points: « −4 pts », never a percent of a percent. */
function PointsDelta({ current, previous }: { current: number; previous: number }): JSX.Element {
  const change = current - previous;
  const tone = change === 0 ? ' ins-delta-flat' : change > 0 ? ' nv-delta--better' : ' nv-delta--worse';
  const sign = change > 0 ? '+' : change < 0 ? '−' : '';
  return (
    <span className={`nv-delta${tone}`}>
      {sign}
      {String(Math.abs(change))}&nbsp;pt{Math.abs(change) > 1 ? 's' : ''}
    </span>
  );
}

/**
 * Subscribers, PPV and messages (ADR 0081): the daily snapshot of the platform's statistics, never money. A day not
 * read is never a zero, and a count the platform still computes says so.
 */
function Subscribers({ insights, tip }: { insights: AgencyInsights; tip: FloatingTip }): JSX.Element {
  const subs = insights.subscribers;
  if (subs === null) {
    return (
      <p className="nv-plate ins-empty">
        Les abonnés arrivent avec la première lecture des statistiques de Reveal, dans l’heure qui suit la
        connexion de la clé.
      </p>
    );
  }
  const { current, previous } = subs;
  const growth =
    current.activeAtEnd === null || current.activeBefore === null
      ? null
      : current.activeAtEnd - current.activeBefore;
  const net = current.unsubscribes === null ? null : current.newSubscribers - current.unsubscribes;
  const rate = ppvRate(current.ppvSent, current.ppvPurchased);
  // A comparison needs the whole period before, read: a half-read one would show a false +700 % (ADR 0081 § 4).
  const comparable = previous.daysRead === previous.days;
  const rateBefore = comparable ? ppvRate(previous.ppvSent, previous.ppvPurchased) : null;
  const tiles: readonly {
    label: string;
    value: string;
    note: string;
    delta: readonly [number, number] | null;
    lowerIsBetter?: true;
    points?: true;
  }[] = [
    {
      label: 'Nouveaux abonnés',
      value: countText(current.newSubscribers),
      note: 'gratuits et payants, sans les renouvellements',
      delta: comparable ? [current.newSubscribers, previous.newSubscribers] : null,
    },
    {
      label: 'Désabonnements',
      value: countText(current.unsubscribes),
      note: current.unsubscribes === null ? LATER : 'comptés le jour de l’échéance, pas du clic',
      delta:
        current.unsubscribes === null || previous.unsubscribes === null || !comparable
          ? null
          : [current.unsubscribes, previous.unsubscribes],
      lowerIsBetter: true,
    },
    {
      label: 'Solde',
      value: net === null ? '—' : signedCount(net),
      note: net === null ? LATER : 'nouveaux moins désabonnements',
      delta: null,
    },
    {
      label: 'Renouvellements',
      value: countText(current.renewals),
      note: current.renewals === null ? LATER : 'abonnements reconduits',
      delta:
        current.renewals === null || previous.renewals === null || !comparable
          ? null
          : [current.renewals, previous.renewals],
    },
    {
      label: 'Achat des PPV',
      value: rate === null ? '—' : `${String(rate)} %`,
      note:
        current.ppvSent === null
          ? LATER
          : `${countText(current.ppvPurchased)} achetés sur ${countText(current.ppvSent)} envoyés, Mass DM compris`,
      delta: rate === null || rateBefore === null ? null : [rate, rateBefore],
      points: true,
    },
    {
      label: 'Messages',
      value: countText(current.messagesSent),
      note:
        current.messagesSent === null || current.messagesReceived === null
          ? LATER
          : `envoyés, pour ${countText(current.messagesReceived)} reçus des fans`,
      delta:
        current.messagesSent === null || previous.messagesSent === null || !comparable
          ? null
          : [current.messagesSent, previous.messagesSent],
    },
  ];
  return (
    <div className="nv-plate ins-subs">
      <div className="ins-subs__lead">
        <div className="nv-figure">
          <span className="nv-figure__label">Abonnés actifs</span>
          {current.activeAtEnd === null ? (
            <span className="nv-figure__value ins-lead__value">—</span>
          ) : (
            <CountUp
              className="nv-figure__value ins-lead__value"
              value={current.activeAtEnd}
              format={formatCount}
            />
          )}
          <span className="nv-figure__note">
            {growth === null ? (
              <span>
                {current.activeAtEnd === null
                  ? 'le dernier jour n’est pas encore lu'
                  : 'rien à comparer avant la période'}
              </span>
            ) : (
              <span>
                <b className="ins-nowrap">{signedCount(growth)}</b> depuis le début de la période
              </span>
            )}
          </span>
        </div>
        <ActiveLine key={insights.period} days={subs.days} tip={tip} />
      </div>
      <dl className="ins-tiles ins-subs__tiles">
        {tiles.map((tile) => (
          <div key={tile.label} className="ins-tile ins-subs__tile">
            <dt>{tile.label}</dt>
            <dd>
              <span className="ins-tile__value">{tile.value}</span>
              {tile.delta === null ? null : tile.points === true ? (
                <PointsDelta current={tile.delta[0]} previous={tile.delta[1]} />
              ) : (
                <Delta
                  current={tile.delta[0]}
                  previous={tile.delta[1]}
                  lowerIsBetter={tile.lowerIsBetter === true}
                />
              )}
            </dd>
            <dd className="ins-tile__note">{tile.note}</dd>
          </div>
        ))}
      </dl>
      <p className="ins-subs__foot">
        Lu chez Reveal à {readAtLabel(subs.readAt, insights.timeZone)}
        {current.daysRead < current.days
          ? ` ; ${String(current.daysRead)} jour${current.daysRead > 1 ? 's' : ''} lu${current.daysRead > 1 ? 's' : ''} sur ${String(current.days)}, les autres arrivent avec la prochaine lecture.`
          : '.'}
      </p>
    </div>
  );
}

/** Sections' reading lines, by period. */
const DAILY_SUB: Readonly<Record<AgencyPeriod, string>> = {
  day: 'heure par heure depuis minuit',
  week: 'jour par jour, les 7 derniers jours',
  month: 'jour par jour, les 30 derniers jours',
  quarter: 'les 3 derniers mois, par type de vente',
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
            className="db-loading nv-plate ins-loading"
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
        <div className="nv-plate ins-none">
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
  // While another period loads the last one stays, dimmed, and says its own period, never the one asked.
  const shown = insights.period;
  const several = !oneCreator && insights.creators.length >= 2;
  const kinds = kindSlices(insights.kinds);
  const sellers = sellerSlices(insights.sellers);
  let at = index;
  const next = (): number => {
    at += 1;
    return at;
  };
  return (
    <div className="ins-body" aria-busy={query.isPlaceholderData}>
      <Section
        title={title}
        sub={`${AGAINST[shown]}, lus dans le registre des ventes`}
        index={at}
        control={control}
      >
        <Figures insights={insights} period={shown} several={several} tip={tip} />
        {insights.dollarsLeftOut ? (
          <p className="ins-note" role="note">
            Des ventes en dollars sont laissées de côté : aucun taux de change n’est encore connu (Équipe ›
            Paie).
          </p>
        ) : null}
        {insights.refundsWithoutSale > 0 ? (
          <p className="ins-note" role="note">
            {insights.refundsWithoutSale === 1
              ? 'Un remboursement de la période porte sur une vente plus ancienne que le registre : il n’est compté dans aucun chiffre.'
              : `${String(insights.refundsWithoutSale)} remboursements de la période portent sur des ventes plus anciennes que le registre : ils ne sont comptés dans aucun chiffre.`}
          </p>
        ) : null}
      </Section>

      <Section
        title="Chiffre d’affaires"
        sub={shown === 'day' ? `${DAILY_SUB.day}, ${zoneLabel(insights.timeZone)}` : DAILY_SUB[shown]}
        index={next()}
      >
        <Daily key={insights.period} insights={insights} tip={tip} />
      </Section>

      <Section
        title="Les abonnés"
        sub="lus chaque heure dans les statistiques de Reveal, jamais de l’argent"
        index={next()}
      >
        <Subscribers insights={insights} tip={tip} />
      </Section>

      <div className="ins-pair nv-enter" style={{ '--nv-i': next() }}>
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
        sub={`jour de la semaine et heure de chaque vente, ${zoneLabel(insights.timeZone)}`}
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
    </div>
  );
}
