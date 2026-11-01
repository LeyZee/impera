import {
  DEFAULT_AGENT_HOURS,
  type AgentHours,
  type AgentHoursView,
  type AgentSlot,
  type MinuteRange,
} from '@nirvana/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type JSX } from 'react';

import { SaveBar, useOnScreen } from '../SaveBar';
import { ZoneEditor } from '../ZoneEditor';
import { Segment } from '../persona/fields';

import { HOURS_ERRORS, hoursErrorKind, hoursQueryKey, saveAgentHours, useAgentHours } from './api';
import {
  barsOf,
  canAddSlot,
  clockHeader,
  DAY_NAMES,
  DAY_SHORT,
  isDefaultHours,
  issuesOf,
  newSlotOn,
  noFollowUpEver,
  noSlotWhy,
  rangeIssue,
  rangeOf,
  sameHours,
  slotIssue,
  slotNote,
  slotsByDay,
  slotsToOffer,
  slotWords,
  sortedHours,
  WEEK_FULL,
} from './model';
import './hours.css';

import { TimeField, useUnreadableTimes } from '@/scheduling/TimeField';
import { MINUTES_PER_DAY } from '@/scheduling/time';
import { PasswordPrompt, SignInAgain } from '@/settings/services/PasswordPrompt';
import { ReauthRequired } from '@/settings/services/api';

/**
 * Créatrices › Heures (P3-14), the owner's alone: when the agent may answer her fans, when it never follows up, and
 * when her Nuit scripts apply, all on her clock. Out of her slots the agent writes nothing; the messages wait and are
 * answered at the opening. Built like the persona: a head with the state and the one action, then the work.
 */
export function HoursSection({
  creatorId,
  creatorName,
  onDirty = ignore,
}: {
  creatorId: string;
  creatorName: string;
  /** Told whether her hours hold changes not saved, so that leaving the page can ask first. Must be stable. */
  onDirty?: (dirty: boolean) => void;
}): JSX.Element {
  const query = useAgentHours(creatorId);

  if (query.data === undefined) {
    if (query.isError) {
      const kind = hoursErrorKind(query.error);
      return (
        <section className="ps-page">
          <div className="nv-plate ps-head">
            <p className="ps-title">Ses heures ne se chargent pas</p>
            <p className="ps-muted">{HOURS_ERRORS[kind]}</p>
            {kind === 'session_expired' ? (
              <SignInAgain />
            ) : kind === 'unavailable' ? (
              <button
                type="button"
                className="nv-btn nv-btn--soft ps-self-start"
                onClick={() => void query.refetch()}
              >
                Réessayer
              </button>
            ) : null}
          </div>
        </section>
      );
    }
    return (
      <section className="ps-page" aria-busy="true" aria-label="Heures d’activité">
        <div className="nv-plate ps-head ps-skeleton" />
        <div className="nv-plate ps-panel ps-skeleton ps-skeleton--tall" />
      </section>
    );
  }
  return (
    <HoursForm
      key={creatorId}
      creatorId={creatorId}
      creatorName={creatorName}
      view={query.data}
      onDirty={onDirty}
    />
  );
}

const ignore = (): void => undefined;

interface Problem {
  readonly text: string;
  readonly expired: boolean;
}

