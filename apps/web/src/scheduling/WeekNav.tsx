import type { JSX } from 'react';

import { addDays, weekLabel } from './time';

/** ‹ 26 oct. – 1 nov. › and « Cette semaine » when another week is shown: the week of a planning. */
export function WeekNav({
  monday,
  thisMonday,
  onMonday,
}: {
  monday: string;
  /** The Monday of today, to come back to it in one gesture. */
  thisMonday: string;
  onMonday: (monday: string) => void;
}): JSX.Element {
  const elsewhere = monday !== thisMonday;
  return (
    <div className="sc-week" role="group" aria-label="Semaine">
      <button
        type="button"
        className="sc-arrow"
        aria-label="Semaine précédente"
        onClick={() => {
          onMonday(addDays(monday, -7));
        }}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m10 3.5-4.5 4.5 4.5 4.5" />
        </svg>
      </button>
      <p className="sc-week__label nv-swap" key={monday} aria-live="polite">
        {weekLabel(monday)}
      </p>
      <button
        type="button"
        className="sc-arrow"
        aria-label="Semaine suivante"
        onClick={() => {
          onMonday(addDays(monday, 7));
        }}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m6 3.5 4.5 4.5-4.5 4.5" />
        </svg>
      </button>
      {elsewhere ? (
        <button
          type="button"
          className="nv-btn nv-btn--plain nv-btn--sm sc-week__back nv-swap"
          onClick={() => {
            onMonday(thisMonday);
          }}
        >
          Cette semaine
        </button>
      ) : null}
    </div>
  );
}
