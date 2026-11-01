import {
  SHIFT_MAX_MINUTES,
  SHIFT_TEMPLATE_MAX_MINUTES,
  shiftSlotsOf,
  templateLengthMinutes,
  type Planning,
  type ShiftSlot,
  type TeamMember,
} from '@nirvana/contracts';
import { useId, useState, type JSX } from 'react';

import { Dialog } from './Dialog';

import { TimeField, useUnreadableTimes } from '@/scheduling/TimeField';
import { createShift, createTemplate, useRefreshPlanning, type Refusal } from '@/scheduling/api';
import { accountLine, ERROR_MESSAGES, type Fill } from '@/scheduling/model';
import {
  addDays,
  cityOf,
  clockOf,
  inputOf,
  lengthOf,
  longDay,
  minuteOfInput,
  weekdayOf,
  zonedInstant,
} from '@/scheduling/time';

/** The day and slot the panel opens on: the first slot that starts after now, on `day` or else the day after. */
function firstSlotOf(
  day: string,
  today: string,
  slots: readonly ShiftSlot[],
  zone: string,
): { day: string; slot: number } {
  if (day !== today) return { day, slot: 0 };
  const at = Date.now();
  const slot = slots.findIndex((one) => zonedInstant(day, one.startMinute, zone).getTime() > at);
  return slot === -1 ? { day: addDays(day, 1), slot: 0 } : { day, slot };
}

/**
 * Where the panel opens: from « Ajouter un shift », from the + of one day on one account, from what is left of a
 * créneau with nobody (« À pourvoir », its hours at the agency's), or from « Pourvoir » on a shift a template could not
 * place because its member is on leave (its hours, and someone else than that member).
 */
export interface ShiftStart {
  readonly accountId: string | null;
  readonly day: string;
  readonly hours?: { readonly startMinute: number; readonly endMinute: number };
  readonly fill?: Fill;
}

/**
 * A new shift, or one that comes back every week (EQ-02): an account, a member who works on its creator, a day and
 * hours. The hours are the agency's (the grid's zone), as the templates are; the slots of Réglages come first, other
 * hours a tap away.
 */
