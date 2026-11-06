import { SUGGESTION_PAST_UNPROCESSABLE, type CreatorSuggestion } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type JSX, type SyntheticEvent } from 'react';

import { acceptSuggestion, AGENDA_KEY, declineSuggestion, NOT_SENT } from './api';
import { firstMoment, spanOf } from './draft';

import { DayField } from '@/scheduling/DayField';
import { TimeField, useUnreadableTimes } from '@/scheduling/TimeField';
import { addDays, clockOf, dayOf, longDay, minuteOf, weekOf } from '@/scheduling/time';
import { Dialog } from '@/shell/Dialog';
import '@/screens/team/team.css';

const REFUSED = 'Cette proposition n’est plus là. Ton agenda est relu.';
const PAST = 'Ce moment est déjà passé : choisis-en un à venir.';

/** « Non merci », with a reason if she likes: the agency reads it, and does not suggest it again next week. */
export function DeclineDialog({
  suggestion,
  onClose,
  onNotice,
}: {
  suggestion: CreatorSuggestion;
  onClose: () => void;
  onNotice: (notice: string) => void;
}): JSX.Element {
  const id = useId();
  const client = useQueryClient();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    setBusy(true);
    const trimmed = reason.trim();
    void declineSuggestion(suggestion.id, trimmed === '' ? {} : { reason: trimmed }).then(async (outcome) => {
      setBusy(false);
      if (outcome.kind === 'offline' || outcome.kind === 'failed') {
        setFailed(NOT_SENT[outcome.kind]);
        return;
      }
      await client.invalidateQueries({ queryKey: AGENDA_KEY });
      if (outcome.kind === 'refused' && !outcome.code.endsWith('_conflict')) onNotice(REFUSED);
      onClose();
    });
  };
  return (
    <Dialog title="Non merci" lead={suggestion.title} busy={busy} onClose={onClose}>
      <form className="tm-dialog__body" noValidate onSubmit={submit}>
        <div className="nv-field tm-field">
          <label className="nv-field__label" htmlFor={`${id}-reason`}>
            Pourquoi ? <span className="ag-optional">facultatif</span>
          </label>
          <textarea
            id={`${id}-reason`}
            className="nv-field__control nv-glass"
            rows={2}
            maxLength={200}
            value={reason}
            data-autofocus
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
          <p className="tm-hint">L’agence le lit, et ne te la reproposera pas la semaine prochaine.</p>
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
          <button type="submit" className="nv-btn nv-btn--neon" disabled={busy} aria-busy={busy}>
            Non merci
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** A suggestion that found no room in her dispos: she picks the day and the hour, its length stays. */
export function PlaceDialog({
  zone,
  suggestion,
  onClose,
  onNotice,
}: {
  zone: string;
  suggestion: CreatorSuggestion;
  onClose: () => void;
  onNotice: (notice: string) => void;
}): JSX.Element {
  const id = useId();
  const client = useQueryClient();
  const [opened] = useState(() => new Date());
  const today = dayOf(opened, zone);
  const first = firstMoment(weekOf(suggestion.week), today, minuteOf(opened, zone));
  const minutes = suggestion.minutes ?? 60;
  const [day, setDay] = useState(first.day);
  const [start, setStart] = useState(first.start);
  const { unreadable, onUnreadable } = useUnreadableTimes();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const end = (start + minutes) % 1440;
  // The suggestion's week, from today on: what the day field's own calendar held it to.
  const lowest = today > suggestion.week ? today : suggestion.week;
  const highest = addDays(suggestion.week, 6);
  const dayOk = day >= lowest && day <= highest;
  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    if (unreadable || !dayOk) return;
    setBusy(true);
    setFailed(null);
    void acceptSuggestion(suggestion.id, { when: { kind: 'timed', ...spanOf(day, start, end, zone) } }).then(
      async (outcome) => {
        setBusy(false);
        if (outcome.kind === 'offline' || outcome.kind === 'failed') {
          setFailed(NOT_SENT[outcome.kind]);
          return;
        }
        if (outcome.kind === 'refused' && outcome.code === SUGGESTION_PAST_UNPROCESSABLE) {
          setFailed(PAST);
          return;
        }
        await client.invalidateQueries({ queryKey: AGENDA_KEY });
        if (outcome.kind === 'refused' && !outcome.code.endsWith('_conflict')) onNotice(REFUSED);
        onClose();
      },
    );
  };
  return (
    <Dialog title="Choisir un moment" lead={suggestion.title} busy={busy} onClose={onClose}>
      <form className="tm-dialog__body" noValidate onSubmit={submit}>
        <div className="nv-field tm-field">
          <label className="nv-field__label" htmlFor={`${id}-day`}>
            Jour
          </label>
          <DayField
            id={`${id}-day`}
            className="tm-date"
            value={day}
            today={lowest}
            autofocus
            invalid={!dayOk}
            describedBy={`${id}-day-hint`}
            onChange={setDay}
            onUnreadable={(bad) => {
              onUnreadable('day', bad);
            }}
          />
          <p id={`${id}-day-hint`} className={dayOk ? 'tm-hint' : 'tm-hint tm-hint--error'}>
            Du {longDay(lowest)} au {longDay(highest)}.
          </p>
        </div>
        <div className="nv-field tm-field">
          <span className="nv-field__label">Début</span>
          <TimeField value={start} label="Début" onChange={setStart} onUnreadable={onUnreadable} />
          <p className="tm-hint nv-num">
            Jusqu’à {clockOf(end)}
            {end <= start ? ' le lendemain' : ''}.
          </p>
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
            disabled={busy || unreadable || !dayOk}
            aria-busy={busy}
          >
            Accepter
          </button>
        </div>
      </form>
    </Dialog>
  );
}
