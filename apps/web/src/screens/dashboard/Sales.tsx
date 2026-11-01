import {
  areaPath,
  chartPoints,
  linePath,
  nearestIndex,
  niceTicks,
  placeSegmentThumb,
  ringDash,
} from '@nirvana/design-system';
import { useLayoutEffect, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import { changePercent, chartTip, eur, leverView, sharePercent, signed, trendSeries } from './logic';
import { PERIODS, type Lever, type Period, type Sales, type SalesSeries } from './model';
import { CountUp, type FloatingTip } from './parts';

const SUB: Record<Period, string> = {
  day: 'cumulé depuis minuit, l’agent hier en pointillés',
  week: 'les 7 derniers jours',
  month: 'les 30 derniers jours',
};
const AGAINST: Record<Period, string> = {
  day: 'par rapport à hier à la même heure',
  week: 'par rapport à la semaine d’avant',
  month: 'par rapport aux 30 jours d’avant',
};
const RING_RADIUS = 28;

/** Arrow keys of the radio group and the way they move (as Réglages › Apparence). */
const STEPS: Readonly<Record<string, 1 | -1>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

const formatEur = (value: number): string => eur(value);
const formatPercent = (value: number): string => `${String(Math.round(value))} %`;

/**
 * The period control of the sales and of the fans' path: a segment whose thumb slides. A radio group: one stop in the
 * Tab order (the checked period), the arrows move and pick.
 */
export function PeriodControl({
  period,
  onChange,
}: {
  period: Period;
  onChange: (period: Period) => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const index = PERIODS.findIndex((p) => p.id === period);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    // First paint in place; later changes slide and squash.
    placeSegmentThumb(
      element,
      index,
      PERIODS.length,
      placed.current ? (thumbRef.current ?? undefined) : undefined,
    );
    placed.current = true;
  }, [index]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = STEPS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = PERIODS[(index + step + PERIODS.length) % PERIODS.length];
    if (next === undefined) return;
    ref.current?.querySelector<HTMLButtonElement>(`[data-period="${next.id}"]`)?.focus();
    onChange(next.id);
  };

  return (
    <div
      className="nv-seg nv-glass nv-glass--thin"
      role="radiogroup"
      aria-label="Période"
      ref={ref}
      onKeyDown={onKeyDown}
    >
      <span className="nv-seg__thumb nv-glass nv-glass--thin" ref={thumbRef} aria-hidden="true" />
      {PERIODS.map((p) => (
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

/** Level 2: what the agent sold, against the chatters, then the three levers of the corpus. */
export function SalesPanel({
  period,
  sales,
  tip,
}: {
  period: Period;
  sales: Sales;
  tip: FloatingTip;
}): JSX.Element {
  const change = changePercent(sales.agent, sales.agentBefore);
  const share = sharePercent(sales.agent, sales.chatters);
  return (
    <div className="db-sales">
      <div className="db-big nv-plate">
        <div className="db-big__row">
          <div className="nv-figure">
            <span className="nv-figure__label">Vendu par l’agent</span>
            <CountUp className="nv-figure__value" value={sales.agent} format={formatEur} />
            <span className="nv-figure__note">
              <span className={`nv-delta nv-delta--${change >= 0 ? 'better' : 'worse'}`}>
                {signed(change)} %
              </span>
              {AGAINST[period]}
            </span>
          </div>
          <div
            className="db-share"
            {...tip.bind({
              title: 'Qui a vendu',
              rows: [
                ['Agent', eur(sales.agent)],
                ['Chatteurs', eur(sales.chatters)],
                ['Total', eur(sales.agent + sales.chatters)],
              ],
            })}
          >
            <div className="nv-ring" role="img" aria-label={`${String(share)} % vendu par l’agent`}>
              <svg viewBox="0 0 66 66" aria-hidden="true">
                <circle className="nv-ring__track" cx="33" cy="33" r={RING_RADIUS} />
                <circle
                  className="nv-ring__value"
                  cx="33"
                  cy="33"
                  r={RING_RADIUS}
                  strokeDasharray={ringDash(share / 100, RING_RADIUS)}
                />
              </svg>
              <span className="nv-ring__label" aria-hidden="true">
                <CountUp value={share} format={formatPercent} />
                <span className="nv-ring__sub">agent</span>
              </span>
            </div>
            <div className="nv-legend">
              <span className="nv-legend__item">
                <i className="nv-legend__key" />
                Agent <b>{eur(sales.agent)}</b>
              </span>
              <span className="nv-legend__item">
                <i className="nv-legend__key" style={{ '--_c': 'var(--nv-sale)' }} />
                Chatteurs <b>{eur(sales.chatters)}</b>
              </span>
              <span className="nv-legend__item" hidden={sales.series.past === undefined}>
                <i className="nv-legend__key nv-legend__key--past" />
                Agent hier
              </span>
            </div>
          </div>
        </div>
        <SalesChart key={period} period={period} series={sales.series} />
      </div>
      <div className="db-levers">
        {sales.levers.map((lever, k) => (
          <LeverCard key={lever.id} lever={lever} seed={k} tip={tip} />
        ))}
      </div>
    </div>
  );
}

export function salesSub(period: Period): string {
  return SUB[period];
}

const CHART = { left: 46, bottom: 24, top: 10 } as const;

/** The `nv-chart` of the sales: agent in neon, chatters in `sale`, yesterday dotted; a table tip on hover. */
function SalesChart({ period, series }: { period: Period; series: SalesSeries }): JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 240 });
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const element = box.current;
    if (element === null) return undefined;
    const measure = (): void => {
      setSize({ width: element.clientWidth, height: element.clientHeight || 240 });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const { width, height } = size;
  const plotWidth = Math.max(0, width - CHART.left - 8);
  const ticks = niceTicks(Math.max(...series.agent, ...series.chatters, ...(series.past ?? [0])) * 1.05, 3);
  const max = ticks[ticks.length - 1] ?? 1;
  const frame = { width: plotWidth, height, padTop: CHART.top, padBottom: CHART.bottom };
  const base = height - CHART.bottom;
  const agent = chartPoints(series.agent, frame, { max });
  const chatters = chartPoints(series.chatters, frame, { max });
  const past = series.past === undefined ? null : chartPoints(series.past, frame, { max });
  const y = (value: number): number => base - (value / max) * (base - CHART.top);
  const count = agent.length;
  const xTicks =
    period === 'day'
      ? [0, 6, 12, 18, count - 1]
      : period === 'week'
        ? [0, 2, 4, count - 1]
        : [0, 7, 14, 21, count - 1];
  const end = agent[count - 1];
  const at =
    hover === null ? null : { a: agent[hover], c: chatters[hover], tip: chartTip(period, series, hover) };

  return (
    <div
      className={`nv-chart db-chart${at === null ? '' : ' is-hovering'}`}
      ref={box}
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setHover(nearestIndex(event.clientX - rect.left - CHART.left, count, plotWidth));
      }}
      onPointerLeave={() => {
        setHover(null);
      }}
    >
      {width === 0 ? null : (
        <svg
          viewBox={`0 0 ${String(width)} ${String(height)}`}
          height={height}
          role="img"
          aria-label="Ventes de l’agent et des chatteurs"
        >
          {ticks.map((value) => (
            <g key={value}>
              <line className="nv-chart__grid" x1={CHART.left} x2={width} y1={y(value)} y2={y(value)} />
              <text className="nv-chart__axis" x={CHART.left - 8} y={y(value) + 4} textAnchor="end">
                {value === 0 ? '0' : `${String(value)} €`}
              </text>
            </g>
          ))}
          <g transform={`translate(${String(CHART.left)},0)`}>
            {xTicks.map((i) => (
              <text
                key={i}
                className="nv-chart__axis"
                x={agent[i]?.x ?? 0}
                y={height - 4}
                textAnchor={i === 0 ? 'start' : i === count - 1 ? 'end' : 'middle'}
              >
                {series.labels[i]}
              </text>
            ))}
            {past === null ? null : (
              <path className="nv-chart__line nv-chart__line--past" pathLength={1} d={linePath(past)} />
            )}
            <path className="nv-chart__area" d={areaPath(agent, base)} />
            <path
              className="nv-chart__line"
              style={{ '--_c': 'var(--nv-sale)' }}
              pathLength={1}
              d={linePath(chatters)}
            />
            <path className="nv-chart__line" pathLength={1} d={linePath(agent)} />
            {end === undefined || period !== 'day' ? null : (
              <>
                <circle className="nv-chart__end" cx={end.x} cy={end.y} r={5} />
                <circle
                  cx={end.x}
                  cy={end.y}
                  r={4}
                  fill="var(--nv-neon)"
                  stroke="var(--nv-void)"
                  strokeWidth={2}
                />
              </>
            )}
            {at?.a === undefined || at.c === undefined ? null : (
              <>
                <line className="nv-chart__cursor" x1={at.a.x} x2={at.a.x} y1={CHART.top} y2={base} />
                <circle
                  className="nv-chart__dot"
                  style={{ '--_c': 'var(--nv-sale)' }}
                  cx={at.c.x}
                  cy={at.c.y}
                  r={4}
                />
                <circle className="nv-chart__dot" cx={at.a.x} cy={at.a.y} r={5} />
              </>
            )}
          </g>
        </svg>
      )}
      {at?.a === undefined || at.c === undefined ? null : (
        <div
          className="nv-chart__tip nv-chart__tip--table"
          style={{
            '--nv-tip-x': `${String(Math.min(Math.max(at.a.x + CHART.left, 90), width - 90))}px`,
            '--nv-tip-y': `${String(Math.min(at.a.y, at.c.y))}px`,
          }}
        >
          <span className="nv-chart__tip-l">{at.tip.title}</span>
          <span className="nv-chart__tip-k">Agent</span>
          <b className="nv-chart__tip-n">{at.tip.agent}</b>
          <span className="nv-chart__tip-k" style={{ '--_c': 'var(--nv-sale)' }}>
            Chatteurs
          </span>
          <b className="nv-chart__tip-n">{at.tip.chatters}</b>
          <span className="nv-chart__tip-ft">{at.tip.footer}</span>
        </div>
      )}
    </div>
  );
}

/** One corpus lever as a `nv-stat`: its value, its evolution, and the real trend of the period. */
function LeverCard({ lever, seed, tip }: { lever: Lever; seed: number; tip: FloatingTip }): JSX.Element {
  const view = leverView(lever);
  const color = view.better ? 'var(--nv-success)' : 'var(--nv-warning)';
  const trend = trendSeries(lever.previous, lever.current, seed);
  const low = Math.min(...trend);
  const high = Math.max(...trend);
  const points = chartPoints(
    trend,
    { width: 300, height: 56, padTop: 8 },
    { min: low - (high - low) * 0.6, max: high },
  );
  const [title, text] = lever.tip;
  return (
    <div className="nv-stat nv-plate db-lever" tabIndex={0} {...tip.bind({ title, text })}>
      <span className="nv-stat__label">{lever.label}</span>
      <span className="db-lever__v">
        <span className="nv-stat__value">{view.value}</span>
        {view.unit === '' ? null : <small>{view.unit}</small>}
        <span className={`nv-delta nv-delta--${view.better ? 'better' : 'worse'}`}>{view.delta}</span>
      </span>
      <svg className="nv-stat__spark" viewBox="0 0 300 56" preserveAspectRatio="none" aria-hidden="true">
        <path d={areaPath(points, 56)} fill={color} fillOpacity={0.12} />
        <path
          className="nv-draw"
          pathLength={1}
          d={linePath(points)}
          fill="none"
          stroke={color}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
