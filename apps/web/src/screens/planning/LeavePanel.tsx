import { LEAVE_MAX_DAYS, LeaveRequestIdSchema, newId } from '@nirvana/contracts';
import { useId, useState, type JSX } from 'react';

import { askLeave, useRefreshPlanning, type Refusal } from '@/scheduling/api';
import { ERROR_MESSAGES, leaveDaysLine, leaveLength, READ_AGAIN } from '@/scheduling/model';
import { cityOf, daysFrom } from '@/scheduling/time';
import { Dialog } from '@/screens/team/Dialog';

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
  const [last, setLast] = useState(today);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  const firstOk = DAY.test(first) && first >= today;
  const lastOk = DAY.test(last) && last >= first;
  const length = firstOk && lastOk ? daysFrom(first, last) + 1 : 0;
  const tooLong = length > LEAVE_MAX_DAYS;
  const ready = firstOk && lastOk && !tooLong && !busy;

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
        <div className="tm-pair">
          <div className="nv-field tm-field" data-invalid={firstOk ? undefined : 'true'}>
            <label className="nv-field__label" htmlFor={`${id}-first`}>
              Premier jour
            </label>
            <input
              id={`${id}-first`}
              type="date"
              className="nv-field__control nv-glass tm-date"
              value={first}
              min={today}
              data-autofocus
              aria-invalid={!firstOk}
              onChange={(event) => {
                const next = event.target.value;
                setFirst(next);
                // The last day follows a first day moved past it: one gesture for a single day.
                if (DAY.test(next) && next > last) setLast(next);
              }}
            />
          </div>
          <div className="nv-field tm-field" data-invalid={lastOk && !tooLong ? undefined : 'true'}>
            <label className="nv-field__label" htmlFor={`${id}-last`}>
              Dernier jour
            </label>
            <input
              id={`${id}-last`}
              type="date"
              className="nv-field__control nv-glass tm-date"
              value={last}
              min={firstOk ? first : today}
              aria-invalid={!lastOk || tooLong}
              onChange={(event) => {
                setLast(event.target.value);
              }}
            />
          </div>
        </div>
        <p className={ready || busy ? 'tm-hint sc-leave__sum' : 'tm-hint tm-hint--error sc-leave__sum'}>
          {!firstOk
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
