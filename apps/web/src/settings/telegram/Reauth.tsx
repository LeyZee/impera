import { useEffect, useRef, useState, type JSX } from 'react';

import { confirmIdentity } from '../services/api';

import { CodeInput } from '@/auth/CodeInput';

const MESSAGES = {
  wrong_credentials: 'Mot de passe ou code incorrect.',
  too_many_attempts: 'Trop d’essais. Réessaie dans quelques minutes.',
  unavailable: 'Le serveur ne répond pas. Réessaie dans un instant.',
  session_expired: 'Ta session a expiré. Reconnecte-toi.',
} as const;

/**
 * Adding, replacing or removing a bot asks for the password and a code given under 10 minutes ago (ADR 0016, ADR 0046
 * § 3), as a key does. Confirmed, the caller runs its action again; « Annuler » or Escape gives it up.
 */
export function Reauth({
  onConfirmed,
  onCancel,
}: {
  onConfirmed: () => void;
  onCancel: () => void;
}): JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExpired, setIsExpired] = useState(false);

  useEffect(() => {
    input.current?.focus();
  }, []);

  async function confirm(password: string, code: string): Promise<void> {
    if (password === '') return;
    if (code.trim() === '') {
      codeInput.current?.focus();
      return;
    }
    setIsBusy(true);
    const result = await confirmIdentity(password, code).catch(() => 'unavailable' as const);
    setIsBusy(false);
    if (result === 'ok') {
      onConfirmed();
      return;
    }
    if (input.current !== null) input.current.value = '';
    if (codeInput.current !== null) codeInput.current.value = '';
    setIsExpired(result === 'session_expired');
    setError(MESSAGES[result]);
  }

  return (
    <div
      className="tg-reauth"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        // Leaves the prompt only, not the sheet around it.
        event.stopPropagation();
        onCancel();
      }}
    >
      <p className="tg-hint">Pour toucher à un bot, confirme ton mot de passe et ton code.</p>
      <form
        className="tg-inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          void confirm(input.current?.value ?? '', codeInput.current?.value ?? '');
        }}
      >
        <input
          ref={input}
          className="nv-field__control nv-glass"
          type="password"
          autoComplete="current-password"
          aria-label="Mot de passe"
          aria-invalid={error !== null}
          aria-describedby="tg-reauth-msg"
          disabled={isBusy}
        />
        <CodeInput ref={codeInput} disabled={isBusy} invalid={error !== null} />
        <button type="submit" className="nv-btn nv-btn--soft nv-btn--sm" disabled={isBusy}>
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
      <p id="tg-reauth-msg" className="tg-hint" data-error={error !== null} aria-live="polite">
        {error}
      </p>
      {isExpired ? (
        <button
          type="button"
          className="nv-btn nv-btn--soft nv-btn--sm tg-self-start"
          onClick={() => {
            // Reloading lands on the sign-in page.
            window.location.reload();
          }}
        >
          Se reconnecter
        </button>
      ) : null}
    </div>
  );
}
