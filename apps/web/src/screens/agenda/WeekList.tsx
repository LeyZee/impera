import {
  CREATOR_TASK_CATEGORY_LABELS,
  type CreatorAccountShift,
  type CreatorAgenda,
} from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import type { DayActions } from './DayView';
import { ShortReplies } from './ReplyLines';
import { SuggestionCard } from './SuggestionCard';
import { AGENDA_KEY, archiveAvailability } from './api';
import { CategoryMark } from './category';
import { planOf, undatedOf, type DayWindow } from './model';
import { repliesOn } from './replies';

import { clockOf, dayNumber, weekOf } from '@/scheduling/time';

const WEEKDAY_SHORT = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'] as const;

/**
 * « Ma semaine » (CR-05): her seven days as a list, what is planned on each, her dispos under it. The suggestions that
 * found no room come first, « Sans date »: she places them herself. A day's date opens it in Jour.
 */
export function WeekList({
  agenda,
  monday,
  shifts,
  onOpenDay,
  ...actions
}: {
  agenda: CreatorAgenda;
  monday: string;
  /** Her accounts' shifts, a discreet line under each day. */
  shifts: readonly CreatorAccountShift[];
  onOpenDay: (day: string) => void;
} & DayActions): JSX.Element {
  const undated = undatedOf(agenda);
  return (
    <div className="ag-week">
      {undated.length === 0 ? null : (
        <section className="ag-sec">
          <div className="ag-sec__head">
            <h2>Sans date</h2>
            <span className="ag-count nv-num">{undated.length}</span>
          </div>
          {undated.map((suggestion) => (
            <SuggestionCard
              key={suggestion.id}
              suggestion={suggestion}
              zone={agenda.timeZone}
              onDecline={actions.onDecline}
              onPlace={actions.onPlace}
            />
          ))}
        </section>
      )}
      <ol className="ag-weeklist">
        {weekOf(monday).map((day, index) => {
          const plan = planOf(agenda, day);
          const empty = plan.todo.length === 0 && plan.timed.length === 0 && plan.suggestions.length === 0;
          return (
            <li
              key={day}
              className="ag-wday"
              data-today={day === agenda.today ? 'true' : undefined}
              data-past={day < agenda.today ? 'true' : undefined}
            >
              <button
                type="button"
                className="ag-wday__date"
                aria-label={`Ouvrir ${WEEKDAY_SHORT[index] ?? ''} ${dayNumber(day)} en Jour`}
                onClick={() => {
                  onOpenDay(day);
                }}
              >
                <span aria-hidden="true">{WEEKDAY_SHORT[index]}</span>
                <b className="nv-num" aria-hidden="true">
                  {dayNumber(day)}
                </b>
              </button>
              <button
                type="button"
                className="ag-wday__add"
                aria-label={`Ajouter le ${WEEKDAY_SHORT[index] ?? ''} ${dayNumber(day)}`}
                onClick={() => {
                  actions.onAdd({ day });
                }}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true" className="ag-icon">
                  <path d="M8 3v10M3 8h10" />
                </svg>
              </button>
              <div className="ag-wday__items">
                {empty ? <p className="ag-empty">Rien de prévu</p> : null}
                {plan.timed.map((item) => (
                  <button
                    key={item.task.id}
                    type="button"
                    className="ag-witem"
                    data-cat={item.task.category}
                    data-done={item.done ? 'true' : undefined}
                    onClick={() => {
                      actions.onTask(item.task, day);
                    }}
                  >
                    <CategoryMark category={item.task.category} size="sm" />
                    <b>{item.task.title}</b>
                    <span className="nv-num">
                      {clockOf(item.start)} – {clockOf(item.end)}
                    </span>
                  </button>
                ))}
                {plan.todo.map((item) => (
                  <button
                    key={item.task.id}
                    type="button"
                    className="ag-witem"
                    data-cat={item.task.category}
                    data-done={item.done ? 'true' : undefined}
                    onClick={() => {
                      actions.onTask(item.task, day);
                    }}
                  >
                    <CategoryMark category={item.task.category} size="sm" />
                    <b>{item.task.title}</b>
                    <span>
                      {item.task.when.kind === 'routine'
                        ? 'Routine'
                        : CREATOR_TASK_CATEGORY_LABELS[item.task.category]}
                    </span>
                  </button>
                ))}
                {plan.suggestions.map((suggestion) => (
                  <SuggestionCard
                    key={suggestion.id}
                    suggestion={suggestion}
                    zone={agenda.timeZone}
                    onDecline={actions.onDecline}
                    onPlace={actions.onPlace}
                  />
                ))}
                {plan.windows.map((window) => (
                  <Dispo key={window.id} window={window} />
                ))}
                <ShortReplies lines={repliesOn(shifts, day, agenda.timeZone)} />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** « Dispo pour l'agence 14 h – 20 h », and how to take it back. A weekly dispo goes for every week. */
function Dispo({ window }: { window: DayWindow }): JSX.Element {
  const client = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <span className="ag-dispo">
      <i aria-hidden="true" />
      Dispo pour l’agence{' '}
      <span className="nv-num">
        {clockOf(window.start)} – {clockOf(window.end)}
      </span>
      {confirm ? (
        <>
          <button
            type="button"
            className="nv-btn nv-btn--destructive nv-btn--sm"
            disabled={busy}
            aria-busy={busy}
            onClick={() => {
              setBusy(true);
              void archiveAvailability(window.id).then(async () => {
                setBusy(false);
                setConfirm(false);
                await client.invalidateQueries({ queryKey: AGENDA_KEY });
              });
            }}
          >
            Retirer
          </button>
          <button
            type="button"
            className="nv-btn nv-btn--plain nv-btn--sm"
            disabled={busy}
            onClick={() => {
              setConfirm(false);
            }}
          >
            Garder
          </button>
        </>
      ) : (
        <button
          type="button"
          className="ag-dispo__remove"
          aria-label={`Retirer la dispo de ${clockOf(window.start)} à ${clockOf(window.end)}`}
          onClick={() => {
            setConfirm(true);
          }}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </button>
      )}
    </span>
  );
}