export function ShiftPanel({
  planning,
  members,
  start,
  today,
  onClose,
  onShowShift,
}: {
  planning: Planning;
  /** `null` while the team is not read, or could not be. */
  members: readonly TeamMember[] | null;
  start: ShiftStart;
  today: string;
  onClose: () => void;
  /** A 409 names the shift in the way: the panel closes on it. */
  onShowShift: (shiftId: string) => void;
}): JSX.Element {
  const id = useId();
  const refresh = useRefreshPlanning();
  const zone = planning.settings.timeZone;
  const slots = shiftSlotsOf(planning.settings);
  const accounts = [...planning.accounts].sort(
    (a, b) => a.creatorName.localeCompare(b.creatorName, 'fr') || a.handle.localeCompare(b.handle, 'fr'),
  );
  const [accountId, setAccountId] = useState(start.accountId ?? accounts[0]?.id ?? '');
  const account = accounts.find((one) => one.id === accountId) ?? null;
  const fill = start.fill;
  const eligible = (members ?? [])
    .filter(
      (member) =>
        member.status === 'active' &&
        member.id !== fill?.awayMemberId &&
        account !== null &&
        member.creatorIds.includes(account.creatorId),
    )
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr'));
  const [memberId, setMemberId] = useState('');
  const chosen = eligible.find((member) => member.id === memberId) ?? eligible[0] ?? null;
  // The first slot still ahead: today's evening rather than a night already gone, else tomorrow's first. A stretch
  // to fill, or a shift to fill, keeps its own day and hours: one of the slots when they match, else the hours typed.
  const given = fill ?? start.hours;
  const [first] = useState(() =>
    given === undefined
      ? firstSlotOf(start.day < today ? today : start.day, today, slots, zone)
      : {
          day: fill?.day ?? start.day,
          slot: slots.findIndex(
            (one) => one.startMinute === given.startMinute && one.endMinute === given.endMinute,
          ),
        },
  );
  const [day, setDay] = useState(first.day);
  const [slot, setSlot] = useState<number | 'other'>(first.slot === -1 ? 'other' : first.slot);
  const [from, setFrom] = useState(inputOf(given?.startMinute ?? slots[first.slot]?.startMinute ?? 0));
  const [to, setTo] = useState(inputOf(given?.endMinute ?? slots[first.slot]?.endMinute ?? 360));
  const [weekly, setWeekly] = useState(false);
  const times = useUnreadableTimes();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  const picked = slot === 'other' ? null : (slots[slot] ?? null);
  const startMinute = picked === null ? minuteOfInput(from) : picked.startMinute;
  const endMinute = picked === null ? minuteOfInput(to) : picked.endMinute;
  // A field holding what is not an hour keeps the panel from saving: never another hour than the one on screen.
  const unreadable = picked === null && times.unreadable;
  const hoursOk = !unreadable && startMinute !== null && endMinute !== null && startMinute !== endMinute;
  const crosses = hoursOk && endMinute <= startMinute;
  const minutes = hoursOk ? templateLengthMinutes({ startMinute, endMinute }) : 0;
  // A template keeps an hour aside, so a change of time never stretches its shifts past a day (contracts).
  const tooLong = weekly && minutes > SHIFT_TEMPLATE_MAX_MINUTES;
  const hoursFit = hoursOk && !tooLong;
  const dayOk = /^\d{4}-\d{2}-\d{2}$/u.test(day) && day >= today;
  // A single shift lasts what its two instants span: 5 h for 0 h – 6 h the night the clocks go forward. A template
  // keeps its wall-clock hours, whatever the week.
  const lasts =
    hoursOk && dayOk && !weekly
      ? zonedInstant(crosses ? addDays(day, 1) : day, endMinute, zone).getTime() -
        zonedInstant(day, startMinute, zone).getTime()
      : minutes * 60_000;
  // The night the clocks go back, 2 h 30 – 2 h spans 24 h 30: more than a shift may last.
  const tooLongOnce = !weekly && lasts > SHIFT_MAX_MINUTES * 60_000;
  // No shift before the member's first day (the server reads it in their zone, the panel in the agency's).
  const notJoined = chosen !== null && dayOk && day < chosen.joinedOn;
  const ready =
    account !== null && chosen !== null && hoursFit && !tooLongOnce && dayOk && !notJoined && !busy;

  const submit = async (): Promise<void> => {
    if (!ready) return;
    setBusy(true);
    setRefusal(null);
    const outcome = weekly
      ? await createTemplate({
          creatorId: account.creatorId,
          platformAccountId: account.id,
          memberId: chosen.id,
          weekday: weekdayOf(day),
          startMinute,
          endMinute,
          validFrom: day,
        })
      : await createShift({
          creatorId: account.creatorId,
          platformAccountId: account.id,
          memberId: chosen.id,
          startsAt: zonedInstant(day, startMinute, zone).toISOString(),
          endsAt: zonedInstant(crosses ? addDays(day, 1) : day, endMinute, zone).toISOString(),
        });
    setBusy(false);
    if (outcome.kind === 'ok') {
      await refresh();
      onClose();
      return;
    }
    setRefusal(outcome);
  };

  return (
    <Dialog
      title={fill !== undefined ? 'Pourvoir un shift' : weekly ? 'Nouveau modèle de shift' : 'Nouveau shift'}
      lead={
        fill === undefined
          ? `À l’heure de l’agence (${cityOf(zone)}).`
          : `${fill.awayName} est en congé : choisis qui prend ce shift. À l’heure de l’agence (${cityOf(zone)}).`
      }
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
        <div className="nv-field tm-field">
          <label className="nv-field__label" htmlFor={`${id}-account`}>
            Compte
          </label>
          <select
            id={`${id}-account`}
            className="nv-field__control nv-glass tm-select"
            value={accountId}
            data-autofocus
            onChange={(event) => {
              setAccountId(event.target.value);
              setMemberId('');
            }}
          >
            {accounts.map((one) => (
              <option key={one.id} value={one.id}>
                {one.creatorName} · {accountLine(one)}
              </option>
            ))}
          </select>
        </div>

        <div className="nv-field tm-field" data-invalid={eligible.length === 0 ? 'true' : undefined}>
          <label className="nv-field__label" htmlFor={`${id}-member`}>
            Membre
          </label>
          <select
            id={`${id}-member`}
            className="nv-field__control nv-glass tm-select"
            value={chosen?.id ?? ''}
            disabled={eligible.length === 0}
            onChange={(event) => {
              setMemberId(event.target.value);
            }}
          >
            {eligible.map((member) => (
              <option key={member.id} value={member.id}>
                {member.displayName}
              </option>
            ))}
          </select>
          {members === null ? (
            <span className="tm-hint tm-hint--error">
              L’équipe n’a pas pu être lue. Réessaie dans un instant.
            </span>
          ) : eligible.length === 0 ? (
            <span className="tm-hint tm-hint--error">
              {fill === undefined ? 'Aucun membre actif' : 'Aucun autre membre actif'} ne travaille sur{' '}
              {account?.creatorName ?? 'cette créatrice'}.
            </span>
          ) : null}
        </div>

        <div className="nv-field tm-field" data-invalid={dayOk && !notJoined ? undefined : 'true'}>
          <label className="nv-field__label" htmlFor={`${id}-day`}>
            {weekly ? 'À partir du' : 'Jour'}
          </label>
          <input
            id={`${id}-day`}
            type="date"
            className="nv-field__control nv-glass tm-date"
            value={day}
            min={today}
            aria-invalid={!dayOk || notJoined}
            onChange={(event) => {
              setDay(event.target.value);
            }}
          />
          <span className={dayOk && !notJoined ? 'tm-hint' : 'tm-hint tm-hint--error'}>
            {!dayOk
              ? 'Un jour, aujourd’hui au plus tôt.'
              : notJoined
                ? `${chosen.displayName} arrive le ${longDay(chosen.joinedOn)} : un jour à partir de son arrivée.`
                : longDay(day).replace(/^./u, (letter) => letter.toUpperCase())}
          </span>
        </div>

        <fieldset className="sc-fieldset">
          <legend className="nv-field__label">Heures</legend>
          <div className="tm-choices" role="radiogroup" aria-label="Créneau">
            {slots.map((one, index) => (
              <button
                key={one.startMinute}
                type="button"
                role="radio"
                className="nv-chip nv-num"
                aria-checked={slot === index}
                onClick={() => {
                  setSlot(index);
                }}
              >
                {clockOf(one.startMinute)} – {clockOf(one.endMinute)}
              </button>
            ))}
            <button
              type="button"
              role="radio"
              className="nv-chip"
              aria-checked={slot === 'other'}
              onClick={() => {
                setSlot('other');
              }}
            >
              Autres heures
            </button>
          </div>
          {slot === 'other' ? (
            <div className="sc-hours nv-swap">
              <label className="sc-hours__one">
                <span className="tm-hint">De</span>
                <TimeField
                  value={minuteOfInput(from) ?? 0}
                  label="Début"
                  onChange={(minute) => {
                    setFrom(inputOf(minute));
                  }}
                  onUnreadable={times.onUnreadable}
                />
              </label>
              <label className="sc-hours__one">
                <span className="tm-hint">à</span>
                <TimeField
                  value={minuteOfInput(to) ?? 0}
                  label="Fin"
                  onChange={(minute) => {
                    setTo(inputOf(minute));
                  }}
                  onUnreadable={times.onUnreadable}
                />
              </label>
            </div>
          ) : null}
          <span className={hoursFit && !tooLongOnce ? 'tm-hint' : 'tm-hint tm-hint--error'}>
            {unreadable
              ? 'Une heure sur 24 heures : 22, 2230 ou 22:30.'
              : !hoursOk
                ? 'Un début et une fin différents.'
                : tooLong
                  ? 'Un modèle de shift dure 23 heures au plus.'
                  : tooLongOnce
                    ? `${lengthOf(lasts)} cette nuit-là, à cause du changement d’heure : un shift dure 24 h au plus.`
                    : // The hours and how long they last on one line (EQ-23): « 5 h – 11 h · 6 h ».
                      `${clockOf(startMinute)} – ${clockOf(endMinute)} · ${lengthOf(lasts)}${crosses ? ', jusqu’au lendemain' : ''}.`}
          </span>
        </fieldset>

        {/* A shift filled for someone on leave is that one occurrence: their template stays theirs. */}
        {/* Once or every week, a choice of two: no switch whose caption says the opposite of its title (EQ-23). */}
        {fill === undefined ? (
          <fieldset className="sc-fieldset">
            <legend className="nv-field__label">Fréquence</legend>
            <div className="tm-choices" role="radiogroup" aria-label="Fréquence">
              {([false, true] as const).map((every) => (
                <button
                  key={String(every)}
                  type="button"
                  role="radio"
                  className="nv-chip"
                  aria-checked={weekly === every}
                  onClick={() => {
                    setWeekly(every);
                  }}
                >
                  {every ? 'Chaque semaine' : 'Une fois'}
                </button>
              ))}
            </div>
            {weekly ? (
              <span className="tm-hint nv-swap">
                Chaque {longDay(day).split(' ')[0] ?? ''} à partir de ce jour, posé quatre semaines à
                l’avance.
              </span>
            ) : null}
          </fieldset>
        ) : null}

        {refusal === null ? null : (
          <div className="tm-warn sc-refusal nv-swap" role="alert">
            <p>
              {refusal.kind === 'failed'
                ? 'Le serveur ne répond pas : rien n’a changé. Réessaie dans un instant.'
                : ERROR_MESSAGES[refusal.code]}
            </p>
            {refusal.kind === 'refused' && refusal.shiftId !== null ? (
              <button
                type="button"
                className="nv-btn nv-btn--plain nv-btn--sm"
                onClick={() => {
                  if (refusal.shiftId !== null) onShowShift(refusal.shiftId);
                }}
              >
                Voir le shift gênant
              </button>
            ) : null}
          </div>
        )}

        <div className="tm-dialog__foot">
          <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="nv-btn nv-btn--neon" disabled={!ready} aria-busy={busy}>
            {busy ? 'Ajout…' : chosen === null ? 'Ajouter' : `Placer ${chosen.displayName}`}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
