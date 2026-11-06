import { LEAVE_MAX_DAYS, LeaveRequestIdSchema, newId } from '@impera/contracts';
import { useId, useState, type JSX } from 'react';

import { DayField } from '@/scheduling/DayField';
import { useUnreadableTimes } from '@/scheduling/TimeField';
import { askLeave, useRefreshPlanning, type Refusal } from '@/scheduling/api';
import { ERROR_MESSAGES, leaveDaysLine, leaveLength, READ_AGAIN } from '@/scheduling/model';
import { cityOf, daysFrom } from '@/scheduling/time';
import { Dialog } from '@/shell/Dialog';

const DAY = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * « Demander un congé » (ADR 0031): whole days of the member's own zone, from today on, 31 at most, with a word for
 * the agency if they want. The request's id is made when the panel opens, so a retry records one request.
 */
export function LeavePanel({
  today,
  timeZone,
  onClose,
}: {
  /** Today in the member's zone: the first day it can start. */
  today: string;
  timeZone: string;
  onClose: () => void;
}): JSX.Element {
  const id = useId();
  const refresh = useRefreshPlanning();
  const [requestId] = useState(() => newId(LeaveRequestIdSchema));
  const [first, setFirst] = useState(today);
  // The last day follows the first until it is typed itself: a first day typed digit by digit (« 3/1 » on its way to
  // « 3/11 ») passes through days it does not mean, and none of them may stay in the last (relecture d'Équipe, #569).
  const [lastOwn, setLastOwn] = useState<string | null>(null);
  const last = lastOwn ?? first;
  // A day half typed is not yet a mistake: said in amber once its field is left, as the field marks itself.
  const [typing, setTyping] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  const { unreadable, onUnreadable } = useUnreadableTimes();
  const firstOk = DAY.test(first) && first >= today;
  const lastOk = DAY.test(last) && last >= first;
  const length = firstOk && lastOk ? daysFrom(first, last) + 1 : 0;
  const tooLong = length > LEAVE_MAX_DAYS;
  const ready = !unreadable && firstOk && lastOk && !tooLong && !busy;

  const submit = async (): Promise<void> => {
    if (!ready) return;
    setBusy(true);
    setRefusal(null);
    const outcome = await askLeave({ id: requestId, firstDay: first, lastDay: last, note });
    setBusy(false);
    if (outcome.kind === 'ok') {
      await refresh();
      onClose();
      return;
    }
    if (outcome.kind === 'refused' && READ_AGAIN.has(outcome.code)) await refresh();
    setRefusal(outcome);
  };

  return (
    <Dialog
      title="Demander un congé"
      lead={`Des jours entiers, à ton heure (${cityOf(timeZone)}). L’agence valide ou refuse.`}
      busy={busy}
      onClose={onClose}
    >
      <form
        className="tm-dialog__body"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div
          className="tm-pair"
          onFocus={() => {
            setTyping(true);
          }}
          onBlur={() => {
            setTyping(false);
          }}
        >
          <div className="nv-field tm-field" data-invalid={firstOk ? undefined : 'true'}>
            <label className="nv-field__label" htmlFor={`${id}-first`}>
              Premier jour
            </label>
            <DayField
              id={`${id}-first`}
              className="tm-date"
              value={first}
              today={today}
              autofocus
              invalid={!firstOk}
              onChange={setFirst}
              onUnreadable={(bad) => {
                onUnreadable('first', bad);
              }}
            />
          </div>
          <div className="nv-field tm-field" data-invalid={lastOk && !tooLong ? undefined : 'true'}>
            <label className="nv-field__label" htmlFor={`${id}-last`}>
              Dernier jour
            </label>
            <DayField
              id={`${id}-last`}
              className="tm-date"
              value={last}
              today={firstOk ? first : today}
              invalid={!lastOk || tooLong}
              onChange={setLastOwn}
              onUnreadable={(bad) => {
                onUnreadable('last', bad);
              }}
            />
          </div>
        </div>
        <p
          className={
            ready || busy || (unreadable && typing)
              ? 'tm-hint sc-leave__sum'
              : 'tm-hint tm-hint--error sc-leave__sum'
          }
        >
          {unreadable
            ? 'Des jours comme 28/03/2027, ou 28/3.'
            : !firstOk
              ? 'Un congé commence aujourd’hui au plus tôt.'
              : !lastOk
                ? 'Le dernier jour vient après le premier.'
                : tooLong
                  ? `Un congé dure ${String(LEAVE_MAX_DAYS)} jours au plus : demande-le en deux fois.`
                  : `${leaveDaysLine({ firstDay: first, lastDay: last })}, ${leaveLength({ firstDay: first, lastDay: last })}.`}
        </p>

        <div className="nv-field tm-field">
          <label className="nv-field__label" htmlFor={`${id}-note`}>
            Un mot pour l’agence <span className="sc-optional">facultatif</span>
          </label>
          <textarea
            id={`${id}-note`}
            className="nv-field__control nv-glass sc-note"
            rows={3}
            maxLength={500}
            value={note}
            placeholder="Examens, voyage, rendez-vous…"
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        </div>

        {refusal === null ? null : (
          <p className="tm-warn sc-refusal nv-swap" role="alert">
            {refusal.kind === 'failed'
              ? 'Le serveur ne répond pas : rien n’a été envoyé. Réessaie dans un instant.'
              : ERROR_MESSAGES[refusal.code]}
          </p>
        )}

        <div className="tm-dialog__foot">
          <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="nv-btn nv-btn--neon" disabled={!ready} aria-busy={busy}>
            {busy ? 'Envoi…' : 'Envoyer la demande'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
