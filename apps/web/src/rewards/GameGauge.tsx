import { useEffect, useState, type JSX } from 'react';

import './rewards.css';

/*
 * A gauge of the chatter's game (« Mon rang », « Défi du shift », the tier ahead): on arrival it goes once from
 * the value this browser last showed to today's, then stays. A first visit, a lower value, another target (`scope`:
 * the next rank, the shift, the tier) or « réduire les animations » put it at today's value with no movement. The
 * figure beside it never counts up with it. What was last shown is a comfort of this device, kept per account;
 * a browser that refuses its storage shows the value at once.
 */

const KEY = 'impera.game-gauge';

interface Shown {
  readonly scope: string;
  readonly percent: number;
}

const isShown = (value: unknown): value is Shown =>
  typeof value === 'object' &&
  value !== null &&
  'scope' in value &&
  typeof value.scope === 'string' &&
  'percent' in value &&
  typeof value.percent === 'number' &&
  Number.isFinite(value.percent);

/** What this browser last showed for the gauge `name` of the account `userId`, or `null`. */
export function lastShown(userId: string, name: string): Shown | null {
  try {
    const raw = localStorage.getItem(`${KEY}.${userId}.${name}`);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    return isShown(value) ? value : null;
  } catch {
    return null;
  }
}

function keepShown(userId: string, name: string, shown: Shown): void {
  try {
    localStorage.setItem(`${KEY}.${userId}.${name}`, JSON.stringify(shown));
  } catch {
    // Refused: the next visit shows the value at once.
  }
}

/** « Réduire les animations »: the gauge is put at today's value from the first picture, never a frame late. */
const still = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Where the gauge starts: the last value shown when it was lower and for the same target, else `null`. */
export function gaugeStart(last: Shown | null, scope: string, percent: number): number | null {
  if (last?.scope !== scope) return null;
  const from = Math.min(100, Math.max(0, last.percent));
  return from < percent ? from : null;
}

export function GameGauge({
  userId,
  name,
  scope,
  percent,
  label,
  className,
}: {
  userId: string;
  /** Which gauge of the game this is: `rank`, `challenge`, `tier`. */
  name: string;
  /** What it is on the way to: another target starts with no movement. */
  scope: string;
  percent: number;
  /** What a screen reader calls it; without one the gauge is decoration beside words that say the same. */
  label?: string;
  className?: string;
}): JSX.Element {
  // Read once, on arrival: the movement plays once a visit.
  const [from] = useState(() => (still() ? null : gaugeStart(lastShown(userId, name), scope, percent)));
  const [state, setState] = useState<'before' | 'moving' | 'still'>(from === null ? 'still' : 'before');

  useEffect(() => {
    keepShown(userId, name, { scope, percent });
  }, [userId, name, scope, percent]);

  useEffect(() => {
    if (state !== 'before') return undefined;
    const frame = requestAnimationFrame(() => {
      setState('moving');
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [state]);

  const at = state === 'before' && from !== null ? from : percent;
  return (
    <div
      className={['nv-gauge', 'rw-gauge', className].filter(Boolean).join(' ')}
      data-moving={state === 'moving' ? 'true' : undefined}
      {...(label === undefined
        ? {}
        : {
            role: 'progressbar',
            'aria-label': label,
            'aria-valuemin': 0,
            'aria-valuemax': 100,
            'aria-valuenow': Math.round(percent),
          })}
      style={{ '--rw-gauge-at': `${String(at)}%` }}
      onTransitionEnd={(event) => {
        if (event.propertyName === 'transform') setState('still');
      }}
    >
      <span className="nv-gauge__fill" />
    </div>
  );
}
