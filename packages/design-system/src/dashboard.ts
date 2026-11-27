/**
 * Geometry for the dashboard pieces (docs/design/README.md, « Dashboard »): the share ring, the funnel and the
 * floating tip. Pure functions: the screen writes what they return into the SVG or the CSS variables, the
 * classes animate it. They know nothing about sales or fans, only numbers.
 */

/** `stroke-dasharray` of `.nv-ring__value` for a share between 0 and 1 of a circle of `radius`. */
export function ringDash(share: number, radius: number): string {
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(1, Math.max(0, Number.isFinite(share) ? share : 0));
  return `${String(round(clamped * circumference))} ${String(round(circumference))}`;
}

export interface DonutArc {
  /** `--_dash` of a `.nv-donut__arc` on a circle of the radius given. */
  readonly dash: string;
  /** Its `stroke-dashoffset`: where it starts, clockwise from the top once the ring is turned by −90°. */
  readonly offset: number;
}

/**
 * One arc of a `.nv-donut` per value, in order, a small gap between two arcs; a value alone takes the whole ring.
 * The values are amounts or shares, whatever adds up to the whole; a negative one counts for nothing.
 */
export function donutArcs(values: readonly number[], radius: number, gap = 2): DonutArc[] {
  const circumference = 2 * Math.PI * radius;
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  const shown = values.filter((value) => value > 0).length;
  let start = 0;
  return values.map((value) => {
    const length = total > 0 ? (Math.max(0, value) / total) * circumference : 0;
    const visible = shown > 1 ? Math.max(0, length - gap) : length;
    const arc = {
      dash: `${String(round(visible))} ${String(round(circumference))}`,
      offset: start === 0 ? 0 : round(-start),
    };
    start += length;
    return arc;
  });
}

export interface FunnelStep {
  readonly count: number;
  /** Bar width in % of the first step (`--nv-w` of `.nv-funnel__track`). */
  readonly width: number;
  /**
   * % of the step before that made it here, rounded; `null` for the first step, and for a step that holds more
   * than the one before: the two counts are then not the same fans, so no rate is said (never « 1 500 % »).
   */
  readonly rate: number | null;
  /** Change of `rate` against the previous period, in points; `null` when there is nothing to compare. */
  readonly delta: number | null;
}

export interface Funnel {
  readonly steps: readonly FunnelStep[];
  /** The step whose rate dropped the most (`.nv-funnel__step--break`), `null` when none dropped. */
  readonly breakIndex: number | null;
}

/**
 * Turns the head counts of each step into widths, pass rates and their change. `previous` holds the counts of
 * the period before, same steps, same order; without it no delta and no break.
 */
export function funnelSteps(counts: readonly number[], previous?: readonly number[]): Funnel {
  const first = counts[0] ?? 0;
  const steps = counts.map((count, i): FunnelStep => {
    const rate = i === 0 ? null : passRate(counts, i);
    const before = previous === undefined || i === 0 ? null : passRate(previous, i);
    return {
      count,
      width: first > 0 ? Math.min(100, round((count / first) * 100)) : 0,
      rate,
      delta: rate === null || before === null ? null : rate - before,
    };
  });
  let breakIndex: number | null = null;
  let worst = 0;
  steps.forEach((step, i) => {
    if (step.delta !== null && step.delta < worst) {
      worst = step.delta;
      breakIndex = i;
    }
  });
  return { steps, breakIndex };
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * Where a floating `.nv-tip` goes for a pointer at (`x`, `y`): below right of it, flipped to the other side
 * when it would leave the viewport, never closer than `pad` to an edge.
 */
export function tipPlacement(
  pointer: { readonly x: number; readonly y: number },
  tip: Size,
  viewport: Size,
  { offset = 14, pad = 12 }: { offset?: number; pad?: number } = {},
): { left: number; top: number } {
  let left = pointer.x + offset;
  let top = pointer.y + offset;
  if (left + tip.width > viewport.width - pad) left = pointer.x - tip.width - offset;
  if (top + tip.height > viewport.height - pad) top = pointer.y - tip.height - offset;
  return { left: Math.max(pad, left), top: Math.max(pad, top) };
}

function passRate(counts: readonly number[], i: number): number | null {
  const before = counts[i - 1];
  const here = counts[i];
  if (before === undefined || here === undefined) return null;
  if (here > before) return null;
  return before > 0 ? Math.round((here / before) * 100) : 0;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
