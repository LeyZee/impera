import { CREATOR_TASK_CATEGORIES, CREATOR_TASK_CATEGORY_LABELS } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type JSX, type ReactNode, type SyntheticEvent } from 'react';

import { AGENDA_KEY, createAvailability, createTask } from './api';
import {
  availabilityBodiesOf,
  dispoIds,
  newTaskId,
  taskBodyOf,
  taskProblems,
  type AvailabilityDraft,
  type AvailabilityKind,
  type TaskDraft,
  type TaskWhenKind,
} from './draft';

import { TimeField, useUnreadableTimes } from '@/scheduling/TimeField';
import { clockOf, weekdayOf } from '@/scheduling/time';
import { Dialog } from '@/screens/team/Dialog';
import '@/screens/team/team.css';

/** Where « Ajouter » opens: the day shown, and the free time touched when it was one. */
export interface AddPreset {
  readonly day: string;
  readonly start?: number;
  readonly end?: number;
}

const WEEKDAYS: readonly (readonly [number, string, string])[] = [
  [1, 'L', 'lundi'],
  [2, 'M', 'mardi'],
  [3, 'M', 'mercredi'],
  [4, 'J', 'jeudi'],
  [5, 'V', 'vendredi'],
  [6, 'S', 'samedi'],
  [7, 'D', 'dimanche'],
];

const TASK_KINDS: readonly (readonly [TaskWhenKind, string])[] = [
  ['timed', 'À une heure'],
  ['day', 'Un jour'],
  ['routine', 'Chaque semaine'],
];

const DISPO_KINDS: readonly (readonly [AvailabilityKind, string])[] = [
  ['weekly', 'Chaque semaine'],
  ['once', 'Une fois'],
];

const REMINDERS: readonly (readonly [number | null, string])[] = [
  [null, 'Aucun'],
  [15, '15 min avant'],
  [30, '30 min avant'],
  [60, '1 h avant'],
];

const OFFLINE =
  'Pas de réseau : ce que tu ajoutes part quand le téléphone est en ligne. Réessaie dans un moment.';

