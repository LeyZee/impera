import { SESSION_REMINDER_MINUTE_DEFAULT, type SessionReminder as Reminder } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type JSX } from 'react';

import {
  ALERTS_ERRORS,
  SESSION_REMINDER_QUERY_KEY,
  alertsErrorKind,
  saveSessionReminder,
  useSessionReminder,
} from './api';

import { Failure } from '@/shell/states';

/** « 18 h » or « 18 h 30 »: a minute of the day as the card says it. */
export function clockText(minute: number): string {
  const hours = String(Math.floor(minute / 60));
  const rest = minute % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')}`;
}

/** « 18 », « 18h », « 18 h 30 », « 18:30 » or « 18.30 »: a minute of the day, or `null`. */
export function parseClock(input: string): number | null {
  const match = /^(\d{1,2})\s*(?:(?:h|:|\.)\s*(\d{2})?)?$/iu.exec(input.trim());
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  return hours > 23 || minutes > 59 ? null : hours * 60 + minutes;
}

/**
 * The daily reminder to reconnect the AI's sessions (décision de Charles du 27/11/2026), in Réglages › Alertes ›
 * Pilotage: the hour of the agency's day when every owner is told to reconnect the bot on Reveal. 18 h by default,
 * never off: the token dies 24 h after the login.
 */
export function SessionReminder({ index }: { index: number }): JSX.Element {
  const reminder = useSessionReminder();
  const queryClient = useQueryClient();
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minute = reminder.data?.minute ?? null;
  const parsed = parseClock(input);

  const save = async (next: Reminder): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await saveSessionReminder(next);
      setEditing(false);
    } catch (reason) {
      setError(ALERTS_ERRORS[alertsErrorKind(reason)]);
    } finally {
      setBusy(false);
      await queryClient.invalidateQueries({ queryKey: SESSION_REMINDER_QUERY_KEY });
    }
  };

  return (
    <li
      className="nv-plate al-line al-system nv-enter"
      style={{ '--nv-i': index + 1 }}
      aria-labelledby={`${id}-title`}
    >
      <div className="al-line__top">
        <div className="al-line__text">
          <p id={`${id}-title`} className="al-line__name">
            Reconnexion Reveal
          </p>
          {minute === null ? null : (
            <p className="al-line__meta">{`Chaque jour à ${clockText(minute)}, heure de l’agence`}</p>
          )}
        </div>
        {reminder.data === undefined || editing ? null : (
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm"
            onClick={() => {
              setInput(minute === null ? '' : clockText(minute));
              setTouched(false);
              setError(null);
              setEditing(true);
            }}
          >
            Changer
          </button>
        )}
      </div>
      <p className="al-line__does">
        Le jeton Reveal de l’IA ne dure que 24 h. À cette heure, chaque propriétaire est prévenu de
        reconnecter le « bot », encore une heure après si rien n’a bougé, et 2 h avant la fin d’un jeton.
      </p>
      {reminder.data === undefined && reminder.isError ? (
        <Failure
          inline
          onRetry={() => {
            void reminder.refetch();
          }}
        />
      ) : null}
      {editing ? (
        <form
          className="al-delay"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setTouched(true);
            if (parsed !== null) void save({ minute: parsed });
          }}
        >
          <div className="nv-field" data-invalid={touched && parsed === null ? 'true' : undefined}>
            <label className="nv-field__label" htmlFor={`${id}-clock`}>
              Heure du rappel
            </label>
            <div className="al-delay__row">
              <input
                id={`${id}-clock`}
                className="nv-field__control nv-glass nv-num al-delay__input"
                inputMode="text"
                autoComplete="off"
                data-autofocus
                value={input}
                aria-invalid={touched && parsed === null}
                aria-describedby={`${id}-hint`}
                onChange={(event) => {
                  setInput(event.target.value);
                }}
              />
            </div>
            <p id={`${id}-hint`} className={touched && parsed === null ? 'ps-error' : 'ps-muted'}>
              {touched && parsed === null
                ? 'Une heure de la journée, par exemple 18 h ou 18 h 30.'
                : 'Avant le pic du soir : le jeton tient jusqu’à la même heure le lendemain. Pendant tes heures calmes, le rappel attend le matin.'}
            </p>
          </div>
          <div className="al-line__actions">
            <button type="submit" className="nv-btn nv-btn--neon nv-btn--sm" disabled={busy} aria-busy={busy}>
              {busy ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            {minute === SESSION_REMINDER_MINUTE_DEFAULT ? null : (
              <button
                type="button"
                className="nv-btn nv-btn--plain nv-btn--sm"
                disabled={busy}
                onClick={() => void save({ minute: SESSION_REMINDER_MINUTE_DEFAULT })}
              >
                Revenir à 18 h
              </button>
            )}
            <button
              type="button"
              className="nv-btn nv-btn--plain nv-btn--sm"
              disabled={busy}
              onClick={() => {
                setEditing(false);
              }}
            >
              Annuler
            </button>
          </div>
        </form>
      ) : null}
      {error === null ? null : (
        <p className="ps-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
