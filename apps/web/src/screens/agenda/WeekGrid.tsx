import type {
  CreatorAccountShift,
  CreatorAgenda,
  CreatorSuggestion,
  CreatorTask,
  CreatorTaskWhen,
} from '@impera/contracts';
import { useEffect, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react';

import type { DayActions } from './DayView';
import { ShortReplies } from './Replies';
import { CATEGORY_EMOJI } from './category';
import {
  createdSpan,
  hoursOf,
  isOver,
  lanesOf,
  minuteAt,
  movedSpan,
  movedWhen,
  timedSuggestionsOf,
  type Span,
} from './grid';
import { planOf, type DayPlan, type TimedTask } from './model';
import { repliesOn } from './replies';

import { clockOf, dayNumber, minuteOf, weekOf } from '@/scheduling/time';
import { useNow } from '@/scheduling/useNow';

const WEEKDAY_SHORT = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'] as const;
/** A touch held this long on the grid lifts a task or starts a new one; moved before, it scrolls. */
const LONG_PRESS_MS = 380;
/** A mouse moved this far has started a drag; a touch moved this far before the long press is a scroll. */
const MOUSE_SLOP = 5;
const TOUCH_SLOP = 8;
/** The height of an hour in the grid (agenda.css `.ag-wk__grid`). */
const HOUR_PX = 52;

type Drag =
  | {
      readonly kind: 'create';
      readonly day: string;
      readonly from: number;
      readonly span: Span;
    }
  | {
      readonly kind: 'move';
      readonly task: CreatorTask;
      readonly day: string;
      readonly grab: number;
      readonly item: Span;
      readonly span: Span;
    };

interface Press {
  readonly x: number;
  readonly y: number;
  readonly touch: boolean;
  readonly pointer: number;
  readonly day: string;
  readonly item: TimedTask | null;
  timer: number | null;
  started: boolean;
}

/**
 * Semaine on a computer (CR-05 b2): her seven days side by side, hours down. Her tasks of the day on top, her timed
 * tasks in the grid, her dispos hatched under them, the agency's suggestions dashed. A drag on a free time creates a
 * task there (« Ajouter » opens with the hours); a drag on a task moves it to another hour or day, its length kept.
 * On a touch screen both wait for a long press, so that scrolling stays scrolling. Each gesture has its button: the
 * task opens with « Changer le moment », « Ajouter » creates.
 */
export function WeekGrid({
  agenda,
  monday,
  shifts,
  onOpenDay,
  onMove,
  onSuggestion,
  ...actions
}: {
  agenda: CreatorAgenda;
  monday: string;
  /** Her accounts' shifts: a row « fans » under her tasks of the day, never in the hours. */
  shifts: readonly CreatorAccountShift[];
  onOpenDay: (day: string) => void;
  onMove: (task: CreatorTask, when: CreatorTaskWhen) => void;
  onSuggestion: (suggestion: CreatorSuggestion) => void;
} & DayActions): JSX.Element {
  const now = useNow();
  const zone = agenda.timeZone;
  const days = weekOf(monday);
  const plans = days.map((day) => planOf(agenda, day));
  const hours = hoursOf(plans);
  const nowMinute = minuteOf(now, zone);
  const columns = useRef(new Map<string, HTMLDivElement>());
  const press = useRef<Press | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // What the pointer handlers read: the drag as it is now, not as the last render saw it.
  const current = useRef<Drag | null>(null);
  const put = (next: Drag | null): void => {
    current.current = next;
    setDrag(next);
  };
  const dragged = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // The week opens on her day: an hour before now this week, else an hour before her first task.
  const firstStart = Math.min(...plans.flatMap((plan) => plan.timed.map((item) => item.start)));
  const thisWeek = days.includes(agenda.today);
  const opensAt = Math.max(
    hours.first * 60,
    (thisWeek ? nowMinute : Number.isFinite(firstStart) ? firstStart : 9 * 60) - 60,
  );
  const opened = useRef<string | null>(null);
  useEffect(() => {
    const element = scroller.current;
    if (element === null || opened.current === monday) return;
    opened.current = monday;
    element.scrollTop = ((opensAt - hours.first * 60) / 60) * HOUR_PX;
  }, [monday, opensAt, hours.first]);

  // Once a long press has lifted a task, the finger drags it: the page must not scroll under it (React's touch
  // listeners are passive, so this one is the browser's own).
  useEffect(() => {
    const element = root.current;
    if (element === null) return;
    const hold = (event: TouchEvent): void => {
      if (press.current?.started === true) event.preventDefault();
    };
    element.addEventListener('touchmove', hold, { passive: false });
    return () => {
      element.removeEventListener('touchmove', hold);
    };
  }, []);

  const columnAt = (x: number): [string, DOMRect] | null => {
    for (const [day, element] of columns.current) {
      const rect = element.getBoundingClientRect();
      if (x >= rect.left && x < rect.right) return [day, rect];
    }
    return null;
  };

  const start = (held: Press): void => {
    held.started = true;
    const column = columns.current.get(held.day);
    if (column === undefined) return;
    const rect = column.getBoundingClientRect();
    const at = minuteAt(held.y, rect, hours);
    try {
      navigator.vibrate(8);
    } catch {
      // A browser without vibration.
    }
    if (held.item === null) {
      put({ kind: 'create', day: held.day, from: at, span: createdSpan(at, at, hours) });
      return;
    }
    const item = { start: held.item.start, end: Math.min(held.item.end, hours.last * 60) };
    put({ kind: 'move', task: held.item.task, day: held.day, grab: at - item.start, item, span: item });
  };

  const onPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
    day: string,
    item: TimedTask | null,
  ): void => {
    if (event.button > 0) return;
    const touch = event.pointerType !== 'mouse';
    const held: Press = {
      x: event.clientX,
      y: event.clientY,
      touch,
      pointer: event.pointerId,
      day,
      item,
      timer: null,
      started: false,
    };
    press.current = held;
    if (touch)
      held.timer = window.setTimeout(() => {
        if (press.current === held && !held.started) start(held);
      }, LONG_PRESS_MS);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const held = press.current;
    if (held === null) return;
    const moved = Math.hypot(event.clientX - held.x, event.clientY - held.y);
    if (!held.started) {
      if (held.touch) {
        // Moved before the long press: she is scrolling.
        if (moved > TOUCH_SLOP) cancel();
        return;
      }
      if (moved < MOUSE_SLOP) return;
      start(held);
    }
    event.currentTarget.setPointerCapture(held.pointer);
    const before = current.current;
    if (before === null) return;
    if (before.kind === 'create') {
      const column = columns.current.get(before.day);
      if (column === undefined) return;
      const at = minuteAt(event.clientY, column.getBoundingClientRect(), hours);
      put({ ...before, span: createdSpan(before.from, at, hours) });
      return;
    }
    const under = columnAt(event.clientX);
    if (under === null) return;
    const [day, rect] = under;
    put({
      ...before,
      day,
      span: movedSpan(before.item, minuteAt(event.clientY, rect, hours) - before.grab, hours),
    });
  };

  const cancel = (): void => {
    const held = press.current;
    if (held?.timer !== null && held?.timer !== undefined) window.clearTimeout(held.timer);
    press.current = null;
    put(null);
  };

  const onPointerUp = (): void => {
    const held = press.current;
    const done = current.current;
    cancel();
    if (held === null || !held.started || done === null) return;
    dragged.current = Date.now();
    if (done.kind === 'create') {
      actions.onAdd({ day: done.day, start: done.span.start, end: done.span.end % 1440 });
      return;
    }
    const when = movedWhen(done.task, done.day, done.span, zone);
    if (when !== null) onMove(done.task, when);
  };

  // A drag ends on a pointer up that the browser turns into a click: that click is the drag's, not a tap.
  const justDragged = (): boolean => Date.now() - dragged.current < 300;

  const span = (hours.last - hours.first) * 60;
  const top = (minute: number): string => `${(((minute - hours.first * 60) / span) * 100).toFixed(3)}%`;
  const height = (from: number, to: number): string => `${(((to - from) / span) * 100).toFixed(3)}%`;

  return (
    <div ref={root} className="ag-wk nv-plate" data-dragging={drag === null ? undefined : 'true'}>
      <div ref={scroller} className="ag-wk__scroll">
        {/* Days, her tasks of the day and who answers her fans stay in view while the hours scroll (CREA-27). */}
        <div className="ag-wk__top">
          <div className="ag-wk__head">
            <span />
            {days.map((day, index) => (
              <button
                key={day}
                type="button"
                className="ag-wk__day"
                data-today={day === agenda.today ? 'true' : undefined}
                aria-label={`Ouvrir ${WEEKDAY_SHORT[index] ?? ''} ${dayNumber(day)} en Jour`}
                onClick={() => {
                  onOpenDay(day);
                }}
              >
                <span aria-hidden="true">{WEEKDAY_SHORT[index]}</span>
                <b className="nv-num" aria-hidden="true">
                  {dayNumber(day)}
                </b>
                <Routine plan={plans[index]} />
              </button>
            ))}
          </div>
          <div className="ag-wk__all">
            <span className="ag-wk__label">tâches</span>
            {plans.map((plan) => (
              <div key={plan.day} className="ag-wk__cell">
                {plan.todo
                  .filter((item) => item.task.when.kind === 'day')
                  .map((item) => (
                    <button
                      key={item.task.id}
                      type="button"
                      className="ag-mini"
                      data-cat={item.task.category}
                      data-done={item.done ? 'true' : undefined}
                      onClick={() => {
                        actions.onTask(item.task, plan.day);
                      }}
                    >
                      <span aria-hidden="true">{CATEGORY_EMOJI[item.task.category]}</span>
                      <span className="ag-mini__title">{item.task.title}</span>
                    </button>
                  ))}
                {plan.suggestions
                  .filter((suggestion) => suggestion.when?.kind === 'day')
                  .map((suggestion) => (
                    <button
                      key={suggestion.id}
                      type="button"
                      className="ag-mini"
                      data-cat={suggestion.category}
                      data-proposed="true"
                      onClick={() => {
                        onSuggestion(suggestion);
                      }}
                    >
                      <span aria-hidden="true">{CATEGORY_EMOJI[suggestion.category]}</span>
                      <span className="ag-mini__title">{suggestion.title}</span>
                    </button>
                  ))}
              </div>
            ))}
          </div>
          {shifts.length === 0 ? null : (
            <div className="ag-wk__all ag-wk__fans">
              <span className="ag-wk__label" aria-hidden="true">
                fans
              </span>
              {plans.map((plan) => (
                <div key={plan.day} className="ag-wk__cell">
                  <ShortReplies lines={repliesOn(shifts, plan.day, agenda.timeZone)} />
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="ag-wk__grid" style={{ '--ag-hours': hours.last - hours.first }}>
          <div className="ag-wk__hours" aria-hidden="true">
            {Array.from({ length: hours.last - hours.first - 1 }, (_, index) => hours.first + index + 1).map(
              (hour) => (
                <span key={hour} className="nv-num" style={{ top: top(hour * 60) }}>
                  {hour} h
                </span>
              ),
            )}
          </div>
          {plans.map((plan) => (
            <div
              key={plan.day}
              ref={(element) => {
                if (element === null) columns.current.delete(plan.day);
                else columns.current.set(plan.day, element);
              }}
              className="ag-wk__col"
              data-today={plan.day === agenda.today ? 'true' : undefined}
              onPointerDown={(event) => {
                if (event.target === event.currentTarget) onPointerDown(event, plan.day, null);
              }}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={cancel}
              onContextMenu={(event) => {
                event.preventDefault();
              }}
            >
              {plan.windows.map((window) => (
                <div
                  key={window.id}
                  className="ag-wk__dispo"
                  style={{
                    top: top(window.start),
                    height: height(window.start, Math.min(window.end, hours.last * 60)),
                  }}
                >
                  <span>Dispo</span>
                </div>
              ))}
              <Column
                plan={plan}
                agenda={agenda}
                nowMinute={nowMinute}
                drag={drag}
                top={top}
                height={height}
                hoursLast={hours.last}
                onPress={(event, item) => {
                  onPointerDown(event, plan.day, item);
                }}
                onOpen={(task) => {
                  if (!justDragged()) actions.onTask(task, plan.day);
                }}
                onSuggestion={(suggestion) => {
                  if (!justDragged()) onSuggestion(suggestion);
                }}
              />
              {drag?.kind === 'create' && drag.day === plan.day ? (
                <div
                  className="ag-wk__ghost nv-num"
                  style={{ top: top(drag.span.start), height: height(drag.span.start, drag.span.end) }}
                >
                  {clockOf(drag.span.start)} – {clockOf(drag.span.end % 1440)}
                </div>
              ) : null}
              {drag?.kind === 'move' && drag.day === plan.day ? (
                <div
                  className="ag-wk__ev ag-wk__ev--lifted"
                  data-cat={drag.task.category}
                  style={{ top: top(drag.span.start), height: height(drag.span.start, drag.span.end) }}
                  aria-hidden="true"
                >
                  <b>
                    <span>{CATEGORY_EMOJI[drag.task.category]}</span> {drag.task.title}
                  </b>
                  <span className="nv-num">
                    {clockOf(drag.span.start)} – {clockOf(drag.span.end % 1440)}
                  </span>
                </div>
              ) : null}
              {plan.day === agenda.today && nowMinute >= hours.first * 60 ? (
                <i className="ag-wk__now" style={{ top: top(nowMinute) }} aria-hidden="true" />
              ) : null}
            </div>
          ))}
        </div>
      </div>
      <p className="ag-wk__hint">
        Glisse sur une heure libre pour créer, glisse une tâche vers une autre heure ou un autre jour pour la
        déplacer.
      </p>
    </div>
  );
}

/** Her routine of a day under its date: done out of due, or nothing when none is due. */
function Routine({ plan }: { plan: DayPlan | undefined }): JSX.Element | null {
  const routine = plan?.todo.filter((item) => item.task.when.kind === 'routine') ?? [];
  if (routine.length === 0) return null;
  const done = routine.filter((item) => item.done).length;
  return (
    <span className="ag-wk__routine nv-num" data-full={done === routine.length ? 'true' : undefined}>
      {done}/{routine.length} routine
    </span>
  );
}

function Column({
  plan,
  agenda,
  nowMinute,
  drag,
  top,
  height,
  hoursLast,
  onPress,
  onOpen,
  onSuggestion,
}: {
  plan: DayPlan;
  agenda: CreatorAgenda;
  nowMinute: number;
  drag: Drag | null;
  top: (minute: number) => string;
  height: (from: number, to: number) => string;
  hoursLast: number;
  onPress: (event: ReactPointerEvent<HTMLDivElement>, item: TimedTask) => void;
  onOpen: (task: CreatorTask) => void;
  onSuggestion: (suggestion: CreatorSuggestion) => void;
}): JSX.Element {
  const suggested = timedSuggestionsOf(plan, agenda.timeZone);
  const placed = lanesOf([
    ...plan.timed.map((item) => ({ start: item.start, end: item.end, item, suggestion: null })),
    ...suggested.map((one) => ({ start: one.start, end: one.end, item: null, suggestion: one.suggestion })),
  ]);
  return (
    <>
      {placed.map((one) => {
        const end = Math.min(one.end, hoursLast * 60);
        const style = {
          top: top(one.start),
          height: height(one.start, end),
          left: `calc(${String((100 / one.lanes) * one.lane)}% + 3px)`,
          width: `calc(${String(100 / one.lanes)}% - 6px)`,
        };
        const short = end - one.start < 60;
        if (one.suggestion !== null) {
          const { suggestion } = one;
          return (
            <button
              key={suggestion.id}
              type="button"
              className="ag-wk__ev"
              data-cat={suggestion.category}
              data-proposed="true"
              data-short={short ? 'true' : undefined}
              style={style}
              onClick={() => {
                onSuggestion(suggestion);
              }}
            >
              <b>
                <span aria-hidden="true">{CATEGORY_EMOJI[suggestion.category]}</span> {suggestion.title}
              </b>
              <span className="nv-num">Proposé · {clockOf(one.start)}</span>
            </button>
          );
        }
        const { item } = one;
        const over = isOver(item, plan.day, agenda.today, nowMinute);
        const lifted = drag?.kind === 'move' && drag.task.id === item.task.id;
        return (
          <div
            key={item.task.id}
            role="button"
            tabIndex={0}
            className="ag-wk__ev"
            data-cat={item.task.category}
            data-done={item.done ? 'true' : undefined}
            data-past={over ? 'true' : undefined}
            data-short={short ? 'true' : undefined}
            data-placeholder={lifted ? 'true' : undefined}
            style={style}
            aria-label={`${item.task.title}, ${clockOf(item.start)} – ${clockOf(item.end % 1440)}`}
            onPointerDown={(event) => {
              event.stopPropagation();
              if (!over) onPress(event, item);
            }}
            onClick={() => {
              onOpen(item.task);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onOpen(item.task);
              }
            }}
          >
            <b>
              <span aria-hidden="true">{CATEGORY_EMOJI[item.task.category]}</span> {item.task.title}
            </b>
            <span className="nv-num">
              {clockOf(item.start)} – {clockOf(item.end % 1440)}
            </span>
          </div>
        );
      })}
    </>
  );
}
