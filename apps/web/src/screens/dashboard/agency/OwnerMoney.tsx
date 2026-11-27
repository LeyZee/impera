import type { AgencyInsights, AgencySteering } from '@impera/contracts';
import { chartPoints, linePath } from '@impera/design-system';
import {
  useId,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { CountUp, type FloatingTip } from '../parts';

import { Delta, firstDrawn } from './AgencyInsights';
import { aboutEuros, objectiveEuros, wholeEuros } from './Objectives';
import { cumulative, moneyThirds, paceOf, todayAndYesterday, type MoneyThird, type Pace } from './owner';
import { againstText, comparable, readName, shortDate } from './period';
import { dayLabel, euros, hoursLabel, moneyTip, shortDay, shortEuros } from './view';

/*
 * « L'argent » on the owner's Dashboard (maquette du 27/11, D1 and D2 of the audit): one figure, the period's revenue,
 * against the month's objective when one is set, with the mark of where the month should be by now; one curve, the
 * running total, against the objective's pace and the period compared; then today, where the money goes in one bar
 * that makes 100, and the change against the period compared. Every figure here is said once on the screen.
 */

const formatEuros = (cents: number): string => euros(Math.round(cents));

interface Point {
  readonly key: string;
  readonly title: string;
  readonly brief: string;
  /** The day's (or the hour's) revenue. */
  readonly cents: number;
  /** The running total at its end. */
  readonly total: number;
}

/** The period's points from the register's first day, one per day, or one per hour when the period is one day. */
function pointsOf(insights: AgencyInsights): Point[] {
  const oneDay = insights.from === insights.to;
  const raw = oneDay
    ? insights.hourly.map((hour) => ({
        key: String(hour.hour),
        title: hoursLabel(hour.hour),
        brief: hoursLabel(hour.hour),
        cents: hour.revenueMinor,
      }))
    : insights.days.slice(firstDrawn(insights)).map((day) => ({
        key: day.day,
        title: dayLabel(day.day),
        brief: shortDay(day.day),
        cents: day.revenueMinor,
      }));
  const totals = cumulative(raw.map((one) => one.cents));
  return raw.map((one, i) => ({ ...one, total: totals[i] ?? 0 }));
}

/** The period compared, day for day, as a running total; nothing when the register does not reach back to it. */
function comparedTotals(insights: AgencyInsights, length: number): number[] | null {
  if (insights.from === insights.to || !comparable(insights)) return null;
  const first = firstDrawn(insights);
  const before = insights.previousDays.slice(first, first + length).map((one) => one.revenueMinor);
  return before.length < 2 ? null : cumulative(before);
}

/**
 * The running total of the period, drawn in; the objective's pace dashed from zero to the objective at the month's
 * end; the period compared dotted behind. The pointer, the finger or the arrows read a day in the line above it.
 */
function TotalCurve({
  insights,
  pace,
  monthDays,
}: {
  insights: AgencyInsights;
  pace: Pace | null;
  /** The month's days when the objective's pace is drawn: the curve stops at today, the pace runs to the month's end. */
  monthDays: number | null;
}): JSX.Element | null {
  const [at, setAt] = useState<number | null>(null);
  const fill = useId();
  const plot = useRef<HTMLDivElement>(null);
  const points = pointsOf(insights);
  if (points.length < 2 || points.every((one) => one.cents === 0)) return null;
  const span = Math.max(points.length, monthDays ?? 0);
  const compared = comparedTotals(insights, span);
  const top = Math.max(
    1,
    points.at(-1)?.total ?? 0,
    pace?.goalMinor ?? 0,
    ...(compared === null ? [] : [compared.at(-1) ?? 0]),
  );
  const frame = { width: 600, height: 180, padTop: 8, padBottom: 4 };
  const xOf = (i: number): number => (span <= 1 ? 0 : (i / (span - 1)) * frame.width);
  const scale = (values: readonly number[]) =>
    chartPoints(values, frame, { min: 0, max: top }).map((point, i) => ({ ...point, x: xOf(i) }));
  const line = scale(points.map((one) => one.total));
  const behind = compared === null ? null : scale(compared);
  const goal =
    pace === null || monthDays === null
      ? null
      : scale(Array.from({ length: span }, (_, i) => Math.round((pace.goalMinor * (i + 1)) / span)));
  const last = line.at(-1);
  const first = line[0];
  const area =
    last === undefined || first === undefined
      ? ''
      : `${linePath(line)} L${String(last.x)},${String(frame.height)} L${String(first.x)},${String(frame.height)} Z`;
  const lit = at === null ? undefined : line[at];
  const dot = lit ?? last;
  const read = at === null ? undefined : points[at];
  const tone = pace?.tone ?? 'up';
  const pick = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    const share = (event.clientX - box.left) / Math.max(1, box.width);
    const index = Math.round(share * (span - 1));
    setAt(Math.min(points.length - 1, Math.max(0, Number.isFinite(index) ? index : 0)));
  };
  const onKey = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    setAt((now) => Math.min(points.length - 1, Math.max(0, (now ?? points.length - 1) + step)));
  };
  const paceAt = (i: number): number | null =>
    pace === null || monthDays === null ? null : Math.round((pace.goalMinor * (i + 1)) / span);
  const reading = (index: number, one: Point): JSX.Element => {
    const expected = paceAt(index);
    const gap = expected === null ? null : one.total - expected;
    return (
      <>
        <b>{one.title}</b> · {euros(one.total)} cumulés · {euros(one.cents)} ce jour-là
        {gap === null ? null : (
          <span className="own-curve__gap" data-tone={gap >= 0 ? 'up' : 'down'}>
            {' '}
            · {gap >= 0 ? '+' : '−'}
            {wholeEuros(Math.abs(gap))} face au rythme
          </span>
        )}
      </>
    );
  };
  return (
    <div className={`own-curve ins-curve ins-curve--${tone}`}>
      <p className="own-curve__read" aria-live="polite">
        {read === undefined || at === null ? (
          <>
            <span className="own-curve__key own-curve__key--line">Cumul</span>
            {goal === null ? null : (
              <span className="own-curve__key own-curve__key--pace">Rythme de l’objectif</span>
            )}
            {behind === null ? null : (
              <span className="own-curve__key own-curve__key--before">Période comparée</span>
            )}
          </>
        ) : (
          reading(at, read)
        )}
      </p>
      <div
        className="ins-curve__plot own-curve__plot"
        ref={plot}
        role="img"
        tabIndex={0}
        onKeyDown={onKey}
        onBlur={() => {
          setAt(null);
        }}
        aria-label={`Chiffre d’affaires cumulé, de ${points[0]?.title ?? ''} à ${points.at(-1)?.title ?? ''} : ${euros(points.at(-1)?.total ?? 0)}${pace === null ? '' : `, objectif ${objectiveEuros(pace.goalMinor)}`}`}
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
          {behind === null ? null : (
            <path className="own-curve__before" d={linePath(behind)} vectorEffect="non-scaling-stroke" />
          )}
          {goal === null ? null : (
            <path className="own-curve__pace" d={linePath(goal)} vectorEffect="non-scaling-stroke" />
          )}
          <path className="ins-curve__area" d={area} fill={`url(#${fill})`} />
          <path className="ins-curve__line" d={linePath(line)} vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="own-curve__top" aria-hidden="true">
          {shortEuros(top)}
        </span>
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
        <div
          className="ins-curve__hits"
          aria-hidden="true"
          onPointerMove={pick}
          onPointerDown={pick}
          onPointerLeave={(event) => {
            if (event.pointerType === 'mouse') setAt(null);
          }}
        />
      </div>
      <div className="own-curve__axis" aria-hidden="true">
        <span>{points[0]?.brief}</span>
        <span>{monthDays === null ? points.at(-1)?.brief : shortDate(lastDayOf(insights.from, span))}</span>
      </div>
    </div>
  );
}

