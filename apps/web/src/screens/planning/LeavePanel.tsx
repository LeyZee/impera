import { LEAVE_MAX_DAYS, LeaveRequestIdSchema, newId, type Shift } from '@impera/contracts';
import { useId, useState, type JSX } from 'react';

import { DayField, NO_SUCH_DAY } from '@/scheduling/DayField';
import { useUnreadableTimes } from '@/scheduling/TimeField';
import { askLeave, usePlanning, useRefreshPlanning, type Refusal } from '@/scheduling/api';
import {
  ERROR_MESSAGES,
  leaveDaysLine,
  leaveLength,
  phaseOf,
  READ_AGAIN,
  swapShiftLine,
} from '@/scheduling/model';
import { addDays, cityOf, daysFrom, zonedInstant } from '@/scheduling/time';
import { useNow } from '@/scheduling/useNow';
import { Dialog } from '@/shell/Dialog';

const DAY = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * « Demander un congé » (ADR 0031): whole days of the member's own zone, from today on, 31 at most, with a word for
 * the agency if they want. The request's id is made when the panel opens, so a retry records one request. His shifts
 * on those days are said in amber before he sends it, each one ahead offered to a colleague from there (recette 05/11,
 * CHAT-28): a leave approved later does not free them by itself.
 */
export function LeavePanel({
  today,
  timeZone,
  memberId,
  onSwap,
  onClose,
}: {
  /** Today in the member's zone: the first day it can start. */
  today: string;
  timeZone: string;
  memberId: string;
  /** « Échanger » on one of his shifts of those days: the leave closes, the exchange opens. */
  onSwap: (shift: Shift, creatorName: string | undefined) => void;
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

  const { unreadable, isUnreadable, onUnreadable } = useUnreadableTimes();
  // Written as a day the calendar has not (« 31/02 »): said so, not how to write one.
  const [noSuch, setNoSuch] = useState<ReadonlySet<string>>(() => new Set());
  const told = (field: 'first' | 'last') => (bad: boolean, noSuchDay: boolean) => {
    onUnreadable(field, bad);
    setNoSuch((before) => {
      if (before.has(field) === noSuchDay) return before;
      const after = new Set(before);
      if (noSuchDay) after.add(field);
      else after.delete(field);
      return after;
    });
  };
  // A day that cannot be read is said under its own field, once left (relecture des captures, #575).
  const fault = (field: 'first' | 'last'): string | null =>
    typing || !isUnreadable(field)
      ? null
      : noSuch.has(field)
        ? NO_SUCH_DAY
        : 'Un jour comme 28/03/2027, ou 28/3.';
  const firstFault = fault('first');
  const lastFault = fault('last');
  const firstOk = DAY.test(first) && first >= today;
  const lastOk = DAY.test(last) && last >= first;
  const length = firstOk && lastOk ? daysFrom(first, last) + 1 : 0;
  const tooLong = length > LEAVE_MAX_DAYS;
  const ready = !unreadable && firstOk && lastOk && !tooLong && !busy;
  const now = useNow();
  // His shifts on the days asked: the planning reads 42 days at most, a leave 31.
  const planning = usePlanning(
    {
      from: zonedInstant(firstOk ? first : today, 0, timeZone).toISOString(),
      to: zonedInstant(addDays(firstOk && lastOk && !tooLong ? last : today, 1), 0, timeZone).toISOString(),
      creatorId: null,
    },
    firstOk && lastOk && !tooLong,
  );
  const clashes =
    // While the new days are read, the previous answer is another range's: nothing shown rather than wrong shifts.
    !firstOk || !lastOk || tooLong || planning.isPlaceholderData
      ? []
      : (planning.data?.shifts ?? [])
          .filter((shift) => shift.memberId === memberId && phaseOf(shift, now) !== 'past')
          .toSorted((a, b) => a.startsAt.localeCompare(b.startsAt));
  const creatorOf = (shift: Shift): string | undefined =>
    planning.data?.accounts.find((account) => account.id === shift.platformAccountId)?.creatorName;

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
              value={first}
              today={today}
              autofocus
              invalid={!firstOk}
              describedBy={firstFault === null ? undefined : `${id}-first-fault`}
              onChange={setFirst}
              onUnreadable={told('first')}
            />
            {firstFault === null ? null : (
              <p id={`${id}-first-fault`} className="tm-hint tm-hint--error">
                {firstFault}
              </p>
            )}
          </div>
          <div className="nv-field tm-field" data-invalid={lastOk && !tooLong ? undefined : 'true'}>
            <label className="nv-field__label" htmlFor={`${id}-last`}>
              Dernier jour
            </label>
            <DayField
              id={`${id}-last`}
              value={last}
              today={firstOk ? first : today}
              invalid={!lastOk || tooLong}
              describedBy={lastFault === null ? undefined : `${id}-last-fault`}
              onChange={setLastOwn}
              onUnreadable={told('last')}
            />
            {lastFault === null ? null : (
              <p id={`${id}-last-fault`} className="tm-hint tm-hint--error">
                {lastFault}
              </p>
            )}
          </div>
        </div>
        {/* Once a day that cannot be read is left, its own field says it: the line of the leave steps aside. */}
        {unreadable && !typing ? null : (
          <p
            className={
              ready || busy || unreadable ? 'tm-hint sc-leave__sum' : 'tm-hint tm-hint--error sc-leave__sum'
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
        )}

        {clashes.length === 0 ? null : (
          <div className="sc-leave__clash nv-swap" role="status">
            <p className="sc-leave__clash-head">
              {clashes.length === 1
                ? 'Tu as un shift ces jours-là : propose-le d’abord en échange.'
                : `Tu as ${String(clashes.length)} shifts ces jours-là : propose-les d’abord en échange.`}
            </p>
            <ul className="sc-leave__clash-list">
              {clashes.map((shift) => (
                <li key={shift.id}>
                  <span className="nv-num">
                    {swapShiftLine(shift.startsAt, shift.endsAt, creatorOf(shift), timeZone)}
                  </span>
                  {phaseOf(shift, now) === 'later' ? (
                    <button
                      type="button"
                      className="sc-link"
                      onClick={() => {
                        onSwap(shift, creatorOf(shift));
                      }}
                    >
                      Échanger
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        )}

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
