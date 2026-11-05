import { useEffect, useId, useRef, useState, type JSX } from 'react';

import { confirmIdentity, type ConfirmResult } from './api';

import { CodeInput } from '@/auth/CodeInput';
import {
  canUsePasskeys,
  confirmWithPasskey,
  fetchPasskeys,
  gestureName,
  type PasskeyConfirmResult,
} from '@/auth/passkeys';
import './services.css';

const MESSAGES: Record<Exclude<ConfirmResult, 'ok'>, string> = {
  wrong_credentials: 'Mot de passe ou code incorrect.',
  too_many_attempts: 'Trop d’essais. Attends une minute avant de réessayer.',
  unavailable: 'Le serveur ne répond pas. Réessaie dans un instant.',
  session_expired: 'Ta session a expiré. Reconnecte-toi.',
};

const PASSKEY_MESSAGES: Partial<Record<PasskeyConfirmResult, string>> = {
  refused: 'Ce geste n’a pas été reconnu. Réessaie, ou donne ton mot de passe et ton code.',
  too_many_attempts: MESSAGES.too_many_attempts,
  unavailable: MESSAGES.unavailable,
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
 * Asks for the password and a code again before a key is connected, replaced or removed (ADR 0016, ADR 0046 § 3: they
 * were not given in the last 10 minutes on this session). Confirmed, the caller runs its action again; « Annuler » or
 * Escape gives up the action, except while they are being checked. The page shows one prompt at a time: the Services
 * section closes a row's prompt before it opens a sheet. An account that holds a passkey may confirm with a fresh
 * gesture instead (ADR 0053 § 4), except where `passkey` is false: adding a key asks for the password and the code.
 */
export function PasswordPrompt({
  onConfirmed,
  onCancel,
  onBusyChange,
  lead = 'Pour toucher à une clé, confirme ton mot de passe et ton code.',
  note,
  passkey = true,
  layout = 'inline',
}: {
  onConfirmed: () => void;
  onCancel: () => void;
  /** Told while the password is being checked, so a sheet around the prompt does not close meanwhile. */
  onBusyChange?: (isBusy: boolean) => void;
  /** What the password unlocks, said before the field; a key by default. Null where a dialog's lead already says it. */
  lead?: string | null;
  /** One more line under the lead (« Ta clé est gardée… »), or under the fields in a dialog. */
  note?: string;
  /**
   * Whether a passkey gesture may confirm too: false where only the password and the code count (adding a key), or
   * the key being removed, which only another key may confirm.
   */
  passkey?: boolean | { readonly excluding: string };
  /**
   * Inline, in a section or a sheet: small buttons on the left, under the fields. In a dialog (`Dialog`), the fields
   * take the width and the buttons sit at the foot on the right, « Confirmer » as the dialog's one neon (reco 9).
   */
  layout?: 'inline' | 'dialog';
}): JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  // A visible label, so the field cannot be taken for the key field it replaces (recette du 29/10).
  const fieldId = useId();
  const [isBusy, setIsBusy] = useState(false);
  const [failure, setFailure] = useState<Exclude<ConfirmResult, 'ok'> | null>(null);

  const [hasPasskey, setHasPasskey] = useState(false);
  const excluding = typeof passkey === 'object' ? passkey.excluding : undefined;
  const allowsPasskey = passkey !== false;
  const [passkeyNote, setPasskeyNote] = useState<string | null>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  // The gesture is offered only to an account that holds a key, on a browser that can make it.
  useEffect(() => {
    if (!allowsPasskey || !canUsePasskeys()) return;
    let isCurrent = true;
    void fetchPasskeys().then((keys) => {
      if (isCurrent) setHasPasskey(keys?.some((key) => key.id !== excluding) === true);
    });
    return () => {
      isCurrent = false;
    };
  }, [allowsPasskey, excluding]);

  async function confirmByGesture(): Promise<void> {
    setIsBusy(true);
    onBusyChange?.(true);
    setFailure(null);
    setPasskeyNote(null);
    const result = await confirmWithPasskey(excluding).catch((): PasskeyConfirmResult => 'unavailable');
    setIsBusy(false);
    onBusyChange?.(false);
    if (result === 'ok') {
      onConfirmed();
      return;
    }
    if (result === 'session_expired') setFailure('session_expired');
    else if (result === 'no_passkey') setHasPasskey(false);
    else setPasskeyNote(PASSKEY_MESSAGES[result] ?? null);
  }

  async function confirm(password: string, code: string): Promise<void> {
    if (password === '') return;
    if (code.trim() === '') {
      codeInput.current?.focus();
      return;
    }
    setIsBusy(true);
    onBusyChange?.(true);
    setPasskeyNote(null);
    const result = await confirmIdentity(password, code).catch(() => 'unavailable' as const);
    setIsBusy(false);
    onBusyChange?.(false);
    if (result === 'ok') {
      onConfirmed();
      return;
    }
    if (input.current !== null) input.current.value = '';
    if (codeInput.current !== null) codeInput.current.value = '';
    setFailure(result);
  }

  const isExpired = failure === 'session_expired';
  const inDialog = layout === 'dialog';
  return (
    <div
      className="sv-reauth"
      data-layout={layout}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        // Handled here so that Escape leaves the prompt only, not the sheet around it.
        event.stopPropagation();
        if (!isBusy) onCancel();
      }}
    >
      {lead === null ? null : (
        <div className="sv-reauth__head">
          <p className="sv-reauth__lead">{lead}</p>
          {note === undefined || inDialog ? null : <p className="sv-reauth__note">{note}</p>}
        </div>
      )}
      <form
        className="sv-reauth__form"
        data-error={failure !== null}
        onSubmit={(event) => {
          event.preventDefault();
          void confirm(input.current?.value ?? '', codeInput.current?.value ?? '');
        }}
      >
        <div className="sv-reauth__fields">
          <label className="nv-field sv-reauth__password" htmlFor={fieldId}>
            <span className="nv-field__label">Mot de passe</span>
            <input
              ref={input}
              id={fieldId}
              className="nv-field__control nv-glass"
              type="password"
              autoComplete="current-password"
              aria-invalid={failure !== null}
              aria-describedby="sv-reauth-msg"
              // Read-only rather than disabled while checking: the field keeps the focus, so Escape stays here.
              readOnly={isBusy}
              disabled={isExpired}
            />
          </label>
          <CodeInput ref={codeInput} disabled={isBusy || isExpired} invalid={failure !== null} />
        </div>
        {inDialog && note !== undefined ? <p className="sv-reauth__note">{note}</p> : null}
        <div className="sv-reauth__actions">
          <button
            type="submit"
            className={inDialog ? 'nv-btn nv-btn--neon' : 'nv-btn nv-btn--soft nv-btn--sm'}
            disabled={isBusy || isExpired}
            aria-busy={isBusy}
          >
            {isBusy ? 'Vérification…' : 'Confirmer'}
          </button>
          <button
            type="button"
            className={inDialog ? 'nv-btn nv-btn--plain' : 'nv-btn nv-btn--plain nv-btn--sm'}
            disabled={isBusy}
            onClick={onCancel}
          >
            Annuler
          </button>
        </div>
      </form>
      {hasPasskey && !isExpired ? (
        <button
          type="button"
          className="nv-btn nv-btn--soft nv-btn--sm sv-self-start"
          disabled={isBusy}
          onClick={() => void confirmByGesture()}
        >
          Confirmer avec {gestureName()}
        </button>
      ) : null}
      <p
        id="sv-reauth-msg"
        className="sv-msg"
        data-kind={failure === null && passkeyNote === null ? 'none' : 'error'}
        aria-live="polite"
      >
        {failure === null ? passkeyNote : MESSAGES[failure]}
      </p>
      {isExpired ? <SignInAgain /> : null}
    </div>
  );
}
