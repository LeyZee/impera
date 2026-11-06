import { CREATOR_TASK_CATEGORY_LABELS, type AgencySuggestion, type CreatorId } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type JSX, type SyntheticEvent } from 'react';

import { suggestionsKey, SUGGEST_ERRORS, suggestTask, useAgencySuggestions } from './api';
import {
  askedWhen,
  followedOf,
  groupsOf,
  newSuggestionId,
  suggestionBodyOf,
  summaryOf,
  type Followed,
} from './model';
import './agency-agenda.css';

import { useUnreadableTimes } from '@/scheduling/TimeField';
import { addDays, cityOf, dayOf, mondayOf, readerZone, weekdayOf, weekLabel } from '@/scheduling/time';
import {
  AgendaDay,
  Categories,
  Choices,
  draftWhen,
  Hours,
  Preview,
  TASK_KINDS,
  Weekdays,
} from '@/screens/agenda/AddDialog';
import { CategoryMark } from '@/screens/agenda/category';
import { taskProblems, type TaskDraft } from '@/screens/agenda/draft';
import { Dialog } from '@/shell/Dialog';
import '@/screens/agenda/agenda.css';
import '@/screens/team/team.css';

/**
 * Créatrices › Agenda (CR-05 lot c, ADR 0042 § 4), the owner's and an active manager's: propose a task for her agenda,
 * with or without an hour, and see what she did of each one of a week (still to decide, accepted, done, declined). She
 * reads « Proposé par l'agence » and never who; the agency reads where each one came from. Typed in her zone.
 */
