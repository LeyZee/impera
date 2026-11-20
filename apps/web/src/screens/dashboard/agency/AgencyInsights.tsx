import { AGENCY_TRANSFER_VAT_BPS, type AgencyInsights } from '@impera/contracts';
import { chartPoints, linePath, niceTicks } from '@impera/design-system';
import { Link } from '@tanstack/react-router';
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { CountUp, Section, type FloatingTip } from '../parts';

import { PeriodBar } from './PeriodBar';
import { NotYours, useAgencyInsights } from './api';
import {
  againstText,
  conclusionWait,
  comparable,
  readName,
  shortDate,
  spanText,
  type AgencySelection,
} from './period';
import { useNarrow } from './useNarrow';
import {
  arcs,
  bestSlot,
  busiest,
  changeOf,
  dayLabel,
  byWeek,
  dayStacks,
  deltaText,
  euros,
  exactEuros,
  heatOf,
  hourLabel,
  hoursLabel,
  kindSlices,
  moneyParts,
  moneyShares,
  moneyTip,
  percentText,
  sharesOf,
  type MoneyPart,
  OTHER,
  OTHER_KINDS_NOTE,
  ppvRate,
  readAtLabel,
  REFUND_KIND,
  refundDateLabel,
  refundDelayLabel,
  refundsKept,
  sellerKeyOf,
  SELLER_NOTES,
  sellerRanking,
  shareOf,
  shortDay,
  shortEuros,
  signedCount,
  slotLabel,
  STACKS,
  topFansWords,
  WEEKDAYS,
  WEEKDAYS_SHORT,
  zoneLabel,
  type Slice,
} from './view';
import './agency.css';

import { initialOf } from '@/lib/utils';
import { Select, type SelectOption } from '@/shell/Select';
import { Failure } from '@/shell/states';

/*
 * « L'agence en chiffres » (ADR 0078): what the registers of sales say about the agency, or about one creator, over a
 * period against the one before. The server computes every figure from the local register; this screen never calls a
 * platform and never receives a fan. Colours follow the entity (a creator, a kind of sale), never its rank.
 */

const STEPS: Readonly<Record<string, 1 | -1>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
/** « 20 % »: the transfers' VAT rate as the code holds it (ADR 0106 § 7), never written twice. */
const VAT_RATE = `${(AGENCY_TRANSFER_VAT_BPS / 100).toLocaleString('fr-FR')}\u00a0%`;
const formatEuros = (cents: number): string => euros(Math.round(cents));
const formatCount = (n: number): string => Math.round(n).toLocaleString('fr-FR');

/**
 * Whether the register reaches back to the comparison's first day (ADR 0146 § 4): when it does not, no percentage of
 * money or fans is shown, never a false rise. The subscribers keep their own rule (ADR 0081 § 4).
 */
const Comparable = createContext(true);

/**
 * « +18 % » in the colour of better or worse; nothing when there is nothing to compare with, nor when nothing then and
 * nothing now: a « 0 % » next to a zero is noise (recette 11/11, ADM-07).
 */
function Delta({
  current,
  previous,
  lowerIsBetter = false,
}: {
  current: number;
  previous: number;
  lowerIsBetter?: boolean;
}): JSX.Element | null {
  const compared = useContext(Comparable);
  if (!compared || (current === 0 && previous === 0)) return null;
  const change = changeOf(current, previous);
  if (change === null) return null;
  const better = lowerIsBetter ? change < 0 : change > 0;
  const tone = change === 0 ? ' ins-delta-flat' : better ? ' nv-delta--better' : ' nv-delta--worse';
  return <span className={`nv-delta${tone}`}>{deltaText(change)}</span>;
}

/** One point of the curve: its label, its revenue, and the compared day's when the register holds it. */
interface CurvePoint {
  readonly key: string;
  readonly title: string;
  /** The same moment without its weekday, « 10 nov. », for a phone's line. */
  readonly brief: string;
  readonly cents: number;
  readonly compared: { readonly title: string; readonly cents: number } | null;
}

/**
 * The points under the lead figure (ADR 0146 § 5): every day from the register's first day when it falls in the period
 * (the line no longer sinks to the right), each with the day compared, aligned day for day, when the register holds
 * that day (the compared line stops where the register begins, never falls to zero); one day read hour by hour.
 */
/** The first day the curves draw (ADR 0146 § 5): the register's first day when it falls in the period, else the first. */
function firstDrawn(insights: AgencyInsights): number {
  const since = insights.registerSince;
  if (since === null || since <= insights.from) return 0;
  return Math.max(
    0,
    insights.days.findIndex((one) => one.day >= since),
  );
}

export function curvePoints(insights: AgencyInsights): CurvePoint[] {
  if (insights.from === insights.to) {
    return insights.hourly.map((hour) => ({
      key: String(hour.hour),
      title: hoursLabel(hour.hour),
      brief: hoursLabel(hour.hour),
      cents: hour.revenueMinor,
      compared: null,
    }));
  }
  const since = insights.registerSince;
  const first = firstDrawn(insights);
  const today = insights.span.today;
  return insights.days.slice(first).map((one, i) => {
    const before = insights.previousDays[i + first];
    return {
      key: one.day,
      title: dayLabel(one.day),
      brief: shortDay(one.day),
      cents: one.revenueMinor,
      compared:
        before === undefined || (since !== null && before.day < since)
          ? null
          : { title: spanText(before.day, before.day, today), cents: before.revenueMinor },
    };
  });
}

/**
 * What the lead's note says while a day of the curve is read (relecture Design 19/11): the day, its revenue, and the
 * day compared when the register holds it, « mar. 10 nov. : 153 €, contre 268,60 € le 10 oct. ». No floating tip on
 * this curve: the note under the figure reads the day in place, the curve keeps all its height.
 */
export function readingOf(point: CurvePoint, brief = false): string {
  // A phone's line has no room for the weekday: shortened, never cut (relecture Design 19/11).
  const day = `${brief ? point.brief : point.title} : ${euros(point.cents)}`;
  return point.compared === null
    ? day
    : `${day}, contre ${euros(point.compared.cents)} le ${point.compared.title}`;
}

