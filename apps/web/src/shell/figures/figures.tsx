import { chartPoints, donutArcs, linePath } from '@impera/design-system';
import { useId, useRef, useState, type JSX, type PointerEvent, type ReactNode } from 'react';

/*
 * The figures every screen draws the same way (Charles, 21/11): the donut, its legend's lighting, the meter and the
 * small curve. Their look and their motion are the design system's (`nv-donut`, `nv-breakdown`, `nv-meter`,
 * `nv-spark`); a screen gives numbers, colours and words, never a class of its own for the drawing.
 */

/** The donut's box: 132 units wide, a ring of radius 52 and 14 thick, as `nv-donut` draws it. */
const BOX = 132;
const RADIUS = 52;

export interface DonutSlice {
  readonly key: string;
  /** A CSS colour, a series token most often (`var(--nv-series-1)`). */
  readonly colour: string;
  /** An amount or a share: whatever adds up to the whole. */
  readonly value: number;
}

/**
 * A donut: one arc per slice, drawn in one after the other; the slice at `lit` comes out and the others step back.
 * The middle is the caller's (`nv-donut__value`, `nv-donut__sub`): the total at rest, the lit slice otherwise.
 * `onLit` makes the arcs answer the pointer; without it the ring is still. `of` is the whole when the slices do not
 * add up to it (one share alone against its track).
 */
export function Donut({
  label,
  slices,
  lit = null,
  onLit,
  of,
  children,
}: {
  /** What the ring says to a screen reader: its title and each share. */
  label: string;
  slices: readonly DonutSlice[];
  lit?: number | null;
  onLit?: (index: number | null) => void;
  of?: number;
  children?: ReactNode;
}): JSX.Element {
  const values = slices.map((slice) => slice.value);
  const sum = values.reduce((total, value) => total + Math.max(0, value), 0);
  const solo = of !== undefined;
  const geometry = solo
    ? donutArcs([...values, Math.max(0, of - sum)], RADIUS, 0)
    : donutArcs(values, RADIUS);
  return (
    <div
      className={`nv-donut${solo ? ' nv-donut--solo' : ''}${lit === null ? '' : ' is-lit'}`}
      role="img"
      aria-label={label}
    >
      <svg viewBox={`0 0 ${String(BOX)} ${String(BOX)}`} aria-hidden="true">
        <circle className="nv-donut__track" cx={BOX / 2} cy={BOX / 2} r={RADIUS} />
        {slices.map((slice, i) => {
          const arc = geometry[i];
          if (arc === undefined || slice.value <= 0) return null;
          return (
            <circle
              key={slice.key}
              className={lit === i ? 'nv-donut__arc is-on' : 'nv-donut__arc'}
              cx={BOX / 2}
              cy={BOX / 2}
              r={RADIUS}
              style={{ '--_c': slice.colour, '--_dash': arc.dash, '--_i': i }}
              strokeDashoffset={arc.offset}
              onPointerEnter={
                onLit === undefined
                  ? undefined
                  : () => {
                      onLit(i);
                    }
              }
              onPointerLeave={
                onLit === undefined
                  ? undefined
                  : (event) => {
                      if (event.pointerType === 'mouse') onLit(null);
                    }
              }
            />
          );
        })}
      </svg>
      {children === undefined ? null : (
        <span className="nv-donut__middle" aria-hidden="true">
          {children}
        </span>
      )}
    </div>
  );
}

export interface LitRow {
  readonly onPointerEnter: (event: PointerEvent) => void;
  readonly onPointerLeave: (event: PointerEvent) => void;
  readonly onPointerDown: (event: PointerEvent) => void;
  readonly onFocus: () => void;
  readonly onBlur: () => void;
  readonly onClick: () => void;
}

/**
 * Which slice of a donut is lit, and what a row of its legend (`nv-breakdown__row`, a button) does about it: a
 * mouse lights on entering and puts out on leaving; a finger's tap lights or puts out; the keyboard lights on focus.
 * A tap's own entering and focus would light before its click undoes it, so the pointer that pressed is remembered.
 */
export function useLit(): {
  readonly lit: number | null;
  readonly setLit: (index: number | null) => void;
  readonly row: (index: number) => LitRow;
} {
  const [lit, setLit] = useState<number | null>(null);
  const pressedBy = useRef<string | null>(null);
  return {
    lit,
    setLit,
    row: (index) => ({
      onPointerEnter: (event) => {
        if (event.pointerType === 'mouse') setLit(index);
      },
      onPointerLeave: (event) => {
        if (event.pointerType === 'mouse') setLit(null);
      },
      onPointerDown: (event) => {
        pressedBy.current = event.pointerType;
      },
      onFocus: () => {
        if (pressedBy.current === null) setLit(index);
      },
      onBlur: () => {
        pressedBy.current = null;
        setLit(null);
      },
      onClick: () => {
        const by = pressedBy.current;
        pressedBy.current = null;
        if (by === 'mouse') setLit(index);
        else setLit(lit === index ? null : index);
      },
    }),
  };
}

/**
 * A meter: how far along, from 0 to 100 %, on its track. `label` says it to a screen reader; without it the meter
 * is decoration beside a figure that already says the same. `colour` is a CSS colour, the data's ink by default.
 */
export function Meter({
  percent,
  label,
  colour,
}: {
  percent: number;
  label?: string;
  colour?: string;
}): JSX.Element {
  const width = `${String(Math.min(100, Math.max(0, percent)))}%`;
  return (
    <span
      className="nv-meter"
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
    >
      <span style={colour === undefined ? { '--_w': width } : { '--_w': width, '--_c': colour }} />
    </span>
  );
}

/**
 * The small curve at a tile's foot: 1.5px, no axis, no point, a fill of 12 % at most, in the trend's colour.
 * Decorative: the tile's figure and its change say it, so it is hidden from assistive technologies.
 */
export function Spark({ values, tone }: { values: readonly number[]; tone: 'up' | 'down' }): JSX.Element {
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
      className={`nv-spark nv-spark--${tone}`}
      viewBox={`0 0 ${String(frame.width)} ${String(frame.height)}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={fill} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" className="nv-spark__fill-top" />
          <stop offset="1" className="nv-spark__fill-bottom" />
        </linearGradient>
      </defs>
      <path className="nv-spark__area" d={area} fill={`url(#${fill})`} />
      <path className="nv-spark__line" d={linePath(line)} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
