import { CREATOR_TASK_CATEGORIES, CREATOR_TASK_CATEGORY_LABELS } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type JSX, type ReactNode, type SyntheticEvent } from 'react';

import { AGENDA_KEY, createAvailability, createTask, NOT_SENT } from './api';
import { CATEGORY_EMOJI, CategoryMark } from './category';
import {
  availabilityBodiesOf,
  defaultStart,
  dayInReach,
  dispoIds,
  OUT_OF_REACH,
  newTaskId,
  taskBodyOf,
  taskProblems,
  whenOf,
  type AvailabilityDraft,
  type AvailabilityKind,
  type TaskDraft,
  type TaskWhenKind,
} from './draft';
import { whenWords } from './words';

import { DayField } from '@/scheduling/DayField';
import { TimeField, useUnreadableTimes } from '@/scheduling/TimeField';
import { clockOf, dayOf, longDay, minuteOf, weekdayOf } from '@/scheduling/time';
import { Dialog } from '@/shell/Dialog';
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

export const TASK_KINDS: readonly (readonly [TaskWhenKind, string])[] = [
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

export function Choices<T>({
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

export function Weekdays({
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

export function Hours({
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

/**
 * A day within her agenda's reach (CREA-14): a year back, two years ahead. Typed, never the system's calendar; what is
 * not a day is told to the form through `onUnreadable`, which then does not save.
 */
export function AgendaDay({
  value,
  invalid = false,
  tried,
  onChange,
  onUnreadable,
}: {
  value: string;
  invalid?: boolean;
  /** The form was sent once: a day that does not read is then said. */
  tried: boolean;
  onChange: (day: string) => void;
  onUnreadable: (field: string, unreadable: boolean) => void;
}): JSX.Element {
  const id = useId();
  const [unreadable, setUnreadable] = useState(false);
  const shown = invalid || (tried && unreadable);
  return (
    <div className="nv-field tm-field">
      <label className="nv-field__label" htmlFor={id}>
        Jour
      </label>
      <DayField
        id={id}
        className="tm-date"
        value={value}
        invalid={shown}
        describedBy={shown ? `${id}-error` : undefined}
        onChange={onChange}
        onUnreadable={(bad) => {
          setUnreadable(bad);
          onUnreadable('day', bad);
        }}
      />
      {shown ? (
        <p id={`${id}-error`} className="tm-hint tm-hint--error" role="alert">
          {tried && unreadable ? 'Un jour comme 28/03/2027, ou 28/3.' : OUT_OF_REACH}
        </p>
      ) : null}
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
  const [opened] = useState(() => new Date());
  const start = preset.start ?? defaultStart(preset.day, dayOf(opened, zone), minuteOf(opened, zone));
  const end = preset.end ?? (start + 60) % 1440;
  return (
    <Dialog title="Ajouter" className="ag-scope" onClose={onClose}>
      <div className="tm-dialog__body">
        <KindPicker value={what} onPick={setWhat} />
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

const KINDS: readonly (readonly ['task' | 'dispo', string, string, string])[] = [
  ['task', '✅', 'Une tâche', 'Ce que tu fais : un tournage, un live, un post…'],
  ['dispo', '🕐', 'Une dispo', 'Le temps que tu ouvres à l’agence'],
];

/** « Une tâche » or « Une dispo », as two cards: what each one is, said under it. */
function KindPicker({
  value,
  onPick,
}: {
  value: 'task' | 'dispo';
  onPick: (value: 'task' | 'dispo') => void;
}): JSX.Element {
  const id = useId();
  return (
    <div className="ag-kinds" role="radiogroup" aria-label="Ce que tu ajoutes">
      {KINDS.map(([kind, emoji, label, hint]) => (
        <button
          key={kind}
          type="button"
          role="radio"
          className="ag-kind"
          aria-checked={kind === value}
          aria-label={label}
          aria-describedby={`${id}-${kind}`}
          onClick={() => {
            onPick(kind);
          }}
        >
          <span className="ag-kind__emoji" aria-hidden="true">
            {emoji}
          </span>
          <b>{label}</b>
          <span id={`${id}-${kind}`}>{hint}</span>
        </button>
      ))}
    </div>
  );
}

/** What she is adding, as her agenda will show it: it changes as she types. */
export function Preview({
  mark,
  title,
  when,
  placeholder = 'Ta tâche',
}: {
  mark: JSX.Element;
  title: string;
  when: string;
  /** Read while the title is empty. */
  placeholder?: string;
}): JSX.Element {
  return (
    <div className="ag-preview" aria-hidden="true">
      {mark}
      <div className="ag-preview__text">
        <b data-empty={title === '' ? 'true' : undefined}>{title === '' ? placeholder : title}</b>
        <span className="nv-num">{when}</span>
      </div>
    </div>
  );
}

/** When a draft is, in her words, or what is missing for it to be read: never a day her agenda does not reach. */
export function draftWhen(draft: TaskDraft, zone: string): string {
  if (draft.kind === 'routine' && draft.weekdays.length === 0) return 'Choisis les jours';
  if (draft.kind !== 'routine' && !dayInReach(draft.day)) return 'Choisis le jour';
  return whenWords(whenOf(draft, zone), zone);
}

const WEEKDAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;

function dispoWhen(draft: AvailabilityDraft): string {
  const hours = `${clockOf(draft.start)} – ${clockOf(draft.end)}`;
  if (draft.kind === 'once')
    return dayInReach(draft.day) ? `${longDay(draft.day)}, ${hours}` : 'Choisis le jour';
  if (draft.weekdays.length === 0) return 'Choisis les jours';
  const names = [...draft.weekdays].sort((a, b) => a - b).map((one) => WEEKDAY_NAMES[one - 1] ?? '');
  return `${names.length === 7 ? 'Chaque jour' : `Chaque ${names.join(', ')}`}, ${hours}`;
}

/** Her six categories as tiles: the emoji on its colour, the name under it (« Ajouter », and the agency's « Proposer »). */
export function Categories({
  value,
  onPick,
}: {
  value: TaskDraft['category'];
  onPick: (category: TaskDraft['category']) => void;
}): JSX.Element {
  const id = useId();
  return (
    <div className="nv-field tm-field">
      <span className="nv-field__label" id={id}>
        Catégorie
      </span>
      <div className="ag-cats" role="radiogroup" aria-labelledby={id}>
        {CREATOR_TASK_CATEGORIES.map((category) => (
          <button
            key={category}
            type="button"
            role="radio"
            className="ag-cat"
            data-cat={category}
            aria-checked={category === value}
            onClick={() => {
              onPick(category);
            }}
          >
            <span className="ag-cat__emoji" aria-hidden="true">
              {CATEGORY_EMOJI[category]}
            </span>
            {CREATOR_TASK_CATEGORY_LABELS[category]}
          </button>
        ))}
      </div>
    </div>
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
          outcome.kind === 'refused'
            ? 'Cette tâche n’a pas pu être ajoutée. Vérifie les heures.'
            : NOT_SENT[outcome.kind],
        );
        return;
      }
      await client.invalidateQueries({ queryKey: AGENDA_KEY });
      onClose();
    });
  };
  return (
    <form className="tm-dialog__body" noValidate onSubmit={submit}>
      <Preview
        mark={<CategoryMark category={draft.category} size="lg" />}
        title={draft.title.trim()}
        when={draftWhen(draft, zone)}
      />
      <div
        className="nv-field tm-field"
        data-invalid={tried && problems.includes('title') ? 'true' : undefined}
      >
        <label className="nv-field__label" htmlFor={`${id}-title`}>
          Quoi
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
      <Categories
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
        <AgendaDay
          value={draft.day}
          invalid={tried && problems.includes('day')}
          tried={tried}
          onChange={(day) => {
            set({ day });
          }}
          onUnreadable={onUnreadable}
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
  const badDay = draft.kind !== 'weekly' && !dayInReach(draft.day);
  const set = (patch: Partial<AvailabilityDraft>): void => {
    setDraft((before) => ({ ...before, ...patch }));
  };
  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    setTried(true);
    if (noDay || badDay || unreadable) return;
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
        // The network first: nothing went, whatever the server would have said.
        const notSent = missed.some((outcome) => outcome.kind === 'offline')
          ? 'offline'
          : missed.some((outcome) => outcome.kind === 'failed')
            ? 'failed'
            : null;
        setFailed(
          notSent === null ? 'Cette dispo n’a pas pu être ajoutée. Vérifie les heures.' : NOT_SENT[notSent],
        );
      },
    );
  };
  return (
    <form className="tm-dialog__body" noValidate onSubmit={submit}>
      <Preview
        mark={
          <span className="ag-mark ag-mark--dispo" data-size="lg" aria-hidden="true">
            🕐
          </span>
        }
        title="Dispo pour l’agence"
        when={dispoWhen(draft)}
      />
      <p className="ag-explain">L’agence n’y propose une tâche que là, et tu choisis toujours.</p>
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
        <AgendaDay
          value={draft.day}
          invalid={tried && badDay}
          tried={tried}
          onChange={(day) => {
            set({ day });
          }}
          onUnreadable={onUnreadable}
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