/** The month's last day from its first and its length. */
function lastDayOf(from: string, days: number): string {
  const day = new Date(`${from}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days - 1);
  return day.toISOString().slice(0, 10);
}

/** The bar under the figure: its fill, the mark of where the month should be by now, and their words. */
function PaceBar({ pace }: { pace: Pace }): JSX.Element {
  return (
    <div className="own-pace" data-tone={pace.tone}>
      <div
        className="own-pace__bar"
        role="img"
        aria-label={`${String(pace.fill)} % de l’objectif atteint${pace.mark === null ? '' : `, ${String(pace.mark)} % attendus à ce jour`}`}
      >
        <span className="own-pace__fill" style={{ '--_w': `${String(pace.fill)}%` }} />
        {pace.mark === null ? null : (
          <span className="own-pace__mark" style={{ '--_x': `${String(pace.mark)}%` }} />
        )}
      </div>
      <div className="own-pace__legend">
        <span>{String(pace.fill)}&nbsp;% atteint</span>
        {pace.mark === null ? null : <span>le trait : où tu devrais être aujourd’hui</span>}
      </div>
    </div>
  );
}

/** Where the period's money goes, one bar that makes 100: the agency, the creators, the platform and the VAT. */
function Split({
  insights,
  thirds,
  tip,
}: {
  insights: AgencyInsights;
  thirds: readonly MoneyThird[];
  tip: FloatingTip;
}): JSX.Element {
  const { current, previous } = insights.totals;
  const before: Record<MoneyThird['key'], number> = {
    agency: previous.agencyMinor,
    creator: previous.creatorMinor,
    rest: Math.max(0, previous.revenueMinor - previous.agencyMinor - previous.creatorMinor),
  };
  const notes: Record<MoneyThird['key'], string> = {
    agency: 'Ce que la plateforme verse à l’agence, son propre chiffre.',
    creator: 'Ce que la plateforme verse aux créatrices, son propre chiffre.',
    rest: 'La TVA payée par les fans, reversée à l’État, et la commission que garde la plateforme.',
  };
  const tipOf = (third: MoneyThird): ReturnType<typeof moneyTip> =>
    moneyTip({
      title: third.label,
      cents: third.cents,
      previousCents: before[third.key],
      revenueMinor: current.revenueMinor,
      netMinor: null,
      text: notes[third.key],
      revenueShare: third.share,
    });
  return (
    <div className="own-split">
      <span className="own-fig__label">Où vont les {euros(current.revenueMinor)}</span>
      <div
        className="own-split__bar"
        role="img"
        aria-label={thirds
          .map((one) => `${one.label} ${euros(one.cents)}, ${String(one.share)} %`)
          .join(' ; ')}
      >
        {thirds.map((third) =>
          third.cents <= 0 ? null : (
            <span
              key={third.key}
              className="own-split__part"
              data-part={third.key}
              style={{ flexGrow: third.cents }}
              {...tip.bind(tipOf(third), { above: true })}
            />
          ),
        )}
      </div>
      <ul className="own-split__keys">
        {thirds.map((third) => (
          <li key={third.key} tabIndex={0} {...tip.bind(tipOf(third), { around: true })}>
            <span className="own-split__key" data-part={third.key} aria-hidden="true" />
            {third.label} <b>{euros(third.cents)}</b> {String(third.share)}&nbsp;%
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OwnerMoney({
  insights,
  steering,
  canSetObjective,
  onSetObjective,
  tip,
}: {
  insights: AgencyInsights;
  steering: AgencySteering | undefined;
  /** The owner sets the month's objectives: without one, the band leads there. */
  canSetObjective: boolean;
  onSetObjective: () => void;
  tip: FloatingTip;
}): JSX.Element {
  const { current, previous } = insights.totals;
  const pace = paceOf(insights.objectives);
  const several = insights.creators.length >= 2;
  const thirds = moneyThirds(current, several);
  const today = todayAndYesterday(steering);
  const month = insights.objectives;
  const isMonth = insights.span.unit === 'month';
  return (
    <div className="nv-plate own-money nv-enter" style={{ '--nv-i': 2 }}>
      <div className="own-money__top">
        <div className="own-money__lead">
          <span className="own-money__eyebrow">{readName(insights)}</span>
          <CountUp className="own-money__big" value={current.revenueMinor} format={formatEuros} />
          {pace === null ? (
            <>
              <span className="own-money__goal">ce que les fans ont payé, TVA comprise</span>
              {isMonth && canSetObjective ? (
                <button
                  type="button"
                  className="nv-btn nv-btn--soft nv-btn--sm own-money__set"
                  onClick={onSetObjective}
                >
                  Fixer l’objectif du mois
                </button>
              ) : null}
            </>
          ) : (
            <>
              <span className="own-money__goal">
                sur <b>{objectiveEuros(pace.goalMinor)}</b> d’objectif du mois
              </span>
              <PaceBar pace={pace} />
              <span className="own-money__pill" data-tone={pace.tone}>
                <span className="own-money__pill-dot" aria-hidden="true" />
                {pace.word}
              </span>
              {pace.projectedMinor === null ? null : (
                <span className="own-money__then">
                  À ce rythme, fin du mois vers{' '}
                  <b>{aboutEuros(pace.projectedMinor).replace('environ ', '')}</b>.
                </span>
              )}
            </>
          )}
        </div>
        <TotalCurve
          insights={insights}
          pace={pace}
          monthDays={pace === null || month === null ? null : month.days}
        />
      </div>
      <div className="own-money__row">
        {today === null ? null : (
          <div className="own-fig">
            <span className="own-fig__label">Aujourd’hui</span>
            <span className="own-fig__value">{euros(today.today)}</span>
            <span className="own-fig__sub">
              depuis minuit{today.yesterday === null ? '' : ` · hier ${euros(today.yesterday)}`}
            </span>
          </div>
        )}
        {current.revenueMinor > 0 ? <Split insights={insights} thirds={thirds} tip={tip} /> : null}
        <div className="own-fig">
          <span className="own-fig__label">Face à la période comparée</span>
          <span className="own-fig__value own-fig__value--delta">
            <Delta current={current.revenueMinor} previous={previous.revenueMinor} />
          </span>
          <span className="own-fig__sub">
            {againstText(insights)} : {euros(previous.revenueMinor)}
          </span>
        </div>
      </div>
    </div>
  );
}
