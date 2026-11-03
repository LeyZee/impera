import type { CreatorAgenda, CreatorSuggestion, CreatorTask } from '@impera/contracts';
import { CREATOR_TASK_CATEGORY_LABELS } from '@impera/contracts';
import type { JSX, KeyboardEvent } from 'react';

import type { AddPreset } from './AddDialog';
import { SuggestionCard } from './SuggestionCard';
import { firstOf, momentOf, planOf, programOf, progressOf, type DayPlan, type DayTask } from './model';

import { clockOf, dayNumber, lengthOf, minuteOf, weekOf } from '@/scheduling/time';
import { useNow } from '@/scheduling/useNow';

const WEEKDAY_SHORT = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'] as const;
const MINUTE_MS = 60_000;

export interface DayActions {
  readonly onTick: (task: CreatorTask, on: boolean, day: string) => void;
  readonly onTask: (task: CreatorTask, day: string) => void;
  readonly onAdd: (preset: AddPreset) => void;
  readonly onDecline: (suggestion: CreatorSuggestion) => void;
  readonly onPlace: (suggestion: CreatorSuggestion) => void;
}

/**
 * The Jour view (CR-05, Charles 02/11, 19 h 17 and 19 h 27): tasks first. At the top, where her day stands (done / to
 * do), the task to start with and the next moment; then « À faire » and « Programme », where a free time is touched
 * to create a task there. No hour grid scrolling inside the page on the phone.
 */