function Choices<T>({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: readonly (readonly [T, string])[];
  value: T;
  onPick: (value: T) => void;
}): JSX.Element {
  const id = useId();
  return (
    <div className="nv-field tm-field">
      <span className="nv-field__label" id={id}>
        {label}
      </span>
      <div className="tm-choices" role="radiogroup" aria-labelledby={id}>
        {options.map(([one, text]) => (
          <button
            key={text}
            type="button"
            role="radio"
            className="nv-chip"
            aria-checked={one === value}
            onClick={() => {
              onPick(one);
            }}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function Weekdays({
  value,
  invalid,
  onChange,
}: {
  value: readonly number[];
  invalid: boolean;
  onChange: (weekdays: number[]) => void;
}): JSX.Element {
  const id = useId();
  return (
    <div className="nv-field tm-field" data-invalid={invalid ? 'true' : undefined}>
      <span className="nv-field__label" id={id}>
        Les jours
      </span>
      <div className="ag-weekdays" role="group" aria-labelledby={id}>
        {WEEKDAYS.map(([weekday, letter, name]) => (
          <button
            key={weekday}
            type="button"
            className="nv-chip"
            aria-pressed={value.includes(weekday)}
            aria-label={name}
            onClick={() => {
              onChange(
                value.includes(weekday) ? value.filter((one) => one !== weekday) : [...value, weekday],
              );
            }}
          >
            {letter}
          </button>
        ))}
      </div>
      {invalid ? <p className="tm-hint tm-hint--error">Choisis au moins un jour.</p> : null}
    </div>
  );
}

function Hours({
  start,
  end,
  onStart,
  onEnd,
  onUnreadable,
}: {
  start: number;
  end: number;
  onStart: (minute: number) => void;
  onEnd: (minute: number) => void;
  onUnreadable: (field: string, unreadable: boolean) => void;
}): JSX.Element {
  return (
    <div className="nv-field tm-field">
      <div className="tm-pair">
        <label className="nv-field tm-field">
          <span className="nv-field__label">Début</span>
          <TimeField value={start} label="Début" onChange={onStart} onUnreadable={onUnreadable} />
        </label>
        <label className="nv-field tm-field">
          <span className="nv-field__label">Fin</span>
          <TimeField value={end} label="Fin" onChange={onEnd} onUnreadable={onUnreadable} />
        </label>
      </div>
      {end <= start ? (
        <p className="tm-hint nv-num">
          {end === start ? 'Toute la journée, 24 heures.' : `Jusqu’à ${clockOf(end)} le lendemain.`}
        </p>
      ) : null}
    </div>
  );
}

function DayField({ value, onChange }: { value: string; onChange: (day: string) => void }): JSX.Element {
  const id = useId();
  return (
    <div className="nv-field tm-field">
      <label className="nv-field__label" htmlFor={id}>
        Jour
      </label>
      <input
        id={id}
        type="date"
        className="nv-field__control nv-glass tm-date"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </div>
  );
}

/**
 * « Ajouter » (CR-05, Charles 02/11, 20 h 17): « Une tâche » or « Une dispo », nothing else. A task has its hours, a
 * day, or its days of the week (her routine); a dispo is time she opens to the agency, every week or once. Created
 * online: offline, the form says so and keeps what she typed.
 */
export function AddDialog({
  zone,
  preset,
  onClose,
}: {
  zone: string;
  preset: AddPreset;
  onClose: () => void;
}): JSX.Element {
  const [what, setWhat] = useState<'task' | 'dispo'>('task');
  const start = preset.start ?? 10 * 60;
  const end = preset.end ?? (start + 60) % 1440;
  return (
    <Dialog title="Ajouter" onClose={onClose}>
      <div className="tm-dialog__body">
        <Choices
          label="Quoi"
          options={[
            ['task', 'Une tâche'],
            ['dispo', 'Une dispo'],
          ]}
          value={what}
          onPick={setWhat}
        />
        {what === 'task' ? (
          <TaskForm
            zone={zone}
            initial={{
              title: '',
              category: 'shoot',
              kind: preset.start === undefined ? 'day' : 'timed',
              day: preset.day,
              start,
              end,
              weekdays: [weekdayOf(preset.day)],
              purpose: '',
              reminderMinutes: null,
            }}
            onClose={onClose}
          />
        ) : (
          <DispoForm
            zone={zone}
            initial={{ kind: 'weekly', day: preset.day, weekdays: [weekdayOf(preset.day)], start, end }}
            onClose={onClose}
          />
        )}
      </div>
    </Dialog>
  );
}

function Foot({
  busy,
  disabled,
  failed,
  onClose,
}: {
  busy: boolean;
  disabled: boolean;
  failed: ReactNode;
  onClose: () => void;
}): JSX.Element {
  return (
    <>
      {failed === null ? null : (
        <p className="tm-hint tm-hint--error" role="alert">
          {failed}
        </p>
      )}
      <div className="tm-dialog__foot">
        <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onClose}>
          Annuler
        </button>
        <button type="submit" className="nv-btn nv-btn--neon" disabled={busy || disabled} aria-busy={busy}>
          Ajouter
        </button>
      </div>
    </>
  );
}

function TaskForm({
  zone,
  initial,
  onClose,
}: {
  zone: string;
  initial: TaskDraft;
  onClose: () => void;
}): JSX.Element {
  const id = useId();
  const client = useQueryClient();
  const [draft, setDraft] = useState(initial);
  const [taskId] = useState(newTaskId);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const { unreadable, onUnreadable } = useUnreadableTimes();
  const problems = taskProblems(draft);
  const set = (patch: Partial<TaskDraft>): void => {
    setDraft((before) => ({ ...before, ...patch }));
  };
  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    setTried(true);
    if (problems.length > 0 || unreadable) return;
    setBusy(true);
    setFailed(null);
    void createTask(taskBodyOf(draft, zone, taskId)).then(async (outcome) => {
      setBusy(false);
      if (outcome.kind !== 'ok') {
        setFailed(
          outcome.kind === 'failed' ? OFFLINE : 'Cette tâche n’a pas pu être ajoutée. Vérifie les heures.',
        );
        return;
      }
      await client.invalidateQueries({ queryKey: AGENDA_KEY });
      onClose();
    });
  };
  return (
    <form className="tm-dialog__body" noValidate onSubmit={submit}>
      <div
        className="nv-field tm-field"
        data-invalid={tried && problems.includes('title') ? 'true' : undefined}
      >
        <label className="nv-field__label" htmlFor={`${id}-title`}>
          Titre
        </label>
        <input
          id={`${id}-title`}
          className="nv-field__control nv-glass"
          maxLength={80}
          value={draft.title}
          data-autofocus
          autoComplete="off"
          onChange={(event) => {
            set({ title: event.target.value });
          }}
        />
        {tried && problems.includes('title') ? (
          <p className="tm-hint tm-hint--error">Donne-lui un titre.</p>
        ) : null}
      </div>
      <Choices
        label="Catégorie"
        options={CREATOR_TASK_CATEGORIES.map(
          (category) => [category, CREATOR_TASK_CATEGORY_LABELS[category]] as const,
        )}
        value={draft.category}
        onPick={(category) => {
          set({ category });
        }}
      />
      <Choices
        label="Quand"
        options={TASK_KINDS}
        value={draft.kind}
        onPick={(kind) => {
          set({ kind });
        }}
      />
      {draft.kind === 'routine' ? (
        <Weekdays
          value={draft.weekdays}
          invalid={tried && problems.includes('weekdays')}
          onChange={(weekdays) => {
            set({ weekdays });
          }}
        />
      ) : (
        <DayField
          value={draft.day}
          onChange={(day) => {
            set({ day });
          }}
        />
      )}
      {draft.kind === 'timed' ? (
        <>
          <Hours
            start={draft.start}
            end={draft.end}
            onStart={(minute) => {
              set({ start: minute });
            }}
            onEnd={(minute) => {
              set({ end: minute });
            }}
            onUnreadable={onUnreadable}
          />
          <Choices
            label="Rappel"
            options={REMINDERS}
            value={draft.reminderMinutes}
            onPick={(reminderMinutes) => {
              set({ reminderMinutes });
            }}
          />
        </>
      ) : null}
      <div className="nv-field tm-field">
        <label className="nv-field__label" htmlFor={`${id}-purpose`}>
          À quoi ça sert <span className="ag-optional">facultatif</span>
        </label>
        <input
          id={`${id}-purpose`}
          className="nv-field__control nv-glass"
          maxLength={160}
          value={draft.purpose}
          autoComplete="off"
          onChange={(event) => {
            set({ purpose: event.target.value });
          }}
        />
      </div>
      <Foot busy={busy} disabled={unreadable} failed={failed} onClose={onClose} />
    </form>
  );
}

function DispoForm({
  zone,
  initial,
  onClose,
}: {
  zone: string;
  initial: AvailabilityDraft;
  onClose: () => void;
}): JSX.Element {
  const client = useQueryClient();
  const [draft, setDraft] = useState(initial);
  const [idFor] = useState(dispoIds);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const { unreadable, onUnreadable } = useUnreadableTimes();
  const noDay = draft.kind === 'weekly' && draft.weekdays.length === 0;
  const set = (patch: Partial<AvailabilityDraft>): void => {
    setDraft((before) => ({ ...before, ...patch }));
  };
  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    setTried(true);
    if (noDay || unreadable) return;
    setBusy(true);
    setFailed(null);
    void Promise.all(availabilityBodiesOf(draft, zone, idFor).map(createAvailability)).then(
      async (outcomes) => {
        setBusy(false);
        await client.invalidateQueries({ queryKey: AGENDA_KEY });
        const missed = outcomes.filter((outcome) => outcome.kind !== 'ok');
        if (missed.length === 0) {
          onClose();
          return;
        }
        setFailed(
          missed.some((outcome) => outcome.kind === 'failed')
            ? OFFLINE
            : 'Cette dispo n’a pas pu être ajoutée. Vérifie les heures.',
        );
      },
    );
  };
  return (
    <form className="tm-dialog__body" noValidate onSubmit={submit}>
      <p className="ag-explain">
        Le temps que tu ouvres à l’agence : elle n’y propose une tâche que là, et tu choisis toujours.
      </p>
      <Choices
        label="Quand"
        options={DISPO_KINDS}
        value={draft.kind}
        onPick={(kind) => {
          set({ kind });
        }}
      />
      {draft.kind === 'weekly' ? (
        <Weekdays
          value={draft.weekdays}
          invalid={tried && noDay}
          onChange={(weekdays) => {
            set({ weekdays });
          }}
        />
      ) : (
        <DayField
          value={draft.day}
          onChange={(day) => {
            set({ day });
          }}
        />
      )}
      <Hours
        start={draft.start}
        end={draft.end}
        onStart={(minute) => {
          set({ start: minute });
        }}
        onEnd={(minute) => {
          set({ end: minute });
        }}
        onUnreadable={onUnreadable}
      />
      <Foot busy={busy} disabled={unreadable} failed={failed} onClose={onClose} />
    </form>
  );
}