/**
 * The revenue day by day under the lead figure, the comparison as a discreet dashed line behind, aligned day for day.
 * A hairline and a dot follow the pointer or the finger to the nearest day, and the lead's note reads that day in place
 * (`onRead`), back to its sentence when the pointer leaves. The curve takes the card's free height, 96px at least.
 */
function RevenueCurve({
  insights,
  tone,
  onRead,
}: {
  insights: AgencyInsights;
  /** Above the period compared or nothing to compare with, or below it: the same word as the « n % » beside. */
  tone: Trend;
  /** The day read, as the note says it, or null when the pointer or the finger leaves the curve. */
  onRead: (point: CurvePoint | null) => void;
}): JSX.Element | null {
  const [hover, setHover] = useState<number | null>(null);
  const fill = useId();
  const layer = useRef<HTMLDivElement>(null);
  // A finger has no hover: the day a tap reads stays until a tap off the curve or a scroll puts the sentence back.
  const reading = hover !== null;
  useEffect(() => {
    if (!reading) return undefined;
    const done = (): void => {
      setHover(null);
      onRead(null);
    };
    const onDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && layer.current?.contains(event.target) === true) return;
      done();
    };
    document.addEventListener('pointerdown', onDown, true);
    addEventListener('scroll', done, { capture: true, passive: true });
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      removeEventListener('scroll', done, { capture: true });
    };
  }, [reading, onRead]);
  const points = curvePoints(insights);
  if (points.length < 2 || points.every((one) => one.cents === 0 && (one.compared?.cents ?? 0) === 0))
    return null;
  const frame = { width: 600, height: 96, padTop: 10, padBottom: 6 };
  const top = Math.max(1, ...points.map((one) => Math.max(one.cents, one.compared?.cents ?? 0)));
  const line = chartPoints(
    points.map((one) => one.cents),
    frame,
    { min: 0, max: top },
  );
  const all = chartPoints(
    points.map((one) => one.compared?.cents ?? 0),
    frame,
    { min: 0, max: top },
  );
  // The compared line where the register holds its days only: one run, from its first held day.
  const behind = all.filter((_, i) => points[i]?.compared !== null);
  const last = line.at(-1);
  const lit = hover === null ? undefined : line[hover];
  const dot = lit ?? last;
  const area =
    last === undefined || line[0] === undefined
      ? ''
      : `${linePath(line)} L${String(last.x)},${String(frame.height)} L${String(line[0].x)},${String(frame.height)} Z`;
  const read = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    const at = Math.round(((event.clientX - box.left) / Math.max(1, box.width)) * (points.length - 1));
    const index = Math.min(points.length - 1, Math.max(0, Number.isFinite(at) ? at : 0));
    setHover(index);
    const one = points[index];
    onRead(one ?? null);
  };
  return (
    <div className={`ins-curve ins-curve--${tone}`}>
      <div
        className="ins-curve__plot"
        role="img"
        aria-label={`Chiffre d’affaires ${insights.from === insights.to ? 'heure par heure' : 'jour par jour'}, de ${points[0]?.title ?? ''} à ${points.at(-1)?.title ?? ''}${behind.length > 0 ? ', avec la période comparée' : ''}`}
      >
        <svg
          viewBox={`0 0 ${String(frame.width)} ${String(frame.height)}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={fill} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" className="ins-curve__fill-top" />
              <stop offset="1" className="ins-curve__fill-bottom" />
            </linearGradient>
          </defs>
          {behind.length > 1 ? (
            <path className="ins-curve__compared" d={linePath(behind)} vectorEffect="non-scaling-stroke" />
          ) : null}
          <path className="ins-curve__area" d={area} fill={`url(#${fill})`} />
          <path className="ins-curve__line" d={linePath(line)} vectorEffect="non-scaling-stroke" />
        </svg>
        {lit === undefined ? null : (
          <span
            className="ins-curve__hair"
            style={{ '--_x': `${String((lit.x / frame.width) * 100)}%` }}
            aria-hidden="true"
          />
        )}
        {dot === undefined ? null : (
          <span
            className="ins-curve__dot"
            style={{
              '--_x': `${String((dot.x / frame.width) * 100)}%`,
              '--_y': `${String((dot.y / frame.height) * 100)}%`,
            }}
            aria-hidden="true"
          />
        )}
        {/* One layer for the pointer and the finger alike: the nearest day follows it (dataviz: the crosshair finds
            the X), a tap shows it, a glide moves it. */}
        <div
          className="ins-curve__hits"
          aria-hidden="true"
          onPointerMove={read}
          onPointerDown={read}
          ref={layer}
          onPointerLeave={(event) => {
            if (event.pointerType !== 'mouse') return;
            setHover(null);
            onRead(null);
          }}
        />
      </div>
    </div>
  );
}

/** A curve's colour against the period compared: green above it (or nothing to compare with), amber below. */
type Trend = 'up' | 'down';

function trendOf(current: number, previous: number, compared: boolean): Trend {
  const change = compared ? changeOf(current, previous) : null;
  return change !== null && change < 0 ? 'down' : 'up';
}

/**
 * A tile's small curve: the same days as the lead curve, from the register's first day, nothing for one day read hour
 * by hour (its parts are not kept by the hour) nor for fewer than two days. Values only; the tile says the figure.
 */
export function sparkValues(
  insights: AgencyInsights,
  pick: (day: AgencyInsights['days'][number]) => number,
): number[] | null {
  if (insights.from === insights.to) return null;
  const values = insights.days.slice(firstDrawn(insights)).map(pick);
  return values.length < 2 || values.every((one) => one === 0) ? null : values;
}

/**
 * The small curve at the net's foot (lot couleurs, 17/11; under the net only, Charles 19/11: the parts drew the same
 * shape again): 1.5px, no axis, no point, a fill of 12 % at most, in the trend's colour. Decorative: the tile's figure and its « n % » say it,
 * so it is hidden from assistive technologies.
 */
function Spark({ values, tone }: { values: readonly number[]; tone: Trend }): JSX.Element {
  const fill = useId();
  const frame = { width: 200, height: 32, padTop: 3, padBottom: 2 };
  const low = Math.min(0, ...values);
  const high = Math.max(1, ...values);
  const line = chartPoints(values, frame, { min: low, max: high });
  const first = line[0];
  const last = line.at(-1);
  const area =
    first === undefined || last === undefined
      ? ''
      : `${linePath(line)} L${String(last.x)},${String(frame.height)} L${String(first.x)},${String(frame.height)} Z`;
  return (
    <svg
      className={`ins-spark ins-spark--${tone}`}
      viewBox={`0 0 ${String(frame.width)} ${String(frame.height)}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={fill} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" className="ins-spark__fill-top" />
          <stop offset="1" className="ins-spark__fill-bottom" />
        </linearGradient>
      </defs>
      <path className="ins-spark__area" d={area} fill={`url(#${fill})`} />
      <path className="ins-spark__line" d={linePath(line)} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

interface Tile {
  readonly label: string;
  readonly value: string;
  readonly note: string;
  readonly delta: readonly [number, number] | null;
  readonly lowerIsBetter?: boolean;
  /** A money tile's destination (ADR 0106 § 11): its colour's round key beside the title. */
  readonly part?: MoneyPart['key'];
  /** A money tile explains itself on hover, focus or a tap (ADR 0106 § 12). */
  readonly tip?: ReturnType<typeof moneyTip>;
  /** Its small curve, day by day, and its colour. */
  readonly spark?: { readonly values: readonly number[]; readonly tone: Trend };
}

function Tiles({
  tiles,
  from,
  label,
  tip,
  pair = false,
}: {
  tiles: readonly Tile[];
  from: number;
  label: string;
  tip: FloatingTip;
  /** Two tiles on a row of their own: each takes half of it, no empty columns after them. */
  pair?: boolean;
}): JSX.Element {
  return (
    <dl className={pair ? 'ins-tiles ins-tiles--pair' : 'ins-tiles'} aria-label={label}>
      {tiles.map((tile, i) => (
        <div
          key={tile.label}
          className="nv-plate ins-tile nv-enter"
          style={{ '--nv-i': from + i }}
          {...(tile.tip === undefined ? {} : { tabIndex: 0, ...tip.bind(tile.tip, { around: true }) })}
        >
          <dt>
            {tile.part === undefined ? null : (
              <span className="ins-tile__key" data-part={tile.part} aria-hidden="true" />
            )}
            {tile.label}
          </dt>
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
          {tile.note === '' ? null : <dd className="ins-tile__note">{tile.note}</dd>}
          {tile.spark === undefined ? null : (
            <dd className="ins-tile__spark">
              <Spark values={tile.spark.values} tone={tile.spark.tone} />
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}

/**
 * « Où va l'argent » (ADR 0106 § 5, § 10 to § 13): the period's revenue as one tall segmented bar, the fans' VAT and
 * the platform's commission first, then the net's two parts, each destination in its colour, the same as on the
 * tiles. Every block and every line of the legend (the table) explains itself on hover, focus or a tap.
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
  const { current, previous } = insights.totals;
  const parts = moneyParts(current, previous, several);
  const whole = parts.reduce((sum, part) => sum + part.cents, 0);
  // Shares are of the revenue the card's title shows, never of the blocks' sum, which a block brought to zero changes.
  const revenue = current.revenueMinor;
  // Rounded together, so the legend adds up to 100 % (largest remainder), the amounts untouched.
  const shares = moneyShares(current);
  const tipOf = (part: MoneyPart): ReturnType<typeof moneyTip> =>
    moneyTip({
      title: part.label,
      cents: part.cents,
      previousCents: part.previousCents,
      revenueMinor: revenue,
      netMinor: part.ofNet ? current.netMinor : null,
      text: part.note,
      revenueShare: shares.ofRevenue[part.key],
      ...(part.key === 'creator' || part.key === 'agency' ? { netShare: shares.ofNet[part.key] } : {}),
    });
  return (
    <article className="nv-plate ins-money nv-enter" style={{ '--nv-i': 6 }}>
      <h3 className="nv-h3 ins-card__title">
        Où va l’argent
        {whole > 0 ? <span className="ins-card__total">{euros(revenue)}</span> : null}
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
              .map((part) => `${part.label} ${euros(part.cents)}, ${String(shares.ofRevenue[part.key])} %`)
              .join(' ; ')}`}
          >
            {parts.map((part) =>
              part.cents <= 0 ? null : (
                <span
                  key={part.key}
                  className="ins-money__part"
                  data-part={part.key}
                  style={{ flexGrow: part.cents }}
                  {...tip.bind(tipOf(part), { above: true })}
                />
              ),
            )}
          </div>
          <ul className="ins-money__legend">
            {parts.map((part) => (
              <li key={part.key} tabIndex={0} {...tip.bind(tipOf(part), { around: true })}>
                <span className="ins-money__key" data-part={part.key} aria-hidden="true" />
                <span className="ins-money__label">{part.label}</span>
                <span className="ins-money__value">{euros(part.cents)}</span>
                <span className="ins-money__share">{String(shares.ofRevenue[part.key])}&nbsp;%</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </article>
  );
}

/**
 * The line under the lead figure: the days compared and their amount; the register's first day when it does not reach
 * back to them (ADR 0146 § 4), never a percentage then.
 */
function leadNote(insights: AgencyInsights): string {
  const { current, previous } = insights.totals;
  const against = againstText(insights);
  if (!comparable(insights) && insights.registerSince !== null) {
    return `${against} : le registre commence le ${shortDate(insights.registerSince)}, rien à comparer`;
  }
  if (changeOf(current.revenueMinor, previous.revenueMinor) === null)
    return `${against} : aucune vente alors`;
  return `${against} (${euros(previous.revenueMinor)})`;
}

function Figures({
  insights,
  several,
  tip,
}: {
  insights: AgencyInsights;
  several: boolean;
  tip: FloatingTip;
}): JSX.Element {
  const { current, previous } = insights.totals;
  const fansVat = current.revenueMinor - current.revenueExclVatMinor;
  const commission = current.revenueExclVatMinor - current.netMinor;
  // ADR 0106 § 4: the parts say their share of the net, the base a percentage agreed with a creator is set on.
  // The two parts' shares of the net are rounded together, to 100 %, as in « Où va l'argent ».
  const shares = moneyShares(current);
  const ofNet = (key: 'creator' | 'agency'): string =>
    current.netMinor > 0 ? `${percentText(shares.ofNet[key])} du net` : 'aucun net sur la période';
  const creatorLabel = several ? 'Part des créatrices' : 'Part de la créatrice';
  const compared = comparable(insights);
  // The day read on the curve: the note and its pill say that day while it is read (relecture Design 19/11).
  const [read, setRead] = useState<CurvePoint | null>(null);
  const narrow = useNarrow();
  const sparkOf = (
    pick: (day: AgencyInsights['days'][number]) => number,
    tone: Trend,
  ): Pick<Tile, 'spark'> => {
    const values = sparkValues(insights, pick);
    return values === null ? {} : { spark: { values, tone } };
  };
  const tipOf = (
    title: string,
    cents: number,
    previousCents: number,
    part: 'creator' | 'agency' | null,
    text: string,
  ): ReturnType<typeof moneyTip> =>
    moneyTip({
      title,
      cents,
      previousCents,
      revenueMinor: current.revenueMinor,
      netMinor: part === null ? null : current.netMinor,
      text,
      ...(part === null ? {} : { revenueShare: shares.ofRevenue[part], netShare: shares.ofNet[part] }),
    });
  const money: readonly Tile[] = [
    {
      label: 'Net',
      value: euros(current.netMinor),
      note: `après ${euros(fansVat)} de TVA des fans et ${euros(commission)} de commission de la plateforme`,
      delta: [current.netMinor, previous.netMinor],
      // The net is the two parts (ADR 0106 § 4): its curve is their sum, in the trend's colour as the lead's.
      ...sparkOf(
        (day) => day.agencyMinor + day.creatorMinor,
        trendOf(current.netMinor, previous.netMinor, compared),
      ),
      tip: tipOf(
        'Net',
        current.netMinor,
        previous.netMinor,
        null,
        'Ce qui reste après la TVA des fans et la commission de la plateforme : la part de l’agence et celle des créatrices.',
      ),
    },
    {
      label: creatorLabel,
      value: euros(current.creatorMinor),
      note: ofNet('creator'),
      delta: [current.creatorMinor, previous.creatorMinor],
      part: 'creator',
      tip: tipOf(
        creatorLabel,
        current.creatorMinor,
        previous.creatorMinor,
        'creator',
        several
          ? 'Ce que la plateforme leur verse, son propre chiffre.'
          : 'Ce que la plateforme lui verse, son propre chiffre.',
      ),
    },
    {
      label: 'Part de l’agence',
      value: euros(current.agencyMinor),
      note: ofNet('agency'),
      delta: [current.agencyMinor, previous.agencyMinor],
      part: 'agency',
      tip: tipOf(
        'Part de l’agence',
        current.agencyMinor,
        previous.agencyMinor,
        'agency',
        'Ce que la plateforme verse à l’agence, son propre chiffre.',
      ),
    },
    {
      label: 'TVA en plus sur les virements',
      value: euros(current.agencyTransferVatMinor),
      note: `estimation, ${VAT_RATE} de la part de l’agence, à reverser à l’État`,
      delta: null,
      // Not a part of the revenue: no share of it (ADR 0106 § 6).
      tip: moneyTip({
        title: 'TVA en plus sur les virements',
        cents: current.agencyTransferVatMinor,
        previousCents: previous.agencyTransferVatMinor,
        revenueMinor: 0,
        netMinor: null,
        text: `Une estimation : la plateforme ajoute ${VAT_RATE} de TVA à la part de l’agence sur chaque virement. Elle se reverse à l’État ; le montant exact est sur le relevé de virement.`,
      }),
    },
  ];
  // The paying fans and their average spend live in « Les fans qui paient », never twice (recette visuelle 16/11,
  // PIL-21): two figures here, the sales and the refunds.
  const activity: readonly Tile[] = [
    {
      label: 'Ventes',
      value: current.sales.toLocaleString('fr-FR'),
      note: 'abonnements, PPV, tips… une ligne chacune',
      delta: [current.sales, previous.sales],
    },
    {
      label: 'Remboursements',
      value: current.refunds.toLocaleString('fr-FR'),
      // A zero says itself: « aucun remboursement » under it would say it twice (PIL-21).
      note:
        current.sales === 0
          ? 'aucune vente sur la période'
          : current.refunds === 0
            ? ''
            : `${String(shareOf(current.refunds, current.sales))} % des ventes`,
      delta: [current.refunds, previous.refunds],
      lowerIsBetter: true,
    },
  ];
  return (
    <div className="ins-figures-stack">
      <div className="ins-figures">
        <div className="nv-plate ins-lead nv-enter" style={{ '--nv-i': 1 }}>
          {/* A money tile, so its tip too (ADR 0106 § 12, PAY-16): to the cent, against the period before. On the
              figure alone, never the whole card: the curve under it reads its own days. */}
          <div
            className="nv-figure"
            tabIndex={0}
            {...tip.bind(
              moneyTip({
                title: 'Chiffre d’affaires',
                cents: current.revenueMinor,
                previousCents: previous.revenueMinor,
                // The whole itself: no share of it to say.
                revenueMinor: 0,
                netMinor: null,
                text: 'Ce que les fans ont payé, TVA comprise, avant la commission de la plateforme.',
              }),
              { around: true },
            )}
          >
            <span className="nv-figure__label">Chiffre d’affaires</span>
            <CountUp
              className="nv-figure__value ins-lead__value"
              value={current.revenueMinor}
              format={formatEuros}
            />
            <span className="nv-figure__note">
              {/* The day read on the curve takes the period's place, its pill and its sentence each over theirs, kept in
                  place hidden, so nothing moves; a day with nothing compared has no pill, its place kept. */}
              <span className="ins-lead__pill">
                <span aria-hidden={read !== null}>
                  <Delta current={current.revenueMinor} previous={previous.revenueMinor} />
                </span>
                <span aria-hidden={read === null}>
                  {read?.compared == null ? null : (
                    <Delta current={read.cents} previous={read.compared.cents} />
                  )}
                </span>
              </span>
              <span className="ins-lead__note">
                <span aria-hidden={read !== null}>{leadNote(insights)}</span>
                {/* Said to screen readers as it changes, the curve itself being a picture to them. */}
                <span aria-hidden={read === null} aria-live="polite">
                  {read === null ? '' : readingOf(read, narrow)}
                </span>
              </span>
            </span>
            <span className="ins-lead__sub">ce que les fans ont payé, TVA comprise</span>
          </div>
          <RevenueCurve
            insights={insights}
            tone={trendOf(current.revenueMinor, previous.revenueMinor, compared)}
            onRead={setRead}
          />
        </div>
        <Tiles tiles={money} from={2} label="L’argent" tip={tip} />
      </div>
      <MoneySplit insights={insights} several={several} tip={tip} />
      <Tiles tiles={activity} from={7} label="Les ventes" tip={tip} pair />
    </div>
  );
}

/**
 * The revenue day by day (hour by hour today, week by week over three months on a phone), stacked by kind of sale, the
 * ring's colours. One stop for the keyboard, the arrows walk the columns.
 */
function Daily({ insights, tip }: { insights: AgencyInsights; tip: FloatingTip }): JSX.Element {
  const narrow = useNarrow();
  const today = insights.from === insights.to;
  const days = today
    ? insights.hourly.map((hour) => ({
        key: String(hour.hour),
        label: hourLabel(hour.hour),
        title: hoursLabel(hour.hour),
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
  // A long period on a phone reads week by week: ninety columns do not fit a thumb.
  const weekly = narrow && insights.days.length > 45;
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
  // The last day's label ends at the card's edge; on a phone the one before it, a few columns away, would run into it.
  const last = columns.length - 1;
  const labelled = (i: number): boolean =>
    i % every === 0 && !(narrow && i !== last && last % every === 0 && every > 1 && last - i <= every);
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
                {labelled(i) ? column.label : ''}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * A ring and its legend: a slice lit on hover, focus or touch shows in the middle and in the legend. At rest the middle
 * says the total in euros, what the ring cuts (ADM-05); a legend row that needs a word says it in the screen's tip,
 * never in the browser's title (ADM-06).
 */
function Ring({
  title,
  slices,
  tipFor,
  tip,
}: {
  title: string;
  slices: readonly Slice[];
  tipFor?: string;
  tip: FloatingTip;
}): JSX.Element {
  const [lit, setLit] = useState<number | null>(null);
  // The pointer that pressed a legend row: its focus and its click are that pointer's, not the keyboard's.
  const pressedBy = useRef<string | null>(null);
  const radius = 52;
  const shown = slices.filter((slice) => slice.cents > 0);
  const total = shown.reduce((sum, slice) => sum + slice.cents, 0);
  // Settled together, so the legend adds up to 100 % where each share rounded alone could say 99 or 101.
  const shares = sharesOf(
    shown.map((slice) => slice.cents),
    total,
  );
  const geometry = arcs(
    shown.map((slice) => slice.cents),
    radius,
  );
  const litSlice = lit === null ? null : shown[lit];
  const litShare = lit === null ? 0 : (shares[lit] ?? 0);
  return (
    <article className="nv-plate ins-ring-card">
      <h3 className="nv-h3 ins-card__title">{title}</h3>
      {total <= 0 ? (
        <p className="ins-empty">Aucune vente sur la période.</p>
      ) : (
        <div className="ins-ring-row">
          <div
            className={lit === null ? 'ins-ring' : 'ins-ring is-lit'}
            role="img"
            aria-label={`${title} : ${shown.map((s, i) => `${s.label} ${String(shares[i] ?? 0)} %`).join(', ')}`}
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
                  <b className={euros(total).length > 7 ? 'ins-ring__value is-long' : 'ins-ring__value'}>
                    {euros(total)}
                  </b>
                  <span className="ins-ring__sub">au total</span>
                </>
              ) : (
                <>
                  <b className="ins-ring__value">{String(litShare)}&nbsp;%</b>
                  <span className="ins-ring__sub">{litSlice.label}</span>
                </>
              )}
            </span>
          </div>
          <ul className="ins-legend">
            {shown.map((slice, i) => {
              const help = slice.key === tipFor ? OTHER_KINDS_NOTE : undefined;
              const told = help === undefined ? null : tip.bind({ title: slice.label, text: help });
              return (
                <li key={slice.key}>
                  <button
                    type="button"
                    className={lit === i ? 'ins-legend__row is-on' : 'ins-legend__row'}
                    // A mouse lights on entering and leaving puts out; a finger's tap lights or puts out (`onClick`);
                    // the keyboard lights on focus. A tap's own entering and focus would light before its click undoes it.
                    onPointerEnter={(event) => {
                      if (event.pointerType === 'mouse') setLit(i);
                    }}
                    onPointerMove={told?.onPointerMove}
                    onPointerLeave={(event) => {
                      told?.onPointerLeave(event);
                      if (event.pointerType === 'mouse') setLit(null);
                    }}
                    onPointerDown={(event) => {
                      told?.onPointerDown(event);
                      pressedBy.current = event.pointerType;
                    }}
                    onFocus={(event) => {
                      if (pressedBy.current === null) {
                        told?.onFocus(event);
                        setLit(i);
                      }
                    }}
                    onBlur={() => {
                      told?.onBlur();
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
                    <span className="ins-legend__share">{String(shares[i] ?? 0)}&nbsp;%</span>
                    <Delta current={slice.cents} previous={slice.previousCents} />
                  </button>
                </li>
              );
            })}
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

/**
 * Who sold, one line each, bars from the same start: widths are shares of the biggest line's revenue. The sellers come
 * first, ranked; the sales of no seller after them, unranked, under a rule (recette visuelle 16/11, PIL-03).
 */
function Sellers({ insights, tip }: { insights: AgencyInsights; tip: FloatingTip }): JSX.Element {
  const best = Math.max(0, ...insights.sellers.map((seller) => seller.revenueMinor));
  if (insights.sellers.length === 0)
    return <p className="nv-plate ins-empty">Aucune vente sur la période.</p>;
  const { ranked, rest } = sellerRanking(insights.sellers);
  return (
    <ol className="nv-plate ins-rank" aria-label="Classement de qui a vendu">
      {[...ranked, ...rest].map((one, i) => {
        const name = one.seller.kind === 'member' ? one.seller.name : SELLER_NAME[one.seller.kind];
        const average = one.sales > 0 ? Math.round(one.revenueMinor / one.sales) : null;
        const isRanked = i < ranked.length;
        return (
          <li
            key={one.seller.kind === 'member' ? one.seller.memberId : one.seller.kind}
            className="ins-rank__row nv-enter"
            style={{ '--nv-i': i }}
            data-kind={one.seller.kind}
            data-rule={i === ranked.length && i > 0 ? '' : undefined}
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
              {isRanked ? String(i + 1) : null}
            </span>
            <span className="nv-avatar ins-rank__face" aria-hidden="true">
              {one.seller.kind === 'member' ? initialOf(one.seller.name) : SELLER_MARK[one.seller.kind]}
            </span>
            <span className="ins-rank__who">
              <span className="ins-rank__name">{name}</span>
              <span className="ins-rank__line">
                <span className="ins-nowrap">
                  {one.sales.toLocaleString('fr-FR')} vente{one.sales > 1 ? 's' : ''}
                </span>
                {average === null ? null : (
                  <>
                    <span className="ins-rank__sep" aria-hidden="true">
                      {' · '}
                    </span>
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
            {/* A configuration gap, not a seller: said under its line, with the way to close it (ADM-06). */}
            {one.seller.kind === 'unlinked' ? (
              <span className="ins-rank__fix">
                <span>
                  {one.sales.toLocaleString('fr-FR')} vente{one.sales > 1 ? 's' : ''} d’un compte Reveal que
                  personne n’a relié à un membre.
                </span>
                <Link to="/equipe/reveal" className="nv-btn nv-btn--soft nv-btn--sm">
                  Relier
                </Link>
              </span>
            ) : null}
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

/**
 * « Quand ça vend »: a day-of-the-week by hour map, darker where the money comes in. One stop for the keyboard, as the
 * chart's columns: the arrows walk the hours and the days, each cell says its hour and its amount (ADM-09).
 */
function Hours({ insights, tip }: { insights: AgencyInsights; tip: FloatingTip }): JSX.Element {
  const max = Math.max(0, ...insights.hours.flat());
  const all = insights.hours.flat().reduce((sum, cents) => sum + cents, 0);
  const peak = busiest(insights.hours);
  const slot = bestSlot(insights.hours);
  const grid = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState<{ day: number; hour: number } | null>(null);
  if (peak === null || slot === null)
    return <p className="nv-plate ins-empty">Aucune vente sur la période.</p>;
  const at = focus ?? { day: peak.day, hour: peak.hour };
  const wait = conclusionWait(insights);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const moves: Readonly<Record<string, readonly [number, number]>> = {
      ArrowRight: [0, 1],
      ArrowLeft: [0, -1],
      ArrowDown: [1, 0],
      ArrowUp: [-1, 0],
      Home: [0, -24],
      End: [0, 24],
    };
    const move = moves[event.key];
    if (move === undefined) return;
    event.preventDefault();
    const next = {
      day: Math.min(Math.max(0, at.day + move[0]), insights.hours.length - 1),
      hour: Math.min(Math.max(0, at.hour + move[1]), 23),
    };
    setFocus(next);
    grid.current
      ?.querySelector<HTMLButtonElement>(`[data-cell="${String(next.day)}-${String(next.hour)}"]`)
      ?.focus();
  };
  return (
    <div className="nv-plate ins-hours" data-pending={wait === null ? undefined : ''}>
      {/* The map stays, grey; the sentence that reads it waits for enough sales and hindsight (ADR 0092 § 5). */}
      {wait === null ? (
        <p className="ins-hours__lead">
          Le créneau qui rapporte le plus : <b>{slotLabel(slot.from)}</b>, {String(slot.share)}&nbsp;% du
          chiffre d’affaires. Le pic :{' '}
          <b className="ins-nowrap">
            {WEEKDAYS[peak.day]?.toLowerCase()}, {hourLabel(peak.hour)}
          </b>
          .
        </p>
      ) : (
        <p className="ins-hours__lead">{wait}</p>
      )}
      <div
        className="ins-heat"
        role="group"
        aria-label="Chiffre d’affaires par jour de la semaine et par heure : flèches pour passer d’une case à l’autre"
        ref={grid}
        onKeyDown={onKeyDown}
      >
        <span aria-hidden="true" />
        {Array.from({ length: 24 }, (_, hour) => (
          <span key={hour} className="ins-heat__hour" aria-hidden="true">
            {hour % 3 === 0 ? hourLabel(hour) : ''}
          </span>
        ))}
        {insights.hours.map((row, day) => (
          <div key={WEEKDAYS[day]} className="ins-heat__row" role="presentation">
            <span className="ins-heat__day" aria-hidden="true" style={{ gridArea: `${String(day + 2)} / 1` }}>
              {WEEKDAYS_SHORT[day]}
            </span>
            {row.map((cents, hour) => {
              const when = `${WEEKDAYS[day] ?? ''}, ${hoursLabel(hour)}`;
              const bound = tip.bind({
                title: when,
                rows: [
                  ['Chiffre d’affaires', euros(cents)],
                  ['Part de la période', `${String(shareOf(cents, all))} %`],
                ],
              });
              return (
                <button
                  type="button"
                  key={hour}
                  className="ins-heat__cell"
                  // Every cell placed, so the best slot's ring lies over them without moving one.
                  style={{ '--_h': heatOf(cents, max), gridArea: `${String(day + 2)} / ${String(hour + 2)}` }}
                  data-empty={cents > 0 ? undefined : ''}
                  data-cell={`${String(day)}-${String(hour)}`}
                  tabIndex={day === at.day && hour === at.hour ? 0 : -1}
                  aria-label={`${when} : ${euros(cents)}`}
                  {...bound}
                  onFocus={(event) => {
                    setFocus({ day, hour });
                    bound.onFocus(event);
                  }}
                />
              );
            })}
          </div>
        ))}
        {/* The slot that brings in the most, ringed as one block over its three hours of every day. */}
        {wait === null && (
          <span
            className="ins-heat__best"
            aria-hidden="true"
            style={{
              gridColumn: `${String(slot.from + 2)} / span 3`,
              gridRow: `2 / span ${String(insights.hours.length)}`,
            }}
          />
        )}
      </div>
      <div className="ins-heat__scale" aria-hidden="true">
        <span>moins</span>
        <i />
        <span>plus</span>
      </div>
    </div>
  );
}

const ALL = 'all';

/** A seller as « Qui a vendu » names him. */
const sellerLabel = (seller: AgencyInsights['refundList'][number]['seller']): string =>
  seller.kind === 'member' ? seller.name : SELLER_NAME[seller.kind];

/**
 * The period's refunds one by one (ADR 0092 § 4): when, whose, what, how much, who sold it and how long after the sale.
 * Read only; filtered by creator and by the sale's chatter, each filter shown only when it has a choice to make.
 */
function Refunds({ insights }: { insights: AgencyInsights }): JSX.Element {
  const [creatorId, setCreatorId] = useState<string>(ALL);
  const [seller, setSeller] = useState<string>(ALL);
  const list = insights.refundList;
  const names = new Map(insights.creators.map((one) => [one.creatorId, one.name] as const));
  const creatorChoices: SelectOption<string>[] = [
    { value: ALL, label: 'Toutes les créatrices' },
    ...insights.creators
      .filter((one) => list.some((refund) => refund.creatorId === one.creatorId))
      .map((one) => ({ value: one.creatorId, label: one.name })),
  ];
  const sellers = new Map(list.map((one) => [sellerKeyOf(one.seller), sellerLabel(one.seller)] as const));
  const sellerChoices: SelectOption<string>[] = [
    { value: ALL, label: 'Tous les chatteurs' },
    ...[...sellers].map(([value, label]) => ({ value, label })),
  ];
  const kept = refundsKept(list, creatorId, seller);
  const several = insights.creators.length > 1;
  return (
    <div className="nv-plate ins-refunds">
      {creatorChoices.length > 2 || sellerChoices.length > 2 ? (
        <div className="ins-refunds__filters">
          {several && creatorChoices.length > 2 ? (
            <Select
              className="ins-refunds__select"
              ariaLabel="Créatrice"
              listWidth="options"
              search="never"
              value={creatorId}
              options={creatorChoices}
              onChange={setCreatorId}
            />
          ) : null}
          {sellerChoices.length > 2 ? (
            <Select
              className="ins-refunds__select"
              ariaLabel="Chatteur de la vente"
              listWidth="options"
              search="never"
              value={seller}
              options={sellerChoices}
              onChange={setSeller}
            />
          ) : null}
        </div>
      ) : null}
      {kept.length === 0 ? (
        <p className="ins-refunds__none">Aucun remboursement pour ce choix.</p>
      ) : (
        <table className="ins-refunds__table">
          <thead>
            <tr>
              <th scope="col">Date</th>
              {several ? <th scope="col">Créatrice</th> : null}
              <th scope="col">Type</th>
              <th scope="col" className="ins-refunds__money">
                Montant
              </th>
              <th scope="col" className="ins-refunds__seller">
                Chatteur de la vente
              </th>
              <th scope="col">Délai depuis la vente</th>
            </tr>
          </thead>
          <tbody>
            {kept.map((one, i) => (
              <tr key={`${one.refundedAt}-${String(i)}`}>
                <td className="ins-refunds__date">{refundDateLabel(one.refundedAt, insights.timeZone)}</td>
                {several ? <td className="ins-refunds__who">{names.get(one.creatorId) ?? '—'}</td> : null}
                <td className="ins-refunds__kind">{REFUND_KIND[one.kind]}</td>
                <td className="ins-refunds__money">
                  {one.amountMinor === null ? '—' : exactEuros(one.amountMinor)}
                </td>
                <td
                  className="ins-refunds__seller"
                  data-named={one.seller.kind === 'member' || one.seller.kind === 'agent' ? '' : undefined}
                >
                  {sellerLabel(one.seller)}
                </td>
                <td className="ins-refunds__delay">{refundDelayLabel(one.delayDays)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** The paying fans: how many, how many new, and how much the ten biggest weigh. */
function Fans({ insights }: { insights: AgencyInsights }): JSX.Element {
  const { fans } = insights;
  if (fans.paying === 0) return <p className="nv-plate ins-empty">Aucun fan n’a payé sur la période.</p>;
  const newShare = shareOf(fans.newPaying, fans.paying);
  const top = fans.topTenShare ?? 0;
  // Ten at most: with fewer paying fans, the count they are (PAY-16, « Les 10 fans » for 3).
  const biggest = topFansWords(fans.paying);
  const wait = conclusionWait(insights);
  return (
    <div className="nv-plate ins-fans" data-pending={wait === null ? undefined : ''}>
      <div className="ins-fans__meter">
        <p className="ins-fans__lead">
          {biggest.lead} <b>{String(top)}&nbsp;%</b> du chiffre d’affaires.
        </p>
        <span className="ins-meter" role="img" aria-label={`${String(top)} % fait par ${biggest.short}`}>
          <span style={{ '--_w': `${String(top)}%` }} />
        </span>
        <p className="ins-fans__hint">
          {/* The meter and its share stay, grey; what they mean waits for enough sales and hindsight (ADR 0092 § 5). */}
          {wait ??
            (top >= 60
              ? 'Très concentré : perdre un de ces fans se sentirait tout de suite. Il faut élargir la base.'
              : top >= 35
                ? 'Assez concentré : quelques gros fans portent une bonne part des ventes.'
                : 'Bien réparti : les ventes ne dépendent pas de quelques fans.')}
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
            {/* Their share of the paying fans, in the neutral pill the other figures wear (PIL-21). */}
            <span className="nv-delta ins-delta-flat">{String(newShare)}&nbsp;%</span>
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

type SubscriberDays = NonNullable<AgencyInsights['subscribers']>['days'];

/**
 * A line needs two days read one after the other: a lone dot, or two far apart, draws a chart of nothing, and the
 * counts take the whole card instead (recette visuelle 16/11, PIL-08).
 */
function hasLine(days: SubscriberDays): boolean {
  return days.some((one, i) => one.active !== null && (days[i + 1]?.active ?? null) !== null);
}

/** Active subscribers day by day: a line over the read days, broken where a day is not read yet. */
function ActiveLine({ days, tip }: { days: SubscriberDays; tip: FloatingTip }): JSX.Element | null {
  const read = days.map((one) => one.active).filter((n): n is number => n !== null);
  if (!hasLine(days)) return null;
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
  // The last day not read yet: the last count read stands, with its day, never a bare « — » (PIL-08).
  const lastRead =
    current.activeAtEnd === null ? subs.days.findLast((one) => one.active !== null) : undefined;
  const active = current.activeAtEnd ?? lastRead?.active ?? null;
  const chart = hasLine(subs.days);
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
    <div className={chart ? 'nv-plate ins-subs' : 'nv-plate ins-subs ins-subs--flat'}>
      <div className="ins-subs__lead">
        <div className="nv-figure">
          <span className="nv-figure__label">Abonnés actifs</span>
          {active === null ? (
            <span className="nv-figure__value ins-lead__value">—</span>
          ) : (
            <CountUp className="nv-figure__value ins-lead__value" value={active} format={formatCount} />
          )}
          <span className="nv-figure__note">
            {growth === null ? (
              <span>
                {current.activeAtEnd !== null
                  ? 'rien à comparer avant la période'
                  : lastRead === undefined
                    ? 'le dernier jour n’est pas encore lu'
                    : `au ${shortDay(lastRead.day)}, le dernier jour lu`}
              </span>
            ) : (
              <span>
                <b className="ins-nowrap">{signedCount(growth)}</b> depuis le début de la période
              </span>
            )}
          </span>
        </div>
        <ActiveLine key={`${insights.from}:${insights.to}`} days={subs.days} tip={tip} />
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

/** The chart's reading line (ADR 0146): the unit of its columns and the days it covers. */
function dailySub(insights: AgencyInsights): string {
  if (insights.from === insights.to) return `heure par heure, ${zoneLabel(insights.timeZone)}`;
  const span = spanText(insights.from, insights.to, insights.span.today);
  return `jour par jour, ${span}, par type de vente`;
}

/**
 * The insights of the agency (`creatorId` null) or of one creator, from `index` in the page's entrance order. The
 * days' control sits on the first section.
 */
export function AgencyInsightsPanel({
  selection,
  onSelection,
  creatorId,
  creatorName,
  onCreator,
  canOpenSettings,
  tip,
  index = 1,
}: {
  selection: AgencySelection;
  onSelection: (selection: AgencySelection) => void;
  creatorId: string | null;
  creatorName?: string;
  onCreator?: ((creatorId: string) => void) | undefined;
  /** The owner links the registers (Réglages › Plateformes): the empty screen leads there. */
  canOpenSettings: boolean;
  tip: FloatingTip;
  index?: number;
}): JSX.Element | null {
  const query = useAgencyInsights(selection, creatorId);
  const control = <PeriodBar selection={selection} insights={query.data ?? null} onChange={onSelection} />;
  const oneCreator = creatorId !== null;
  const title = oneCreator ? `Les chiffres de ${creatorName ?? 'la créatrice'}` : 'L’agence en chiffres';

  if (query.error instanceof NotYours) return null;
  if (query.data === undefined) {
    return (
      <Section title={title} sub="lus dans le registre des ventes" index={index} control={control}>
        {query.isError ? (
          <Failure onRetry={() => void query.refetch()} />
        ) : (
          // The shape of the figures, so nothing jumps when they come (ADM-21): the lead and its four tiles of money,
          // the card of where the money goes, the two tiles of the sales.
          <div
            className="ins-figures-stack"
            aria-label="Chargement des chiffres"
            role="status"
            aria-busy="true"
          >
            <div className="ins-figures">
              <div className="db-loading nv-plate ins-lead ins-loading" />
              <div className="ins-tiles">
                {Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="db-loading nv-plate ins-tile ins-loading--tile" />
                ))}
              </div>
            </div>
            <div className="db-loading nv-plate ins-loading--split" />
            <div className="ins-tiles ins-tiles--pair">
              {Array.from({ length: 2 }, (_, i) => (
                <div key={i} className="db-loading nv-plate ins-tile ins-loading--tile" />
              ))}
            </div>
          </div>
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
              Relier dans Réglages › Plateformes
            </Link>
          ) : null}
        </div>
      </Section>
    );
  }
  // While other days load the last ones stay, dimmed, and say their own days, never the ones asked.
  const several = !oneCreator && insights.creators.length >= 2;
  const kinds = kindSlices(insights.kinds);
  let at = index;
  const next = (): number => {
    at += 1;
    return at;
  };
  return (
    <Comparable.Provider value={comparable(insights)}>
      <div className="ins-body" aria-busy={query.isPlaceholderData}>
        <Section
          title={title}
          sub={`${readName(insights)}, ${againstText(insights)}, lus dans le registre des ventes`}
          index={at}
          control={control}
        >
          <Figures insights={insights} several={several} tip={tip} />
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

        <Section title="Chiffre d’affaires" sub={dailySub(insights)} index={next()}>
          <Daily key={`${insights.from}:${insights.to}`} insights={insights} tip={tip} />
        </Section>

        <Section
          title="Les abonnés"
          sub="lus chaque heure dans les statistiques de Reveal, jamais de l’argent"
          index={next()}
        >
          {/* The subscribers' comparison follows their own rule (ADR 0081 § 4), not the register's first day. */}
          <Comparable.Provider value>
            <Subscribers insights={insights} tip={tip} />
          </Comparable.Provider>
        </Section>

        {/* « Qui vend » said the ranking's amounts a second time: one card now, the ranking (recette visuelle 16/11,
            PIL-02). */}
        <div className="nv-enter" style={{ '--nv-i': next() }}>
          <Ring title="D’où vient l’argent" slices={kinds} tipFor="other" tip={tip} />
        </div>

        <Section
          title="Qui a vendu"
          sub="chaque chatteur et l’agent, le plus gros chiffre d’abord ; les ventes sans vendeur en dessous"
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

        {insights.refundList.length > 0 ? (
          <Section title="Les remboursements" sub="un par un, lus dans le registre des ventes" index={next()}>
            <Refunds insights={insights} />
          </Section>
        ) : null}
      </div>
    </Comparable.Provider>
  );
}
