import type { CreatorId } from '@impera/contracts';
import type { JSX } from 'react';

import { useCreatorProgress } from './api';
import { progressOf } from './model';
import './progress.css';

import { Donut, Meter } from '@/shell/figures/figures';

/** The colour of each row, the same as her own day's ring: her day, her shooting, her delivery. */
const ROW_COLOUR = { shoot: 'var(--nv-series-2)', delivery: 'var(--nv-series-3)' } as const;

/**
 * « Où elle en est » (Charles, 21/11, trous béants n° 11): under her week in her sheet, what she ticked of each day
 * (her essentials as a ring, her bonus beside it) and how far her validated week went. Read only: she ticks, the
 * agency looks. Quiet while nothing is read.
 */
export function ProgressBand({
  creatorId,
  week,
}: {
  creatorId: CreatorId;
  week: string;
}): JSX.Element | null {
  const progress = useCreatorProgress(creatorId, week).data;
  if (progress === undefined) return null;
  const view = progressOf(progress);
  return (
    <section className="nv-plate pg-band nv-enter" aria-labelledby="pg-band-title">
      <div className="pg-band__head">
        <h2 id="pg-band-title" className="nv-h2">
          {view.title}
        </h2>
        <p className="pg-band__line">{view.line}</p>
      </div>
      <ol className="pg-days" aria-label="Ses sept jours">
        {view.days.map((day) => (
          <li
            key={day.day}
            className="pg-day"
            data-today={day.today || undefined}
            data-ahead={day.ahead || undefined}
            data-held={day.held || undefined}
          >
            <span className="pg-day__name">{day.today ? 'Auj.' : day.weekday}</span>
            <Donut
              label={day.words}
              of={Math.max(day.asked, 1)}
              slices={day.ahead ? [] : [{ key: 'essentials', colour: 'var(--nv-series-1)', value: day.done }]}
            />
            <span className="pg-day__count nv-num" aria-hidden="true">
              {day.ahead ? '·' : `${String(day.done)}/${String(day.asked)}`}
            </span>
            {day.extra > 0 ? (
              <span className="pg-day__extra nv-num" aria-hidden="true">
                +{day.extra}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      <p className="pg-band__key">L’anneau : ses essentiels du jour. +N : ce qu’elle a fait en bonus.</p>
      {view.rows.length === 0 ? (
        <p className="pg-band__none">Pas de semaine de tournage validée pour ces jours.</p>
      ) : (
        <div className="pg-rows">
          {view.rows.map((row) => (
            <div key={row.key} className="pg-row">
              <div className="pg-row__top">
                <span className="pg-row__label">
                  <span className="nv-key" style={{ '--_c': ROW_COLOUR[row.key] }} aria-hidden="true" />
                  {row.label}
                </span>
                <span className="pg-row__words nv-num">{row.words}</span>
              </div>
              <Meter
                percent={row.percent}
                colour={ROW_COLOUR[row.key]}
                label={`${row.label} : ${row.words}`}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
