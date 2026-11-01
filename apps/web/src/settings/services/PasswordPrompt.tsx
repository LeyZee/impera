import { useEffect, useId, useRef, useState, type JSX } from 'react';

import { confirmPassword, type ConfirmResult } from './api';
import './services.css';

const MESSAGES: Record<Exclude<ConfirmResult, 'ok'>, string> = {
  wrong_credentials: 'Ce n’est pas le bon mot de passe.',
  too_many_attempts: 'Trop d’essais. Attends une minute avant de réessayer.',
  unavailable: 'Le serveur ne répond pas. Réessaie dans un instant.',
  session_expired: 'Ta session a expiré. Reconnecte-toi.',
};

/** The way out of an expired session: reloading the page lands on the sign-in. */
export function SignInAgain(): JSX.Element {
  return (
    <button
      type="button"
      className="nv-btn nv-btn--soft nv-btn--sm sv-self-start"
      onClick={() => {
        window.location.reload();
      }}
    >
      Se reconnecter
    </button>
  );
}

/**
 * Asks for the password again before a key is connected, replaced or removed (ADR 0016: the sign-in is more than
 * 10 minutes old). Confirmed, it signs in afresh and lets the caller run its action again; « Annuler » or Escape
 * gives up the action, except while the password is being checked. The page shows one prompt at a time: the
 * Services section closes a row's prompt before it opens a sheet.
 */
export function PasswordPrompt({
  onConfirmed,
  onCancel,
  onBusyChange,
  lead = 'Pour toucher à une clé, confirme ton mot de passe.',
  note,
}: {
  onConfirmed: () => void;
  onCancel: () => void;
  /** Told while the password is being checked, so a sheet around the prompt does not close meanwhile. */
  onBusyChange?: (isBusy: boolean) => void;
  /** What the password unlocks, said before the field; a key by default. */
  lead?: string;
  /** One more line under the lead (« Ta clé est gardée… »). */
  note?: string;
}): JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  // A visible label, so the field cannot be taken for the key field it replaces (recette du 29/10).
  const fieldId = useId();
  const [isBusy, setIsBusy] = useState(false);
  const [failure, setFailure] = useState<Exclude<ConfirmResult, 'ok'> | null>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  async function confirm(password: string): Promise<void> {
    if (password === '') return;
    setIsBusy(true);
    onBusyChange?.(true);
    const result = await confirmPassword(password).catch(() => 'unavailable' as const);
    setIsBusy(false);
    onBusyChange?.(false);
    if (result === 'ok') {
      onConfirmed();
      return;
    }
    if (input.current !== null) input.current.value = '';
    setFailure(result);
  }

  const isExpired = failure === 'session_expired';
  return (
    <div
      className="sv-reauth"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        // Handled here so that Escape leaves the prompt only, not the sheet around it.
        event.stopPropagation();
        if (!isBusy) onCancel();
      }}
    >
      <p className="sv-muted">{lead}</p>
      {note === undefined ? null : <p className="sv-muted">{note}</p>}
      <label className="sv-reauth__label" htmlFor={fieldId}>
        Mot de passe
      </label>
      <form
        className="sv-key"
        data-error={failure !== null}
        onSubmit={(event) => {
          event.preventDefault();
          void confirm(input.current?.value ?? '');
        }}
      >
        <input
          ref={input}
          id={fieldId}
          type="password"
          autoComplete="current-password"
          aria-invalid={failure !== null}
          aria-describedby="sv-reauth-msg"
          // Read-only rather than disabled while checking: the field keeps the focus, so Escape stays here.
          readOnly={isBusy}
          disabled={isExpired}
        />
        <button type="submit" className="nv-btn nv-btn--soft nv-btn--sm" disabled={isBusy || isExpired}>
          Confirmer
        </button>
        <button
          type="button"
          className="nv-btn nv-btn--plain nv-btn--sm"
          disabled={isBusy}
          onClick={onCancel}
        >
          Annuler
        </button>
      </form>
      <p
        id="sv-reauth-msg"
        className="sv-msg"
        data-kind={failure === null ? 'none' : 'error'}
        aria-live="polite"
      >
        {failure === null ? null : MESSAGES[failure]}
      </p>
      {isExpired ? <SignInAgain /> : null}
    </div>
  );
}
