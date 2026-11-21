import { chartPoints, donutArcs, linePath } from '@impera/design-system';
import {
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type JSX,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

/*
 * The figures every screen draws the same way (Charles, 21/11): the donut, its legend's lighting, the meter, the
 * small curve and the columns. Their look and their motion are the design system's (`nv-donut`, `nv-breakdown`,
 * `nv-meter`, `nv-spark`, `nv-cols`); a screen gives numbers, colours and words, never a class of its own for the
 * drawing.
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

export interface ColumnPart {
  readonly key: string;
  /** A CSS colour, a series token most often; the data's ink without one. */
  readonly colour?: string;
  readonly value: number;
  /** Of another nature than the plain part: forecast, covered, still under way. */
  readonly hatched?: boolean;
}

export interface Column {
  readonly key: string;
  /** Under the column; empty when this column carries no label. */
  readonly label: string;
  /** What the column says to a screen reader: its step and its figure. */
  readonly says: string;
  /** Bottom to top, in the legend's order. */
  readonly parts: readonly ColumnPart[];
  /** What the column does under the pointer: a tip's handlers most often. */
  readonly handlers?: Pick<
    ButtonHTMLAttributes<HTMLButtonElement>,
    'onPointerMove' | 'onPointerDown' | 'onPointerLeave' | 'onFocus' | 'onBlur'
  >;
}

const COLUMN_STEPS: Readonly<Record<string, 1 | -1>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/**
 * Columns: a series in time, one stacked column per step over a grid of ticks. The column under the pointer, the
 * finger or the keyboard swells and the others step back; one column is in the tab order, the arrows, Home and End
 * move between them. `top` is the plot's top (the last tick most often); `mark` draws a reference line (an
 * objective, an average) at its value.
 */
export function Columns({
  label,
  columns,
  top,
  ticks,
  mark,
}: {
  /** What the plot says to a screen reader: what it counts, over what, and how to move in it. */
  label: string;
  columns: readonly Column[];
  top: number;
  ticks: readonly { readonly value: number; readonly text: string }[];
  mark?: number;
}): JSX.Element {
  const [focus, setFocus] = useState(columns.length - 1);
  const current = Math.min(Math.max(0, focus), columns.length - 1);
  const bars = useRef<HTMLDivElement>(null);
  const scale = top > 0 ? top : 1;
  const share = (value: number): string => `${String((value / scale) * 100)}%`;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step =
      event.key === 'Home' ? -columns.length : event.key === 'End' ? columns.length : COLUMN_STEPS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = Math.min(Math.max(0, current + step), columns.length - 1);
    setFocus(next);
    bars.current?.querySelectorAll<HTMLButtonElement>('.nv-col')[next]?.focus();
  };
  return (
    <div className="nv-cols">
      <div className="nv-cols__grid" aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick.value} style={{ '--_y': share(tick.value) }}>
            <i>{tick.text}</i>
          </span>
        ))}
        {mark === undefined ? null : <span className="nv-cols__mark" style={{ '--_y': share(mark) }} />}
      </div>
      <div
        className="nv-cols__bars"
        style={{ '--_n': columns.length }}
        role="group"
        aria-label={label}
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
            className="nv-col"
            style={{ '--_i': i }}
            tabIndex={i === current ? 0 : -1}
            aria-label={column.says}
            data-i={i}
            {...column.handlers}
          >
            <span className="nv-col__stack">
              {column.parts.map((part) =>
                part.value <= 0 ? null : (
                  <span
                    key={part.key}
                    className={part.hatched === true ? 'nv-col__part nv-col__part--hatched' : 'nv-col__part'}
                    style={
                      part.colour === undefined
                        ? { '--_h': share(part.value) }
                        : { '--_c': part.colour, '--_h': share(part.value) }
                    }
                  />
                ),
              )}
            </span>
            <span className="nv-col__label" aria-hidden="true">
              {column.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
