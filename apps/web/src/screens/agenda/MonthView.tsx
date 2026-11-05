import type { CreatorAccountShift, CreatorAgenda } from '@impera/contracts';
import type { JSX, KeyboardEvent } from 'react';

import { CATEGORY_EMOJI } from './category';
import { monthDays, monthLinesOf, monthOf } from './grid';
import { repliesOn } from './replies';

import { addDays, clockOf, dayNumber, longDay } from '@/scheduling/time';

const WEEKDAY_SHORT = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'] as const;
/** What a cell shows before « +2 »: the day opens in Jour for the rest. */
const LINES_SHOWN = 3;

/**
 * Mois on a computer (CR-05 b2): her weeks of the month, what is planned each day (hours first, then the tasks of
 * the day, the agency's suggestions dashed). Her routine stays in Jour, where it is ticked. A day opens in Jour; the
 * arrows of the keyboard move from day to day, Entrée opens it.
 */
export function MonthView({
  agenda,
  day,
  shifts,
  onOpenDay,
}: {
  agenda: CreatorAgenda;
  day: string;
  /** Her accounts' shifts: the names of who answers her fans, at the foot of each day. */
  shifts: readonly CreatorAccountShift[];
  onOpenDay: (day: string) => void;
}): JSX.Element {
  const days = monthDays(day);
  const month = monthOf(day).slice(0, 7);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step =
      event.key === 'ArrowLeft'
        ? -1
        : event.key === 'ArrowRight'
          ? 1
          : event.key === 'ArrowUp'
            ? -7
            : event.key === 'ArrowDown'
              ? 7
              : 0;
    if (step === 0) return;
    const from = event.target instanceof HTMLElement ? event.target.dataset['day'] : undefined;
    if (from === undefined) return;
    const to = addDays(from, step);
    const cell = event.currentTarget.querySelector<HTMLButtonElement>(`[data-day="${to}"]`);
    if (cell === null) return;
    event.preventDefault();
    cell.focus();
  };
  return (
    <div className="ag-month nv-plate" role="grid" aria-label="Ton mois" onKeyDown={onKeyDown}>
      <div className="ag-month__names" role="row">
        {WEEKDAY_SHORT.map((name) => (
          <span key={name} role="columnheader">
            {name}
          </span>
        ))}
      </div>
      <div className="ag-month__days">
        {days.map((one) => {
          const lines = monthLinesOf(agenda, one);
          const rest = lines.length - LINES_SHOWN;
          // Names only, in the same order every day, so that the month reads at a glance.
          const names = [
            ...new Set(
              repliesOn(shifts, one, agenda.timeZone).flatMap((line) =>
                line.replies.map((reply) => reply.name),
              ),
            ),
          ].sort((a, b) => a.localeCompare(b, 'fr'));
          return (
            <button
              key={one}
              type="button"
              role="gridcell"
              className="ag-month__cell"
              data-day={one}
              data-out={one.slice(0, 7) === month ? undefined : 'true'}
              data-today={one === agenda.today ? 'true' : undefined}
              tabIndex={one === day || (day.slice(0, 7) !== one.slice(0, 7) && one === days[0]) ? 0 : -1}
              aria-label={`${longDay(one)} : ${lines.length === 0 ? 'rien de prévu' : lines.map((line) => line.title).join(', ')}${names.length === 0 ? '' : `. Qui répond à tes fans : ${names.join(', ')}`}`}
              onClick={() => {
                onOpenDay(one);
              }}
            >
              <span className="ag-month__num nv-num" aria-hidden="true">
                {dayNumber(one)}
              </span>
              {lines.slice(0, LINES_SHOWN).map((line) => (
                <span
                  key={line.key}
                  className="ag-mini"
                  data-cat={line.category}
                  data-done={line.done ? 'true' : undefined}
                  data-proposed={line.proposed ? 'true' : undefined}
                  aria-hidden="true"
                >
                  <span>{CATEGORY_EMOJI[line.category]}</span>
                  {line.start === null ? null : <span className="nv-num">{clockOf(line.start)}</span>}
                  <span className="ag-mini__title">{line.title}</span>
                </span>
              ))}
              {rest > 0 ? (
                <span className="ag-month__more nv-num" aria-hidden="true">
                  +{rest}
                </span>
              ) : null}
              {names.length === 0 ? null : (
                <span className="ag-month__fans" aria-hidden="true">
                  💬 {names.join(', ')}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
