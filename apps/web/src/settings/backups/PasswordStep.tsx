import { useEffect, useRef, useState, type JSX } from 'react';

import { confirmPassword, type ConfirmResult } from '@/settings/services/api';

const PASSWORD_MESSAGES: Record<Exclude<ConfirmResult, 'ok'>, string> = {
  wrong_credentials: 'Ce n’est pas le bon mot de passe.',
  too_many_attempts: 'Trop d’essais. Attends une minute avant de réessayer.',
  unavailable: 'Le serveur ne répond pas. Réessaie dans un instant.',
  session_expired: 'Ta session a expiré. Reconnecte-toi.',
};

/**
 * The sign-in is older than 10 minutes: the password again, then the caller sends its request again, with the same id
 * (a restore test, a request to export now). `tone`: « Confirmer » is the neon only where the step stands alone (the
 * restore test's dialog); on the page, the neon stays « Noter un essai ».
 */
export function PasswordStep({
  hint,
  tone = 'neon',
  onConfirmed,
  onCancel,
}: {
  hint: string;
  tone?: 'neon' | 'soft';
  onConfirmed: () => void;
  onCancel: () => void;
}): JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Exclude<ConfirmResult, 'ok'> | null>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const confirm = async (): Promise<void> => {
    const password = input.current?.value ?? '';
    if (password === '') return;
    setBusy(true);
    const result = await confirmPassword(password).catch(() => 'unavailable' as const);
    setBusy(false);
    if (result === 'ok') {
      onConfirmed();
      return;
    }
    if (input.current !== null) input.current.value = '';
    setFailure(result);
  };

  return (
    <div
      className="bk-password nv-swap"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        // Leaves the prompt only, not the dialog around it.
        event.stopPropagation();
        if (!busy) onCancel();
      }}
    >
      <p className="bk-hint">{hint}</p>
      <div className="bk-inline">
        <input
          ref={input}
          className="nv-field__control nv-glass"
          type="password"
          autoComplete="current-password"
          aria-label="Mot de passe"
          aria-invalid={failure !== null}
          disabled={busy}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            // Inside the form of the fields: Enter confirms the password, it does not send the test.
            event.preventDefault();
            void confirm();
          }}
        />
        <button
          type="button"
          className={`nv-btn nv-btn--${tone} nv-btn--sm`}
          disabled={busy}
          aria-busy={busy}
          onClick={() => void confirm()}
        >
          Confirmer
        </button>
        <button type="button" className="nv-btn nv-btn--plain nv-btn--sm" disabled={busy} onClick={onCancel}>
          Annuler
        </button>
      </div>
      {failure === null ? null : (
        <p className="bk-warn nv-swap" role="alert">
          {PASSWORD_MESSAGES[failure]}
        </p>
      )}
      {failure === 'session_expired' ? <SignInAgain /> : null}
    </div>
  );
}

/** The session has ended: reloading the app shows the sign-in. */
export function SignInAgain(): JSX.Element {
  return (
    <button
      type="button"
      className="nv-btn nv-btn--soft nv-btn--sm bk-self-start"
      onClick={() => {
        window.location.reload();
      }}
    >
      Se reconnecter
    </button>
  );
}
