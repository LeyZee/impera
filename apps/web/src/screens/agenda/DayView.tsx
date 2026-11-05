import type { CreatorAccountShift, CreatorAgenda, CreatorSuggestion, CreatorTask } from '@impera/contracts';
import { CREATOR_TASK_CATEGORY_LABELS } from '@impera/contracts';
import {
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import type { AddPreset } from './AddDialog';
import { DayReplies } from './ReplyLines';
import { SuggestionCard } from './SuggestionCard';
import { CATEGORY_EMOJI, CategoryMark } from './category';
import { timedSuggestionsOf } from './grid';
import {
  firstOf,
  momentOf,
  ownTimed,
  planOf,
  programOf,
  progressOf,
  type DayPlan,
  type DayTask,
  type ProposedAt,
} from './model';
import { repliesOn } from './replies';

import { addDays, clockOf, dayNumber, lengthOf, minuteOf, weekOf } from '@/scheduling/time';
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
  wide,
  shifts,
  onDay,
  onSuggestion,
  ...actions
}: {
  agenda: CreatorAgenda;
  day: string;
  monday: string;
  /** A computer: the proportional bar of her day under the glance. */
  wide: boolean;
  /** Her accounts' shifts: a line under the Programme, never on the frieze. */
  shifts: readonly CreatorAccountShift[];
  onDay: (day: string | null) => void;
  /** A suggestion at an hour, touched in the Programme: opened to decide. */
  onSuggestion: (suggestion: CreatorSuggestion) => void;
} & DayActions): JSX.Element {
  const now = useNow();
  const plan = planOf(agenda, day);
  const isToday = day === agenda.today;
  const nowMinute = isToday ? minuteOf(now, agenda.timeZone) : null;
  // Suggestions at an hour sit in the Programme (CREA-22); the others, without an hour, stay as cards on top.
  const proposed = timedSuggestionsOf(plan, agenda.timeZone);
  const cards = plan.suggestions.filter((suggestion) => suggestion.when?.kind !== 'timed');
  const swipe = useSwipe((step) => {
    onDay(addDays(day, step));
  });
  return (
    <div className="ag-day" data-slide={swipe.slide} {...swipe.handlers}>
      <DayStrip agenda={agenda} monday={monday} day={day} onDay={onDay} />
      <Glance plan={plan} agenda={agenda} now={now} nowMinute={nowMinute} />
      {wide ? <Frieze plan={plan} nowMinute={nowMinute} onTask={actions.onTask} /> : null}
      {cards.length === 0 ? null : (
        <section className="ag-sec" aria-label="Propositions de l’agence">
          {cards.map((suggestion) => (
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
          {proposed.length === 0 ? null : (
            <p className="ag-proposed-note">
              {proposed.length > 1
                ? `${String(proposed.length)} propositions de l’agence à décider, en pointillés.`
                : 'Une proposition de l’agence à décider, en pointillés.'}
            </p>
          )}
          <Program
            plan={plan}
            now={now}
            nowMinute={nowMinute}
            proposed={proposed}
            onSuggestion={onSuggestion}
            {...actions}
          />
          <DayReplies lines={repliesOn(shifts, day, agenda.timeZone)} />
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
        const dots = [...ownTimed(plan), ...plan.todo].slice(0, 3);
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
  now,
  nowMinute,
}: {
  plan: DayPlan;
  agenda: CreatorAgenda;
  now: Date;
  nowMinute: number | null;
}): JSX.Element {
  const { done, total } = progressOf(plan);
  const left = total - done;
  const first = firstOf(plan, nowMinute);
  const title =
    total === 0
      ? 'Rien à faire'
      : left === 0
        ? 'Tout est fait'
        : `${String(left)} ${left > 1 ? 'choses' : 'chose'} à faire`;
  const proposed = plan.suggestions.length;
  // « Plus rien à heure » only when there was something at an hour: an empty day says it once, in the title.
  const moment = nowMinute === null || plan.timed.length === 0 ? null : momentOf(plan, nowMinute);
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
            ) : left === 0 ? (
              `${String(done)} sur ${String(total)}, bravo.`
            ) : first === null ? (
              `${String(done)} sur ${String(total)} fait.`
            ) : (
              <>
                Commence par : <Emoji category={first.task.category} />
                <b>{first.task.title}</b>
                {first.late ? <span className="ag-late"> · en retard</span> : null}
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
              <span>
                En cours : <Emoji category={moment.task.category} />
                <b>{moment.task.title}</b> · reste{' '}
                <span className="nv-num">
                  {lengthOf(leftOf(moment.task, now) ?? moment.left * MINUTE_MS)}
                </span>
              </span>
            </>
          ) : moment.kind === 'next' ? (
            <span>
              Ensuite : <Emoji category={moment.task.category} />
              <b>{moment.task.title}</b> à <span className="nv-num">{clockOf(moment.at)}</span> ·{' '}
              <span className="nv-num">dans {lengthOf(moment.in * MINUTE_MS)}</span>
            </span>
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

/** A category's emoji inside a sentence, decoration only. */
function Emoji({ category }: { category: CreatorTask['category'] }): JSX.Element {
  return (
    <span className="ag-emoji" aria-hidden="true">
      {CATEGORY_EMOJI[category]}
    </span>
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
      <CategoryMark category={task.category} />
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
      <Check item={item} day={day} onTick={onTick} />
    </li>
  );
}

/** Her timed tasks and the free times between them, in order; a free time is a button to add a task there. */
function Program({
  plan,
  now,
  nowMinute,
  proposed,
  onSuggestion,
  ...actions
}: {
  plan: DayPlan;
  now: Date;
  nowMinute: number | null;
  proposed: readonly ProposedAt[];
  onSuggestion: (suggestion: CreatorSuggestion) => void;
} & DayActions): JSX.Element {
  const rows = programOf(plan, nowMinute, proposed);
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
        if (row.kind === 'proposed')
          return <ProposedRow key={row.at.suggestion.id} at={row.at} onOpen={onSuggestion} />;
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
            <div
              className="ag-slot"
              data-cat={item.task.category}
              data-done={item.done ? 'true' : undefined}
              data-carried={item.carried ? 'true' : undefined}
            >
              <CategoryMark category={item.task.category} />
              <button
                type="button"
                className="ag-task__body"
                onClick={() => {
                  actions.onTask(item.task, item.day);
                }}
              >
                <b>{item.task.title}</b>
                <span className="ag-meta">
                  <span>{CREATOR_TASK_CATEGORY_LABELS[item.task.category]}</span>
                  {item.carried ? (
                    <span>depuis hier</span>
                  ) : (
                    <span className="nv-num">{lengthOf(item.length)}</span>
                  )}
                  {liveAt === null ? null : (
                    <span className="ag-live nv-num">
                      en cours · reste {lengthOf(leftOf(item.task, now) ?? (item.end - liveAt) * MINUTE_MS)}
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
              <Check item={item} day={item.day} onTick={actions.onTick} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** What is left of a timed task from now, by its instants: a day of clock change keeps its true length (CREA-05). */
function leftOf(task: CreatorTask, now: Date): number | null {
  return task.when.kind === 'timed' ? Math.max(0, Date.parse(task.when.endsAt) - now.getTime()) : null;
}

/** An agency's suggestion at its hour in her Programme, dashed: touched, it opens to accept it or say « Non merci ». */
function ProposedRow({
  at,
  onOpen,
}: {
  at: ProposedAt;
  onOpen: (suggestion: CreatorSuggestion) => void;
}): JSX.Element {
  const { suggestion } = at;
  return (
    <li className="ag-row">
      <span className="ag-time nv-num">
        <b>{clockOf(at.start)}</b>
        <span>{clockOf(at.end)}</span>
      </span>
      <div className="ag-slot" data-cat={suggestion.category} data-proposed="true">
        <CategoryMark category={suggestion.category} />
        <button
          type="button"
          className="ag-task__body"
          onClick={() => {
            onOpen(suggestion);
          }}
        >
          <b>{suggestion.title}</b>
          <span className="ag-meta">
            <span>Proposé par l’agence</span>
            <span>{CREATOR_TASK_CATEGORY_LABELS[suggestion.category]}</span>
          </span>
        </button>
      </div>
    </li>
  );
}

/** A horizontal swipe this long, and this much wider than tall, changes the day; anything else is a scroll. */
const SWIPE_PX = 56;
const SWIPE_RATIO = 1.4;

/**
 * Her finger slid sideways on her day: the next or the previous day (CR-05 b2). Only a touch, only once it is clearly
 * sideways, so that the page still scrolls; the arrows and the strip do the same with a click or the keyboard.
 */
function useSwipe(onStep: (step: 1 | -1) => void): {
  readonly slide: 'next' | 'previous' | undefined;
  readonly handlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerCancel: () => void;
    onClickCapture: (event: { preventDefault: () => void; stopPropagation: () => void }) => void;
  };
} {
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(0);
  const [slide, setSlide] = useState<'next' | 'previous' | undefined>(undefined);
  return {
    slide,
    handlers: {
      onPointerDown: (event) => {
        start.current = event.pointerType === 'mouse' ? null : { x: event.clientX, y: event.clientY };
      },
      onPointerUp: (event) => {
        const from = start.current;
        start.current = null;
        if (from === null) return;
        const dx = event.clientX - from.x;
        const dy = event.clientY - from.y;
        if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return;
        swiped.current = Date.now();
        const step = dx < 0 ? 1 : -1;
        setSlide(step === 1 ? 'next' : 'previous');
        onStep(step);
      },
      onPointerCancel: () => {
        start.current = null;
      },
      // The tap at the end of a swipe is the swipe's: no task opens under the finger.
      onClickCapture: (event) => {
        if (Date.now() - swiped.current < 350) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
    },
  };
}

/**
 * Her day at a glance on a computer (CR-05: « une barre proportionnelle seulement sur ordinateur »): her timed tasks
 * laid on the hours of her day, now marked. A task opens on a click. Hidden from a screen reader: the Programme says
 * the same in order.
 */
function Frieze({
  plan,
  nowMinute,
  onTask,
}: {
  plan: DayPlan;
  nowMinute: number | null;
  onTask: DayActions['onTask'];
}): JSX.Element | null {
  if (plan.timed.length === 0) return null;
  const marks = [
    ...plan.timed.flatMap((item) => [item.start, item.end]),
    ...(nowMinute === null ? [] : [nowMinute]),
  ];
  let from = Math.max(0, Math.floor(Math.min(...marks) / 60) * 60 - 60);
  let to = Math.min(24 * 60, Math.ceil(Math.max(...marks) / 60) * 60 + 60);
  if (to - from < 6 * 60) to = Math.min(24 * 60, from + 6 * 60);
  if (to - from < 6 * 60) from = Math.max(0, to - 6 * 60);
  const at = (minute: number): number => ((Math.max(from, Math.min(to, minute)) - from) / (to - from)) * 100;
  return (
    <section className="ag-frieze nv-plate" aria-hidden="true">
      <div className="ag-frieze__track">
        {plan.timed.map((item, index) => {
          const live = nowMinute !== null && item.start <= nowMinute && nowMinute < item.end;
          const past = nowMinute !== null && item.end <= nowMinute;
          return (
            <button
              key={item.task.id}
              type="button"
              tabIndex={-1}
              className="ag-frieze__task"
              data-cat={item.task.category}
              data-live={live ? 'true' : undefined}
              data-past={past ? 'true' : undefined}
              data-done={item.done ? 'true' : undefined}
              style={{
                left: `${at(item.start).toFixed(2)}%`,
                width: `calc(${(at(item.end) - at(item.start)).toFixed(2)}% - 3px)`,
                animationDelay: `${String(index * 70)}ms`,
              }}
              title={`${item.task.title} · ${clockOf(item.start)} – ${clockOf(item.end % 1440)}`}
              onClick={() => {
                onTask(item.task, plan.day);
              }}
            >
              <span className="ag-frieze__emoji">{CATEGORY_EMOJI[item.task.category]}</span>
              <span className="ag-frieze__title">{item.task.title}</span>
            </button>
          );
        })}
        {nowMinute !== null && nowMinute > from && nowMinute < to ? (
          <span className="ag-frieze__now" style={{ left: `${at(nowMinute).toFixed(2)}%` }}>
            <em className="nv-num">{clockOf(nowMinute)}</em>
          </span>
        ) : null}
      </div>
      <div className="ag-frieze__hours">
        {Array.from({ length: Math.floor((to - from) / 60) + 1 }, (_, index) => from + index * 60).map(
          (minute) => (
            <span key={minute} className="nv-num" style={{ left: `${at(minute).toFixed(2)}%` }}>
              {clockOf(minute % 1440)}
            </span>
          ),
        )}
      </div>
    </section>
  );
}