export function DayView({
  agenda,
  day,
  monday,
  onDay,
  ...actions
}: {
  agenda: CreatorAgenda;
  day: string;
  monday: string;
  onDay: (day: string | null) => void;
} & DayActions): JSX.Element {
  const now = useNow();
  const plan = planOf(agenda, day);
  const isToday = day === agenda.today;
  const nowMinute = isToday ? minuteOf(now, agenda.timeZone) : null;
  return (
    <div className="ag-day">
      <DayStrip agenda={agenda} monday={monday} day={day} onDay={onDay} />
      <Glance plan={plan} agenda={agenda} nowMinute={nowMinute} />
      {plan.suggestions.length === 0 ? null : (
        <section className="ag-sec" aria-label="Propositions de l’agence">
          {plan.suggestions.map((suggestion) => (
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
      <div className="ag-cols">
        {plan.todo.length === 0 ? null : (
          <section className="ag-sec">
            <div className="ag-sec__head">
              <h2>À faire</h2>
              <span className="ag-count nv-num">{plan.todo.filter((item) => !item.done).length || '✓'}</span>
            </div>
            <ul className="ag-list">
              {plan.todo.map((item) => (
                <TaskRow key={item.task.id} item={item} day={day} {...actions} />
              ))}
            </ul>
          </section>
        )}
        <section className="ag-sec">
          <div className="ag-sec__head">
            <h2>Programme</h2>
            <span className="ag-count">
              {plan.timed.length === 0
                ? 'libre'
                : `${String(plan.timed.length)} ${plan.timed.length > 1 ? 'tâches' : 'tâche'} à heure`}
            </span>
          </div>
          <Program plan={plan} nowMinute={nowMinute} {...actions} />
        </section>
      </div>
    </div>
  );
}

/** The seven days of her week, a dot per thing planned; ← and → move a day, Début and Fin to the ends. */
function DayStrip({
  agenda,
  monday,
  day,
  onDay,
}: {
  agenda: CreatorAgenda;
  monday: string;
  day: string;
  onDay: (day: string | null) => void;
}): JSX.Element {
  const days = weekOf(monday);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const at = days.indexOf(day);
    const to =
      event.key === 'ArrowLeft'
        ? at - 1
        : event.key === 'ArrowRight'
          ? at + 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? 6
              : null;
    if (to === null) return;
    event.preventDefault();
    const next = days[Math.max(0, Math.min(6, to))];
    if (next !== undefined) onDay(next);
  };
  return (
    <div className="ag-strip" role="group" aria-label="Jours de la semaine" onKeyDown={onKeyDown}>
      {days.map((one, index) => {
        const plan = planOf(agenda, one);
        const dots = [...plan.timed, ...plan.todo].slice(0, 3);
        return (
          <button
            key={one}
            type="button"
            className="ag-strip__day"
            data-today={one === agenda.today ? 'true' : undefined}
            aria-pressed={one === day}
            tabIndex={one === day ? 0 : -1}
            aria-label={`${WEEKDAY_SHORT[index] ?? ''} ${dayNumber(one)}`}
            onClick={() => {
              onDay(one);
            }}
          >
            <span className="ag-strip__name" aria-hidden="true">
              {WEEKDAY_SHORT[index]}
            </span>
            <span className="ag-strip__num nv-num" aria-hidden="true">
              {dayNumber(one)}
            </span>
            <span className="ag-strip__dots" aria-hidden="true">
              {dots.map((item) => (
                <i
                  key={item.task.id}
                  data-cat={item.task.category}
                  data-done={item.done ? 'true' : undefined}
                />
              ))}
              {plan.suggestions.length > 0 ? <i data-proposed="true" /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const RING_RADIUS = 27;
const ringDash = (share: number): string => {
  const length = 2 * Math.PI * RING_RADIUS;
  return `${(length * share).toFixed(1)} ${length.toFixed(1)}`;
};

/** Where her day stands: done out of all, where to start, and what is now or next. Her streak beside it. */
function Glance({
  plan,
  agenda,
  nowMinute,
}: {
  plan: DayPlan;
  agenda: CreatorAgenda;
  nowMinute: number | null;
}): JSX.Element {
  const { done, total } = progressOf(plan);
  const left = total - done;
  const first = firstOf(plan);
  const title =
    total === 0
      ? 'Rien à faire'
      : left === 0
        ? 'Tout est fait'
        : `${String(left)} ${left > 1 ? 'choses' : 'chose'} à faire`;
  const proposed = plan.suggestions.length;
  const moment = nowMinute === null ? null : momentOf(plan, nowMinute);
  const { streak } = agenda;
  return (
    <section className="nv-plate ag-glance nv-enter" aria-label="Ta journée">
      <div className="ag-glance__top">
        <div
          className="nv-ring ag-ring"
          data-full={total > 0 && left === 0 ? 'true' : undefined}
          role="img"
          aria-label={total === 0 ? 'Rien à faire' : `${String(done)} sur ${String(total)} fait`}
        >
          <svg viewBox="0 0 66 66" aria-hidden="true">
            <circle className="nv-ring__track" cx="33" cy="33" r={RING_RADIUS} />
            <circle
              className="nv-ring__value"
              cx="33"
              cy="33"
              r={RING_RADIUS}
              strokeDasharray={ringDash(total === 0 ? 0 : done / total)}
            />
          </svg>
          <span className="nv-ring__label nv-num" aria-hidden="true">
            {total === 0 ? '–' : `${String(done)}/${String(total)}`}
          </span>
        </div>
        <div className="ag-glance__text">
          <b>{title}</b>
          <span>
            {total === 0 ? (
              proposed > 0 ? (
                `${String(proposed)} ${proposed > 1 ? 'propositions' : 'proposition'} de l’agence à regarder.`
              ) : nowMinute === null ? (
                'Aucune tâche ce jour-là.'
              ) : (
                'Profite de ta journée.'
              )
            ) : first === null ? (
              `${String(done)} sur ${String(total)}, bravo.`
            ) : (
              <>
                Commence par : <b>{first.title}</b>
              </>
            )}
          </span>
          {streak.days === 0 ? null : (
            <span
              className="ag-streak"
              data-risk={streak.atRisk ? 'true' : undefined}
              title={streak.next === null ? undefined : `Prochain palier : ${String(streak.next)} jours`}
            >
              <b className="nv-num">{streak.days}</b> {streak.days > 1 ? 'jours' : 'jour'} de suite
            </span>
          )}
        </div>
      </div>
      {moment === null ? null : (
        <p className="ag-glance__next" data-live={moment.kind === 'live' ? 'true' : undefined}>
          {moment.kind === 'live' ? (
            <>
              <i className="ag-pulse" data-cat={moment.task.category} aria-hidden="true" />
              En cours : <b>{moment.task.title}</b> · reste{' '}
              <span className="nv-num">{lengthOf(moment.left * MINUTE_MS)}</span>
            </>
          ) : moment.kind === 'next' ? (
            <>
              Ensuite : <b>{moment.task.title}</b> à <span className="nv-num">{clockOf(moment.at)}</span> ·{' '}
              <span className="nv-num">dans {lengthOf(moment.in * MINUTE_MS)}</span>
            </>
          ) : (
            'Plus rien à heure aujourd’hui.'
          )}
        </p>
      )}
      {streak.atRisk ? (
        <p className="ag-glance__risk">Coche ta routine aujourd’hui pour garder ta série.</p>
      ) : null}
    </section>
  );
}

function Check({
  item,
  day,
  onTick,
}: {
  item: DayTask;
  day: string;
  onTick: DayActions['onTick'];
}): JSX.Element {
  return (
    <button
      type="button"
      className="ag-check"
      data-cat={item.task.category}
      aria-pressed={item.done}
      aria-label={item.done ? `Décocher ${item.task.title}` : `Cocher ${item.task.title}`}
      onClick={() => {
        onTick(item.task, !item.done, day);
      }}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="m3.5 8.5 3 3 6-7" />
      </svg>
    </button>
  );
}

function TaskRow({
  item,
  day,
  onTick,
  onTask,
}: {
  item: DayTask;
  day: string;
} & DayActions): JSX.Element {
  const { task } = item;
  return (
    <li className="ag-task" data-cat={task.category} data-done={item.done ? 'true' : undefined}>
      <Check item={item} day={day} onTick={onTick} />
      <button
        type="button"
        className="ag-task__body"
        onClick={() => {
          onTask(task, day);
        }}
      >
        <b>
          {task.title}
          {task.essential ? <span className="ag-ess">essentielle</span> : null}
        </b>
        <span>{task.purpose ?? CREATOR_TASK_CATEGORY_LABELS[task.category]}</span>
      </button>
      <span className="ag-tag">
        {task.when.kind === 'routine' ? 'Routine' : CREATOR_TASK_CATEGORY_LABELS[task.category]}
      </span>
    </li>
  );
}

/** Her timed tasks and the free times between them, in order; a free time is a button to add a task there. */
function Program({
  plan,
  nowMinute,
  ...actions
}: {
  plan: DayPlan;
  nowMinute: number | null;
} & DayActions): JSX.Element {
  const rows = programOf(plan, nowMinute);
  return (
    <ol className="ag-program">
      {rows.map((row) => {
        if (row.kind === 'now')
          return (
            <li key="now" className="ag-now" aria-label={`Maintenant, ${clockOf(row.at)}`}>
              <span className="ag-time nv-num">{clockOf(row.at)}</span>
              <i aria-hidden="true" />
            </li>
          );
        if (row.kind === 'free')
          return (
            <li key={`free-${String(row.start)}`} className="ag-row">
              <span className="ag-time nv-num">{clockOf(row.start)}</span>
              <button
                type="button"
                className="ag-free"
                data-open={row.open ? 'true' : undefined}
                aria-label={`Libre de ${clockOf(row.start)} à ${clockOf(row.end)} : ajouter une tâche`}
                onClick={() => {
                  actions.onAdd({
                    day: plan.day,
                    start: row.start,
                    end: Math.min(row.end, row.start + 60) % 1440,
                  });
                }}
              >
                <span>
                  <b>Libre</b>{' '}
                  <span className="nv-num">
                    {clockOf(row.start)} – {clockOf(row.end)}
                  </span>
                  {row.open ? <em>dispo pour l’agence</em> : null}
                </span>
                <svg viewBox="0 0 16 16" aria-hidden="true" className="ag-icon">
                  <path d="M8 3v10M3 8h10" />
                </svg>
              </button>
            </li>
          );
        const { item } = row;
        const liveAt =
          nowMinute !== null && item.start <= nowMinute && nowMinute < item.end ? nowMinute : null;
        const live = liveAt !== null;
        const past = nowMinute !== null && item.end <= nowMinute;
        return (
          <li
            key={item.task.id}
            className="ag-row"
            data-live={live ? 'true' : undefined}
            data-past={past ? 'true' : undefined}
          >
            <span className="ag-time nv-num">
              <b>{clockOf(item.start)}</b>
              <span>{clockOf(item.end)}</span>
            </span>
            <div className="ag-slot" data-cat={item.task.category} data-done={item.done ? 'true' : undefined}>
              <Check item={item} day={plan.day} onTick={actions.onTick} />
              <button
                type="button"
                className="ag-task__body"
                onClick={() => {
                  actions.onTask(item.task, plan.day);
                }}
              >
                <b>{item.task.title}</b>
                <span className="ag-meta">
                  <span>{CREATOR_TASK_CATEGORY_LABELS[item.task.category]}</span>
                  <span className="nv-num">{lengthOf((item.end - item.start) * MINUTE_MS)}</span>
                  {liveAt === null ? null : (
                    <span className="ag-live nv-num">
                      en cours · reste {lengthOf((item.end - liveAt) * MINUTE_MS)}
                    </span>
                  )}
                </span>
                {liveAt === null ? null : (
                  <span className="ag-progress" aria-hidden="true">
                    <i
                      style={{
                        width: `${(((liveAt - item.start) / (item.end - item.start)) * 100).toFixed(1)}%`,
                      }}
                    />
                  </span>
                )}
              </button>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
