import { CREATOR_TASK_CATEGORY_LABELS, type CreatorAgenda, type CreatorTask } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type JSX, type SyntheticEvent } from 'react';

import { ShootBrief } from './ShootBrief';
import { AGENDA_KEY, archiveTask, moveTask, NOT_SENT } from './api';
import { dayInReach, OUT_OF_REACH, spanOf } from './draft';
import { whenWords } from './words';

import { DayField, NO_SUCH_DAY } from '@/scheduling/DayField';
import { TimeField, useUnreadableTimes } from '@/scheduling/TimeField';
import { clockOf, dayOf, minuteOf } from '@/scheduling/time';
import { Dialog } from '@/shell/Dialog';
import '@/screens/team/team.css';

/**
 * One of her tasks, opened: what it is, what it is for, « Changer le moment » (what a drag does in Semaine, by the
 * keyboard or a touch) and « Retirer » (archived, never deleted).
 */
export function TaskDialog({
  agenda,
  task,
  day,
  onClose,
  onNotice,
}: {
  agenda: CreatorAgenda;
  task: CreatorTask;
  day: string;
  onClose: () => void;
  onNotice: (notice: string) => void;
}): JSX.Element {
  const client = useQueryClient();
  const [mode, setMode] = useState<'read' | 'move' | 'remove'>('read');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const done = agenda.ticks.some((tick) => tick.taskId === task.id && tick.day === day);
  const movable = task.when.kind !== 'routine';
  const remove = (): void => {
    setBusy(true);
    setFailed(null);
    void archiveTask(task.id).then(async (outcome) => {
      setBusy(false);
      if (outcome.kind === 'offline' || outcome.kind === 'failed') {
        setFailed(NOT_SENT[outcome.kind]);
        return;
      }
      await client.invalidateQueries({ queryKey: AGENDA_KEY });
      onClose();
    });
  };
  return (
    <Dialog
      className="ag-scope"
      title={task.title}
      lead={`${CREATOR_TASK_CATEGORY_LABELS[task.category]} · ${whenWords(task.when, agenda.timeZone)}`}
      busy={busy}
      onClose={onClose}
    >
      {mode === 'move' ? (
        <MoveForm
          agenda={agenda}
          task={task}
          onBack={() => {
            setMode('read');
          }}
          onMoved={(moved) => {
            if (!moved)
              onNotice(
                'Le changement n’a pas pu se faire : pas de réseau, ou la tâche a changé. Ton agenda est relu.',
              );
            onClose();
          }}
        />
      ) : (
        <div className="tm-dialog__body">
          {task.purpose === null ? null : <p className="ag-explain">{task.purpose}</p>}
          {task.shootBrief === null && task.reelBrief === null ? null : (
            <ShootBrief brief={task.shootBrief} reel={task.reelBrief} folded={false} />
          )}
          {task.essential ? (
            <p className="ag-explain">
              <span className="ag-ess">essentielle</span> Elle compte pour ta série : coche-la chaque jour
              prévu.
            </p>
          ) : null}
          <p className="tm-hint">{done ? 'Faite ce jour-là.' : 'Pas encore faite ce jour-là.'}</p>
          {failed === null ? null : (
            <p className="tm-hint tm-hint--error" role="alert">
              {failed}
            </p>
          )}
          <div className="tm-dialog__foot ag-task-foot">
            {mode === 'remove' ? (
              <>
                <button
                  type="button"
                  className="nv-btn nv-btn--plain"
                  disabled={busy}
                  onClick={() => {
                    setMode('read');
                  }}
                >
                  Garder
                </button>
                <button
                  type="button"
                  className="nv-btn nv-btn--destructive"
                  disabled={busy}
                  aria-busy={busy}
                  data-autofocus
                  onClick={remove}
                >
                  Retirer pour de bon
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="nv-btn nv-btn--plain"
                  onClick={() => {
                    setMode('remove');
                  }}
                >
                  Retirer de mon agenda
                </button>
                {movable ? (
                  <button
                    type="button"
                    className="nv-btn nv-btn--plain"
                    onClick={() => {
                      setMode('move');
                    }}
                  >
                    Changer le moment
                  </button>
                ) : null}
                <button type="button" className="nv-btn nv-btn--neon" onClick={onClose}>
                  OK
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** Another day, and other hours for a task at an hour; its kind stays (a task of a day stays one). */
function MoveForm({
  agenda,
  task,
  onBack,
  onMoved,
}: {
  agenda: CreatorAgenda;
  task: CreatorTask;
  onBack: () => void;
  onMoved: (moved: boolean) => void;
}): JSX.Element {
  const id = useId();
  const client = useQueryClient();
  const zone = agenda.timeZone;
  const { when } = task;
  const timed = when.kind === 'timed';
  const [day, setDay] = useState(
    when.kind === 'timed' ? dayOf(when.startsAt, zone) : when.kind === 'day' ? when.day : agenda.today,
  );
  const [start, setStart] = useState(when.kind === 'timed' ? minuteOf(when.startsAt, zone) : 10 * 60);
  const [end, setEnd] = useState(when.kind === 'timed' ? minuteOf(when.endsAt, zone) : 11 * 60);
  const { unreadable, onUnreadable } = useUnreadableTimes();
  const [busy, setBusy] = useState(false);
  const [badDay, setBadDay] = useState(false);
  const [tried, setTried] = useState(false);
  const [dayUnreadable, setDayUnreadable] = useState(false);
  const [noSuchDay, setNoSuchDay] = useState(false);
  // What is not a day is said once its field is left, the button staying off until it reads (recette des dates).
  const [dayLeft, setDayLeft] = useState(false);
  const dayWrong = badDay || ((tried || dayLeft) && dayUnreadable);
  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    setTried(true);
    if (unreadable) return;
    if (!dayInReach(day)) {
      setBadDay(true);
      return;
    }
    setBusy(true);
    void moveTask(
      client,
      task,
      timed ? { kind: 'timed', ...spanOf(day, start, end, zone) } : { kind: 'day', day },
    ).then((moved) => {
      setBusy(false);
      onMoved(moved);
    });
  };
  return (
    <form className="tm-dialog__body" noValidate onSubmit={submit}>
      <div
        className="nv-field tm-field"
        onFocus={() => {
          setDayLeft(false);
        }}
        onBlur={() => {
          setDayLeft(true);
        }}
      >
        <label className="nv-field__label" htmlFor={`${id}-day`}>
          Jour
        </label>
        <DayField
          id={`${id}-day`}
          value={day}
          autofocus
          invalid={dayWrong}
          describedBy={dayWrong ? `${id}-day-error` : undefined}
          onChange={(next) => {
            setDay(next);
            setBadDay(false);
          }}
          onUnreadable={(bad, none) => {
            setDayUnreadable(bad);
            setNoSuchDay(none);
            onUnreadable('day', bad);
          }}
        />
        {dayWrong ? (
          <p id={`${id}-day-error`} className="tm-hint tm-hint--error" role="alert">
            {badDay ? OUT_OF_REACH : noSuchDay ? NO_SUCH_DAY : 'Un jour comme 28/03/2027, ou 28/3.'}
          </p>
        ) : null}
      </div>
      {timed ? (
        // Début and Fin side by side, as in « Ajouter » (recette des dates).
        <div className="nv-field tm-field">
          <div className="tm-pair">
            <label className="nv-field tm-field">
              <span className="nv-field__label">Début</span>
              <TimeField value={start} label="Début" onChange={setStart} onUnreadable={onUnreadable} />
            </label>
            <label className="nv-field tm-field">
              <span className="nv-field__label">Fin</span>
              <TimeField value={end} label="Fin" onChange={setEnd} onUnreadable={onUnreadable} />
            </label>
          </div>
          {end <= start ? <p className="tm-hint nv-num">Jusqu’à {clockOf(end)} le lendemain.</p> : null}
        </div>
      ) : null}
      <div className="tm-dialog__foot">
        <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onBack}>
          Retour
        </button>
        <button type="submit" className="nv-btn nv-btn--neon" disabled={busy || unreadable} aria-busy={busy}>
          Enregistrer
        </button>
      </div>
    </form>
  );
}