export function AgendaSection({
  creatorId,
  creatorName,
  timezone,
}: {
  creatorId: CreatorId;
  creatorName: string;
  timezone: string;
}): JSX.Element {
  const today = dayOf(new Date(), timezone);
  const thisWeek = mondayOf(today);
  const [week, setWeek] = useState(thisWeek);
  const [proposing, setProposing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const query = useAgencySuggestions(creatorId, week);

  const list = (): JSX.Element => {
    if (query.data === undefined) {
      if (query.isError)
        return (
          <div className="nv-plate aa-empty">
            <p className="ps-title">Ses propositions ne se chargent pas</p>
            <p className="ps-muted">Le serveur ne répond pas. Réessaie dans un instant.</p>
            <button
              type="button"
              className="nv-btn nv-btn--soft ps-self-start"
              onClick={() => void query.refetch()}
            >
              Réessayer
            </button>
          </div>
        );
      return <div className="nv-plate ps-panel ps-skeleton ps-skeleton--tall" aria-busy="true" />;
    }
    const items = query.data.items;
    if (items.length === 0)
      return (
        <div className="nv-plate aa-empty">
          <p className="aa-empty__title">Rien de proposé pour cette semaine</p>
          <p className="ps-muted">
            Une proposition à une heure tombe dans une de ses dispos ; sans place, elle la met elle-même dans
            sa semaine.
          </p>
        </div>
      );
    const groups = groupsOf(items);
    return (
      <>
        <p className="aa-summary nv-num">{summaryOf(items, timezone)}</p>
        <Group title="En attente de sa réponse" items={groups.waiting} zone={timezone} />
        <Group title="Acceptées" items={groups.accepted} zone={timezone} />
        <Group title="Refusées" items={groups.declined} zone={timezone} />
      </>
    );
  };

  return (
    <section className="ps-page ag-scope aa-page" aria-label={`Agenda de ${creatorName}`}>
      <div className="nv-plate ps-head">
        <div className="ps-head__top">
          <div className="ps-head__who">
            <p className="ps-title">Son agenda</p>
            <p className="ps-muted">
              Ce que l’agence propose à {creatorName}. Elle accepte, place ou refuse ; elle lit « Proposé par
              l’agence », jamais qui.
            </p>
          </div>
          <button
            type="button"
            className="nv-btn nv-btn--neon nv-btn--sm"
            onClick={() => {
              setNotice(null);
              setProposing(true);
            }}
          >
            Proposer une tâche
          </button>
        </div>
        <div className="aa-week" role="group" aria-label="Semaine">
          <button
            type="button"
            className="nv-btn nv-btn--plain nv-btn--sm"
            aria-label="Semaine précédente"
            onClick={() => {
              setWeek(addDays(week, -7));
            }}
          >
            ‹
          </button>
          <span className="aa-week__label nv-num" aria-live="polite">
            {week === thisWeek ? 'Cette semaine · ' : ''}
            {weekLabel(week)}
          </span>
          <button
            type="button"
            className="nv-btn nv-btn--plain nv-btn--sm"
            aria-label="Semaine suivante"
            onClick={() => {
              setWeek(addDays(week, 7));
            }}
          >
            ›
          </button>
          {week === thisWeek ? null : (
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm"
              onClick={() => {
                setWeek(thisWeek);
              }}
            >
              Cette semaine
            </button>
          )}
        </div>
      </div>
      {notice === null ? null : (
        <p className="nv-plate aa-notice" role="status">
          {notice}
        </p>
      )}
      {list()}
      {proposing ? (
        <ProposeDialog
          creatorId={creatorId}
          creatorName={creatorName}
          zone={timezone}
          day={week === thisWeek ? today : week}
          onClose={() => {
            setProposing(false);
          }}
          onProposed={(suggestion) => {
            setProposing(false);
            const asked = askedWhen(suggestion, timezone);
            setNotice(
              suggestion.when === null
                ? `Proposée sans heure : pas de place libre dans ses dispos à ce moment. Elle la placera elle-même dans sa semaine.`
                : `Proposée : elle la voit dans son agenda, ${asked.charAt(0).toLowerCase()}${asked.slice(1)}.`,
            );
            setWeek(suggestion.week);
          }}
        />
      ) : null}
    </section>
  );
}

function Group({
  title,
  items,
  zone,
}: {
  title: string;
  items: readonly AgencySuggestion[];
  zone: string;
}): JSX.Element | null {
  const id = useId();
  if (items.length === 0) return null;
  return (
    <section className="aa-group" aria-labelledby={id}>
      <h3 className="aa-group__title" id={id}>
        {title} <span className="nv-num">{items.length}</span>
      </h3>
      <ul className="aa-list">
        {items.map((suggestion) => (
          <Row
            key={suggestion.id}
            suggestion={suggestion}
            followed={followedOf(suggestion, zone)}
            zone={zone}
          />
        ))}
      </ul>
    </section>
  );
}

function Row({
  suggestion,
  followed,
  zone,
}: {
  suggestion: AgencySuggestion;
  followed: Followed;
  zone: string;
}): JSX.Element {
  return (
    <li className="nv-plate aa-row" data-standing={followed.standing}>
      <CategoryMark category={suggestion.category} />
      <div className="aa-row__text">
        <b className="aa-row__title">
          {suggestion.title}
          {suggestion.essential ? <span className="ag-ess">essentielle</span> : null}
        </b>
        <span className="aa-row__meta">
          {CREATOR_TASK_CATEGORY_LABELS[suggestion.category]} ·{' '}
          <span className="nv-num">{askedWhen(suggestion, zone)}</span>
          {suggestion.origin === 'ai' ? ' · Idée de l’IA' : null}
        </span>
        {suggestion.purpose === null ? null : <span className="aa-row__purpose">{suggestion.purpose}</span>}
        {followed.detail === null ? null : <span className="aa-row__detail nv-num">{followed.detail}</span>}
      </div>
      <span className="aa-pill" data-standing={followed.standing}>
        {followed.standing === 'done' ? <span aria-hidden="true">✓ </span> : null}
        {followed.label}
      </span>
    </li>
  );
}

/**
 * « Proposer une tâche »: what, its category, when (at an hour, a day, every week), what it is for. At an hour, it
 * falls there only inside one of her dispos and over none of her tasks; otherwise she places it herself. The hours
 * are hers: when the reader is elsewhere, the form says whose clock it is.
 */
function ProposeDialog({
  creatorId,
  creatorName,
  zone,
  day,
  onClose,
  onProposed,
}: {
  creatorId: CreatorId;
  creatorName: string;
  zone: string;
  day: string;
  onClose: () => void;
  onProposed: (suggestion: AgencySuggestion) => void;
}): JSX.Element {
  const id = useId();
  const client = useQueryClient();
  const [draft, setDraft] = useState<TaskDraft>({
    title: '',
    category: 'shoot',
    kind: 'timed',
    day,
    start: 18 * 60,
    end: 19 * 60,
    weekdays: [weekdayOf(day)],
    purpose: '',
    reminderMinutes: null,
  });
  const [suggestionId] = useState(newSuggestionId);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const { unreadable, onUnreadable } = useUnreadableTimes();
  const problems = taskProblems(draft);
  const elsewhere = readerZone() !== zone;
  const set = (patch: Partial<TaskDraft>): void => {
    setDraft((before) => ({ ...before, ...patch }));
  };
  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    setTried(true);
    if (problems.length > 0 || unreadable) return;
    setBusy(true);
    setFailed(null);
    void suggestTask(creatorId, suggestionBodyOf(draft, zone, suggestionId)).then(async (outcome) => {
      setBusy(false);
      if (outcome.kind !== 'ok') {
        setFailed(SUGGEST_ERRORS[outcome.kind]);
        return;
      }
      await client.invalidateQueries({ queryKey: suggestionsKey(creatorId, outcome.suggestion.week) });
      onProposed(outcome.suggestion);
    });
  };
  return (
    <Dialog title={`Proposer à ${creatorName}`} className="ag-scope" onClose={onClose}>
      <form className="tm-dialog__body" noValidate onSubmit={submit}>
        <Preview
          mark={<CategoryMark category={draft.category} size="lg" />}
          title={draft.title.trim()}
          when={draftWhen(draft, zone)}
          placeholder="La tâche"
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
            onChange={(next) => {
              set({ day: next });
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
            <p className="ag-explain">
              {elsewhere ? `Heure de ${cityOf(zone)}, la sienne. ` : ''}
              Elle tombe à cette heure seulement dans une de ses dispos et sans chevaucher une tâche ; sinon,
              elle la place elle-même dans sa semaine.
            </p>
          </>
        ) : draft.kind === 'routine' ? (
          <p className="ag-explain">
            Acceptée, elle entre dans sa routine comme <span className="ag-ess">essentielle</span> : elle
            compte pour sa série.
          </p>
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
            placeholder="Une phrase, sans chiffre inventé"
            onChange={(event) => {
              set({ purpose: event.target.value });
            }}
          />
        </div>
        {failed === null ? null : (
          <p className="tm-hint tm-hint--error" role="alert">
            {failed}
          </p>
        )}
        <div className="tm-dialog__foot">
          <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onClose}>
            Annuler
          </button>
          <button
            type="submit"
            className="nv-btn nv-btn--neon"
            disabled={busy || unreadable}
            aria-busy={busy}
          >
            Proposer
          </button>
        </div>
      </form>
    </Dialog>
  );
}