function HoursForm({
  creatorId,
  creatorName,
  view,
  onDirty,
}: {
  creatorId: string;
  creatorName: string;
  view: AgentHoursView;
  onDirty: (dirty: boolean) => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  // Her slots in the order of the week when they arrive and once saved, never while she types (CREA-22).
  const [stored, setStored] = useState(() => ({ ...view, hours: sortedHours(view.hours) }));
  const [draft, setDraft] = useState<AgentHours>(stored.hours);
  /** The slots she had, kept while « À toute heure » is picked, so that coming back does not lose them. */
  const [keptSlots, setKeptSlots] = useState<readonly AgentSlot[] | null>(
    stored.hours.reply.mode === 'slots' ? stored.hours.reply.slots : null,
  );
  const headRef = useRef<HTMLDivElement>(null);
  const headOnScreen = useOnScreen(headRef);
  const [saving, setSaving] = useState(false);
  const [reauth, setReauth] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const issues = issuesOf(draft);
  // An hour typed that is not one (« 25:00 ») stays on screen and holds the form back: it never saves another hour.
  const times = useUnreadableTimes();
  // A stored setting that no longer reads is replaced by saving, even unchanged: the defaults then go in its place.
  const changed = !sameHours(draft, stored.hours) || stored.invalidStored;
  const blocked = issues.size > 0 || times.unreadable;
  const dirty = !sameHours(draft, stored.hours) || times.unreadable;
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(
    () => () => {
      onDirty(false);
    },
    [onDirty],
  );
  const noFollowUp = noFollowUpEver(draft, stored.timeZone, new Date());

  const edit = (next: AgentHours): void => {
    setDraft(next);
    setNotice(null);
    setProblem(null);
  };
  const editSlots = (slots: AgentSlot[]): void => {
    setKeptSlots(slots);
    edit({ ...draft, reply: { mode: 'slots', slots } });
  };

  async function save(): Promise<void> {
    setSaving(true);
    setProblem(null);
    try {
      // The defaults are stored as none: she then follows them as they are, today and after.
      const saved = await saveAgentHours(creatorId, isDefaultHours(draft) ? null : sortedHours(draft));
      queryClient.setQueryData(hoursQueryKey(creatorId), saved);
      const sorted = sortedHours(saved.hours);
      setStored({ ...saved, hours: sorted });
      setDraft(sorted);
      if (sorted.reply.mode === 'slots') setKeptSlots(sorted.reply.slots);
      setNotice('Enregistré : l’agent suit ces heures dès maintenant.');
    } catch (error) {
      if (error instanceof ReauthRequired) setReauth(true);
      else {
        const kind = hoursErrorKind(error);
        setProblem({ text: HOURS_ERRORS[kind], expired: kind === 'session_expired' });
      }
    } finally {
      setSaving(false);
    }
  }

  const state =
    problem !== null
      ? { dot: 'warn', text: problem.text }
      : blocked
        ? {
            dot: 'warn',
            text:
              issues.size > 1
                ? `${String(issues.size)} lignes à corriger`
                : issues.size === 1
                  ? 'Une ligne à corriger'
                  : 'Une heure à corriger, sur 24 heures : 22, 2230 ou 22:30',
          }
        : stored.invalidStored && sameHours(draft, stored.hours)
          ? {
              dot: 'warn',
              text: 'Son réglage enregistré ne se lit plus : l’agent suit les réglages d’origine. Enregistre pour le remplacer.',
            }
          : changed
            ? { dot: 'ok', text: 'Modifié, prêt à enregistrer' }
            : notice !== null
              ? { dot: 'ok', text: notice }
              : stored.isDefault
                ? { dot: 'idle', text: 'Réglages d’origine : l’agent répond à toute heure' }
                : { dot: 'idle', text: 'Aucune modification' };

  const slots = draft.reply.mode === 'slots' ? draft.reply.slots : null;
  const undo = (): void => {
    edit(stored.hours);
    setKeptSlots(stored.hours.reply.mode === 'slots' ? stored.hours.reply.slots : null);
  };

  return (
    <section className="ps-page">
      <div className="nv-plate ps-head" ref={headRef}>
        <div className="ps-head__top">
          <div className="ps-head__who">
            {/* The switch above says « Heures d'activité »: the card is titled by whose clock it reads (CREA-24). */}
            <h2 className="ps-title">{clockHeader(creatorName, stored.timeZone)}</h2>
          </div>
          <div className="ps-head__actions">
            {changed && !saving && !sameHours(draft, stored.hours) ? (
              <button type="button" className="nv-btn nv-btn--plain nv-btn--sm ps-pop" onClick={undo}>
                Tout annuler
              </button>
            ) : null}
            {!isDefaultHours(draft) && !saving ? (
              <button
                type="button"
                className="nv-btn nv-btn--plain nv-btn--sm ps-pop"
                title="À toute heure, aucune relance de 23 h à 9 h, la nuit de 22 h à 7 h."
                onClick={() => {
                  edit(DEFAULT_AGENT_HOURS);
                }}
              >
                Revenir aux réglages d’origine
              </button>
            ) : null}
            <button
              type="button"
              className="nv-btn nv-btn--neon"
              disabled={!changed || blocked || saving}
              aria-busy={saving}
              onClick={() => void save()}
            >
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
        <div className="ps-head__state" aria-live="polite">
          <span className="ps-dot" data-dot={state.dot} />
          <span className="ps-head__text" key={state.text}>
            {state.text}
          </span>
        </div>
        <ZoneEditor
          creatorId={creatorId}
          timeZone={stored.timeZone}
          onMoved={(creator) => {
            // Her hours stay as they are, read on her new clock: the header and the warnings follow it.
            setStored((before) => ({ ...before, timeZone: creator.timezone }));
            queryClient.setQueryData<AgentHoursView>(hoursQueryKey(creatorId), (before) =>
              before === undefined ? before : { ...before, timeZone: creator.timezone },
            );
          }}
        />
        {problem?.expired === true ? <SignInAgain /> : null}
        {reauth ? (
          <PasswordPrompt
            lead="Pour changer ses heures, confirme ton mot de passe."
            onConfirmed={() => {
              setReauth(false);
              void save();
            }}
            onCancel={() => {
              setReauth(false);
            }}
          />
        ) : null}
      </div>

      <div className="nv-plate ps-panel">
        <section className="ps-block" aria-labelledby="hr-reply">
          <p className="nv-eyebrow" id="hr-reply">
            Réponses
          </p>
          <Segment
            label="Quand l’agent répond"
            options={[
              { value: 'always', label: 'À toute heure' },
              { value: 'slots', label: 'Par créneaux' },
            ]}
            value={draft.reply.mode}
            onChange={(mode) => {
              if (mode === draft.reply.mode) return;
              if (mode === 'always') edit({ ...draft, reply: { mode: 'always' } });
              else editSlots(slotsToOffer(keptSlots));
            }}
          />
          {slots === null ? (
            <p className="ps-lead">L’agent répond à toute heure, de jour comme de nuit.</p>
          ) : (
            <div className="ps-stack ps-reveal">
              {/* Said only in this mode: « À toute heure » has no slot to be out of (CREA-23). */}
              <p className="ps-lead">
                Hors de ses créneaux, l’agent n’écrit rien : les messages attendent, et il y répond à
                l’ouverture, le plus ancien d’abord. Un chatteur en poste répond dans Reveal, à toute heure.
              </p>
              <Week slots={slots} quiet={draft.followUpQuiet} />
              <ul className="hr-days" aria-label="Créneaux">
                {slotsByDay(slots).map(({ day, lines }) => (
                  <DayLine
                    key={day}
                    day={day}
                    lines={lines}
                    issues={issues}
                    added={canAddSlot(slots) ? newSlotOn(slots, day) : null}
                    full={noSlotWhy(slots, day)}
                    onUnreadable={times.onUnreadable}
                    canRemove={slots.length > 1}
                    onChange={(index, next) => {
                      editSlots(slots.map((one, i) => (i === index ? next : one)));
                    }}
                    onRemove={(index) => {
                      editSlots(slots.filter((_, i) => i !== index));
                    }}
                    onAdd={(slot) => {
                      editSlots([...slots, slot]);
                    }}
                  />
                ))}
              </ul>
              {issues.get('reply.slots') === undefined ? null : (
                <p className="ps-error" role="alert">
                  {issues.get('reply.slots')}
                </p>
              )}
              {canAddSlot(slots) ? null : <p className="ps-hint">{WEEK_FULL}</p>}
            </div>
          )}
        </section>

        <section className="ps-block" aria-labelledby="hr-quiet">
          <p className="nv-eyebrow" id="hr-quiet">
            Relances
          </p>
          <p className="ps-lead">
            Pendant ses heures calmes, personne ne reçoit de relance qu’il n’a pas demandée, même dans un
            créneau ouvert. Un fan qui écrit reçoit sa réponse ; une relance attend la première minute
            permise.
          </p>
          <RangeLine
            label="Heures calmes"
            range={draft.followUpQuiet}
            issue={rangeIssue(issues, 'followUpQuiet')}
            onUnreadable={times.onUnreadable}
            onChange={(followUpQuiet) => {
              edit({ ...draft, followUpQuiet });
            }}
          />
          {noFollowUp ? (
            <p className="hr-warning" role="status">
              Aucune relance ne pourra partir : chaque créneau tombe dans ses heures calmes.
            </p>
          ) : null}
        </section>

        <section className="ps-block" aria-labelledby="hr-night">
          <p className="nv-eyebrow" id="hr-night">
            Nuit
          </p>
          <p className="ps-lead">
            Ses scripts Nuit s’appliquent dans cette plage, ses scripts Jour le reste du temps.
          </p>
          <RangeLine
            label="Nuit"
            range={draft.night}
            issue={rangeIssue(issues, 'night')}
            onUnreadable={times.onUnreadable}
            onChange={(night) => {
              edit({ ...draft, night });
            }}
          />
        </section>
      </div>
      <SaveBar
        show={dirty && !headOnScreen}
        warn={blocked}
        text={state.text}
        saveLabel="Enregistrer"
        saving={saving}
        blocked={blocked ? 'Corrige d’abord les lignes signalées.' : null}
        onReset={undo}
        onSave={() => void save()}
      />
    </section>
  );
}

const pct = (minute: number): string => `${String((minute / MINUTES_PER_DAY) * 100)}%`;

/** Her week at a glance: a line a day, her slots on it, her quiet hours shaded. The list below says it in words. */
function Week({ slots, quiet }: { slots: readonly AgentSlot[]; quiet: MinuteRange }): JSX.Element {
  const bars = barsOf(slots);
  const quietParts =
    quiet.startMinute < quiet.endMinute
      ? [{ from: quiet.startMinute, to: quiet.endMinute }]
      : [
          { from: quiet.startMinute, to: MINUTES_PER_DAY },
          { from: 0, to: quiet.endMinute },
        ];
  return (
    <div className="hr-week" aria-hidden="true">
      {DAY_SHORT.map((name, dayIndex) => (
        <div className="hr-week__row" key={name}>
          <span className="hr-week__day">{name}</span>
          <span className="hr-week__track">
            {quietParts.map((part) => (
              <span
                key={part.from}
                className="hr-week__quiet"
                style={{ left: pct(part.from), width: pct(part.to - part.from) }}
              />
            ))}
            {bars
              .filter((bar) => bar.day === dayIndex + 1)
              .map((bar) => (
                <span
                  key={`${String(bar.index)}-${String(bar.continued)}`}
                  className="hr-week__bar"
                  data-off={bar.enabled ? undefined : 'true'}
                  data-continued={bar.continued ? 'true' : undefined}
                  style={{ left: pct(bar.from), width: pct(bar.to - bar.from) }}
                />
              ))}
          </span>
        </div>
      ))}
      <div className="hr-week__row hr-week__axis">
        <span className="hr-week__day" />
        <span className="hr-week__ticks nv-num">
          {[0, 6, 12, 18, 24].map((hour) => (
            <span key={hour} style={{ left: pct(hour * 60) }}>
              {`${String(hour)}\u00a0h`}
            </span>
          ))}
        </span>
      </div>
      <div className="nv-legend hr-week__legend">
        <span className="nv-legend__item">
          <span className="hr-week__key" />
          Créneau
        </span>
        <span className="nv-legend__item">
          <span className="hr-week__key" data-off="true" />
          Coupé
        </span>
        <span className="nv-legend__item">
          <span className="hr-week__key hr-week__key--quiet" />
          Heures calmes
        </span>
      </div>
    </div>
  );
}

/**
 * One day of her week (CREA-21): its name once, its slots side by side, and « Ajouter » for a slot more that day. A
 * slot never changes day here, so no line jumps away while she corrects it (CREA-22).
 */
function DayLine({
  day,
  lines,
  issues,
  added,
  full,
  canRemove,
  onChange,
  onUnreadable,
  onRemove,
  onAdd,
}: {
  day: number;
  lines: readonly { readonly slot: AgentSlot; readonly index: number }[];
  issues: ReadonlyMap<string, string>;
  /** The slot « Ajouter » would add that day, or null when the day has no free hour left (or the week is full). */
  added: AgentSlot | null;
  /** Why `added` is null, shown in the line: a disabled button alone says nothing. */
  full: string | null;
  /** False for the last slot of the week: « À toute heure » or the Arrêt say « never », not an empty list. */
  canRemove: boolean;
  onChange: (index: number, slot: AgentSlot) => void;
  /** Told when an hour typed in one of its slots does not read: the form then holds back its save. */
  onUnreadable: (field: string, unreadable: boolean) => void;
  onRemove: (index: number) => void;
  onAdd: (slot: AgentSlot) => void;
}): JSX.Element {
  const name = DAY_NAMES[day - 1] ?? '';
  return (
    <li className="hr-day" data-empty={lines.length === 0 ? 'true' : undefined}>
      <span className="hr-day__name">{name}</span>
      <div className="hr-day__slots">
        {lines.length === 0 ? <span className="ps-hint">Aucun créneau : l’agent n’écrit pas</span> : null}
        {lines.map(({ slot, index }) => (
          <SlotLine
            key={index}
            slot={slot}
            issue={slotIssue(issues, index)}
            onChange={(next) => {
              onChange(index, next);
            }}
            onUnreadable={onUnreadable}
            onRemove={
              canRemove
                ? () => {
                    onRemove(index);
                  }
                : null
            }
          />
        ))}
        {full === null ? null : <p className="ps-hint hr-day__full">{full}</p>}
      </div>
      <button
        type="button"
        className="nv-btn nv-btn--plain nv-btn--sm hr-day__add"
        disabled={added === null}
        aria-label={`Ajouter un créneau le ${name}`}
        onClick={() => {
          if (added !== null) onAdd(added);
        }}
      >
        <span aria-hidden="true">+</span> Ajouter
      </button>
    </li>
  );
}

function SlotLine({
  slot,
  issue,
  onChange,
  onUnreadable,
  onRemove,
}: {
  slot: AgentSlot;
  issue: string | null;
  onChange: (slot: AgentSlot) => void;
  onUnreadable: (field: string, unreadable: boolean) => void;
  /** Null for the last slot: « À toute heure » or the Arrêt say « never », not an empty list. */
  onRemove: (() => void) | null;
}): JSX.Element {
  const id = useId();
  const day = DAY_NAMES[slot.day - 1] ?? '';
  const name = `le créneau du ${day}, ${slotWords(slot)}`;
  const note = slotNote(slot);
  return (
    <div
      className="hr-slot"
      role="group"
      aria-label={`Créneau du ${day}, ${slotWords(slot)}`}
      data-off={slot.enabled ? undefined : 'true'}
      data-invalid={issue === null ? undefined : 'true'}
    >
      <div className="hr-slot__fields">
        <span className="hr-slot__hours">
          <TimeField
            className="hr-time"
            value={slot.startMinute}
            label={`Début du créneau du ${day}`}
            onChange={(startMinute) => {
              onChange({ ...slot, startMinute });
            }}
            onUnreadable={onUnreadable}
          />
          <span className="ps-hint">à</span>
          <TimeField
            className="hr-time"
            value={slot.endMinute}
            label={`Fin du créneau du ${day}`}
            onChange={(endMinute) => {
              onChange({ ...slot, endMinute });
            }}
            onUnreadable={onUnreadable}
          />
        </span>
        {/* The two hours say the rest: only what they do not, the next morning or the whole day. */}
        {note === null ? null : <span className="ps-hint hr-slot__words">{note}</span>}
        <span className="hr-slot__end">
          <label className="hr-slot__switch" htmlFor={id}>
            {slot.enabled ? null : <span className="ps-hint">Coupé</span>}
            <input
              id={id}
              type="checkbox"
              role="switch"
              className="nv-switch"
              checked={slot.enabled}
              aria-label={`Activer ${name}`}
              onChange={(event) => {
                onChange({ ...slot, enabled: event.target.checked });
              }}
            />
          </label>
          {onRemove === null ? null : (
            <button
              type="button"
              className="ps-entry__remove"
              aria-label={`Retirer ${name}`}
              onClick={onRemove}
            >
              ×
            </button>
          )}
        </span>
      </div>
      {issue === null ? null : <p className="ps-error">{issue}</p>}
    </div>
  );
}

function RangeLine({
  label,
  range,
  issue,
  onChange,
  onUnreadable,
}: {
  label: string;
  range: MinuteRange;
  issue: string | null;
  onChange: (range: MinuteRange) => void;
  onUnreadable: (field: string, unreadable: boolean) => void;
}): JSX.Element {
  const overnight = range.endMinute < range.startMinute;
  return (
    <div className="hr-range" data-invalid={issue === null ? undefined : 'true'}>
      <div className="hr-slot__fields">
        <span className="hr-range__label">{label}</span>
        <span className="hr-slot__hours">
          <span className="ps-hint">de</span>
          <TimeField
            className="hr-time"
            value={range.startMinute}
            label={`${label} : début`}
            onChange={(startMinute) => {
              onChange({ ...range, startMinute });
            }}
            onUnreadable={onUnreadable}
          />
          <span className="ps-hint">à</span>
          <TimeField
            className="hr-time"
            value={range.endMinute}
            label={`${label} : fin`}
            onChange={(endMinute) => {
              onChange({ ...range, endMinute });
            }}
            onUnreadable={onUnreadable}
          />
        </span>
        {issue === null ? (
          <span className="ps-hint hr-slot__words">
            {rangeOf(range)}
            {overnight ? ', jusqu’au lendemain' : ''}
          </span>
        ) : null}
      </div>
      {issue === null ? null : <p className="ps-error">{issue}</p>}
    </div>
  );
}
