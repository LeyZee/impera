import type { AiForecastRange } from '@impera/contracts';
import { areaPath, chartPoints, linePath, nearestIndex, niceTicks } from '@impera/design-system';
import { useLayoutEffect, useRef, useState, type JSX } from 'react';

import { axisEur } from './view';

import { dayLabel, shortDay } from '@/screens/dashboard/agency/view';

/** A day of the curve: spent (the days before today) or forecast (today to the end of next month). */
export interface CurveDay {
  readonly day: string;
  readonly spent: number | null;
}

const PAD = { left: 44, right: 8, top: 14, bottom: 24 } as const;
const DAY_MS = 86_400_000;

function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Every day from `from` to `to`, both included. */
export function daysBetween(from: string, to: string): string[] {
  const count = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
  return Array.from({ length: Math.max(0, count) }, (_, i) => addDays(from, i));
}

/**
 * The spend a day (ADR 0091 § 8): the latest full days as a line, then from today to the end of next month the pace
 * as a dashed line in its corridor from the calmer to the busier week, and the daily cap in amber. A tip on hover
 * gives the day's figure.
 */
export function ForecastChart({
  past,
  future,
  perDay,
  capEur,
  format,
}: {
  past: readonly CurveDay[];
  future: readonly string[];
  perDay: AiForecastRange;
  capEur: number;
  format: (eur: number) => string;
}): JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 200 });
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const element = box.current;
    if (element === null) return undefined;
    const measure = (): void => {
      setSize({ width: element.clientWidth, height: element.clientHeight || 200 });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const { width, height } = size;
  const plotWidth = Math.max(0, width - PAD.left - PAD.right);
  const days = [...past.map((d) => d.day), ...future];
  const count = days.length;
  const spentMax = Math.max(0, ...past.map((d) => d.spent ?? 0));
  const ticks = niceTicks(Math.max(spentMax, perDay.high, capEur) * 1.08, 3);
  const max = ticks[ticks.length - 1] ?? 1;
  const frame = { width: plotWidth, height, padTop: PAD.top, padBottom: PAD.bottom };
  const base = height - PAD.bottom;
  const y = (value: number): number => base - (Math.min(value, max) / max) * (base - PAD.top);
  const step = count > 1 ? plotWidth / (count - 1) : 0;
  const x = (i: number): number => i * step;

  const spentPoints = chartPoints(
    past.map((d) => d.spent ?? 0),
    { ...frame, width: past.length > 1 ? x(past.length - 1) : 0 },
    { max },
  );
  // The forecast starts on the last day spent, so the two lines meet.
  const from = Math.max(0, past.length - 1);
  const flat = (value: number): string => `M${String(x(from))},${String(y(value))} H${String(x(count - 1))}`;
  const corridor = `M${String(x(from))},${String(y(perDay.high))} H${String(x(count - 1))} V${String(y(perDay.low))} H${String(x(from))} Z`;
  const todayX = past.length < count ? x(past.length) : null;
  const firstOfNext = future.findIndex((day) => day.endsWith('-01'));
  const allTicks = [
    0,
    ...(todayX === null ? [] : [past.length]),
    ...(firstOfNext > 0 ? [past.length + firstOfNext] : []),
    count - 1,
  ];
  // A label too close to the one before is left out (a phone has no room for « aujourd’hui » and « 1 déc. »).
  const xTicks = allTicks.filter(
    (i, n) => n === 0 || i === count - 1 || x(i) - x(allTicks[n - 1] ?? 0) >= 64,
  );
  const capAbove = capEur <= max;

  const at = hover;
  const atDay = at === null ? undefined : days[at];
  const atSpent = at !== null && at < past.length ? (past[at]?.spent ?? 0) : null;
  const tipY = atSpent === null ? y(perDay.high) : y(atSpent);

  return (
    <div
      className={`nv-chart cia-curve${at === null ? '' : ' is-hovering'}`}
      ref={box}
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setHover(nearestIndex(event.clientX - rect.left - PAD.left, count, plotWidth));
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
          aria-label={`Dépense par jour : les ${String(past.length)} derniers jours, puis environ ${format(perDay.realistic)} par jour jusqu’à la fin du mois prochain, plafond de ${format(capEur)}`}
        >
          {ticks.map((value) => (
            <g key={value}>
              <line
                className="nv-chart__grid"
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(value)}
                y2={y(value)}
              />
              <text className="nv-chart__axis" x={PAD.left - 8} y={y(value) + 4} textAnchor="end">
                {value === 0 ? '0' : axisEur(value)}
              </text>
            </g>
          ))}
          <g transform={`translate(${String(PAD.left)},0)`}>
            {xTicks.map((i, n) => (
              <text
                key={i}
                className="nv-chart__axis"
                x={x(i)}
                y={height - 4}
                textAnchor={n === 0 ? 'start' : i === count - 1 ? 'end' : 'middle'}
              >
                {i === past.length ? 'aujourd’hui' : shortDay(days[i] ?? '')}
              </text>
            ))}
            {todayX === null ? null : (
              <line className="cia-curve__today" x1={todayX} x2={todayX} y1={PAD.top} y2={base} />
            )}
            <path className="cia-curve__corridor" d={corridor} />
            <path className="nv-chart__area" d={areaPath(spentPoints, base)} />
            <path className="nv-chart__line" pathLength={1} d={linePath(spentPoints)} />
            <path className="cia-curve__pace" d={flat(perDay.realistic)} />
            {capAbove ? (
              <>
                <line className="cia-curve__cap" x1={0} x2={x(count - 1)} y1={y(capEur)} y2={y(capEur)} />
                <text className="cia-curve__cap-label" x={x(count - 1)} y={y(capEur) - 6} textAnchor="end">
                  {`plafond ${format(capEur)} / jour`}
                </text>
              </>
            ) : null}
            {at === null ? null : (
              <>
                <line className="nv-chart__cursor" x1={x(at)} x2={x(at)} y1={PAD.top} y2={base} />
                <circle
                  className="nv-chart__dot"
                  cx={x(at)}
                  cy={atSpent === null ? y(perDay.realistic) : y(atSpent)}
                  r={5}
                />
              </>
            )}
          </g>
        </svg>
      )}
      {atDay === undefined || at === null ? null : (
        <div
          className="nv-chart__tip nv-chart__tip--table"
          style={{
            '--nv-tip-x': `${String(Math.min(Math.max(x(at) + PAD.left, 95), width - 95))}px`,
            '--nv-tip-y': `${String(Math.max(tipY, PAD.top + 40))}px`,
          }}
        >
          <span className="nv-chart__tip-l">{dayLabel(atDay)}</span>
          {atSpent === null ? (
            <>
              <span className="nv-chart__tip-k">Prévu</span>
              <b className="nv-chart__tip-n">{format(perDay.realistic)}</b>
              <span className="nv-chart__tip-ft">{`de ${format(perDay.low)} à ${format(perDay.high)} selon les semaines`}</span>
            </>
          ) : (
            <>
              <span className="nv-chart__tip-k">Dépensé</span>
              <b className="nv-chart__tip-n">{format(atSpent)}</b>
              <span className="nv-chart__tip-ft">
                {atSpent > capEur
                  ? 'au-dessus du plafond du jour'
                  : `${format(Math.max(0, capEur - atSpent))} sous le plafond`}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
