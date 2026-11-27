import {
  NOT_TAKEN_DELAY_MINUTES_MAX,
  NOT_TAKEN_DELAY_MINUTES_MIN,
  type NotTakenDelay as Delay,
} from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type JSX } from 'react';

import {
  ALERTS_ERRORS,
  NOT_TAKEN_DELAY_QUERY_KEY,
  alertsErrorKind,
  saveNotTakenDelay,
  useNotTakenDelay,
} from './api';

import { Failure } from '@/shell/states';

/** « 15 » or « 1 h 30 »: minutes as the card says them. */
export function delayText(minutes: number): string {
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest).padStart(2, '0')}`;
}

/** A whole number of minutes within the contract's bounds, or `null`. */
export function parseDelay(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const minutes = Number(trimmed);
  return minutes < NOT_TAKEN_DELAY_MINUTES_MIN || minutes > NOT_TAKEN_DELAY_MINUTES_MAX ? null : minutes;
}

/**
 * « Chatteur pas là » (ADR 0094 § 1, lot b), in Réglages › Alertes: how long after a shift's start, never taken, the
 * owner and the managers are told. The agency sets it; until then nothing is sent (no threshold is written in the
 * code). One delay for the whole agency; per creator comes with the other thresholds.
 */
export function NotTakenDelay({ index }: { index: number }): JSX.Element {
  const delay = useNotTakenDelay();
  const queryClient = useQueryClient();
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minutes = delay.data?.minutes ?? null;
  const parsed = parseDelay(input);

  const save = async (next: Delay): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await saveNotTakenDelay(next);
      setEditing(false);
    } catch (reason) {
      setError(ALERTS_ERRORS[alertsErrorKind(reason)]);
    } finally {
      setBusy(false);
      await queryClient.invalidateQueries({ queryKey: NOT_TAKEN_DELAY_QUERY_KEY });
    }
  };

  return (
    <li
      className="nv-plate al-line al-system nv-enter"
      style={{ '--nv-i': index + 1 }}
      aria-labelledby={`${id}-title`}
      data-off={delay.data !== undefined && minutes === null && !editing ? 'true' : undefined}
    >
      <div className="al-line__top">
        <div className="al-line__text">
          <p id={`${id}-title`} className="al-line__name">
            Chatteur pas là
          </p>
          <p className="al-line__meta">
            {delay.data === undefined
              ? 'Pour toute l’agence'
              : minutes === null
                ? 'Pas encore réglée'
                : `${delayText(minutes)} après le début du shift, pour toute l’agence`}
          </p>
        </div>
        {delay.data === undefined || editing ? null : (
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm"
            onClick={() => {
              setInput(minutes === null ? '' : String(minutes));
              setTouched(false);
              setError(null);
              setEditing(true);
            }}
          >
            {minutes === null ? 'Régler' : 'Changer'}
          </button>
        )}
      </div>
      <p className="al-line__does">
        Un shift a commencé et son chatteur n’a pas pris son poste : le propriétaire et les managers sont
        prévenus, jamais un chatteur.
      </p>
      {delay.data === undefined ? (
        delay.isError ? (
          <Failure
            inline
            onRetry={() => {
              void delay.refetch();
            }}
          />
        ) : null
      ) : minutes === null && !editing ? (
        <p className="al-telegram" data-kind="missing">
          <span className="al-telegram__dot" aria-hidden="true" />
          <span>À régler : tant qu’aucun délai n’est choisi, rien ne part.</span>
        </p>
      ) : null}
      {editing ? (
        <form
          className="al-delay"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setTouched(true);
            if (parsed !== null) void save({ minutes: parsed });
          }}
        >
          <div className="nv-field" data-invalid={touched && parsed === null ? 'true' : undefined}>
            <label className="nv-field__label" htmlFor={`${id}-minutes`}>
              Délai après le début du shift
            </label>
            <div className="al-delay__row">
              <input
                id={`${id}-minutes`}
                className="nv-field__control nv-glass nv-num al-delay__input"
                inputMode="numeric"
                autoComplete="off"
                data-autofocus
                value={input}
                aria-invalid={touched && parsed === null}
                aria-describedby={`${id}-hint`}
                onChange={(event) => {
                  setInput(event.target.value);
                }}
              />
              min
            </div>
            <p id={`${id}-hint`} className={touched && parsed === null ? 'ps-error' : 'ps-muted'}>
              {touched && parsed === null
                ? `Un nombre de minutes entre ${String(NOT_TAKEN_DELAY_MINUTES_MIN)} et ${String(NOT_TAKEN_DELAY_MINUTES_MAX)}.`
                : `Entre ${String(NOT_TAKEN_DELAY_MINUTES_MIN)} et ${String(NOT_TAKEN_DELAY_MINUTES_MAX)} minutes. Un chatteur qui prend son poste avant ne déclenche rien.`}
            </p>
          </div>
          <div className="al-line__actions">
            <button type="submit" className="nv-btn nv-btn--neon nv-btn--sm" disabled={busy} aria-busy={busy}>
              {busy ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            {minutes === null ? null : (
              <button
                type="button"
                className="nv-btn nv-btn--plain nv-btn--sm"
                disabled={busy}
                onClick={() => void save({ minutes: null })}
              >
                Ne plus prévenir
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
