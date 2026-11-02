import type { Platform, SalesFeedStatus } from '@nirvana/contracts';
import { useEffect, useRef, useState, type JSX } from 'react';

import { connectKey } from './api';
import { platformName, shownOf } from './shown';

import { PasswordPrompt, SignInAgain } from '@/settings/services/PasswordPrompt';
import { ReauthRequired, type ShownError } from '@/settings/services/api';
import { normalizeKey } from '@/settings/services/view';

/** A key refused after the password prompt: the field was emptied for the prompt, so it is pasted again. */
const PASTE_AGAIN = 'Colle la clé une nouvelle fois.';

type Phase = { kind: 'edit'; error: ShownError | null } | { kind: 'busy' } | { kind: 'reauth'; key: string };

/**
 * The key field of a sales feed (ADR 0050 § 4): checked at the platform before it is kept, a key it refuses is never
 * saved and its reason is said under the field. A paste is checked at once, as on the Services page.
 */
export function KeyForm({
  platform,
  isReplace,
  onSaved,
  onCancel,
}: {
  platform: Platform;
  isReplace: boolean;
  onSaved: (status: SalesFeedStatus) => void;
  onCancel: () => void;
}): JSX.Element {
  const name = platformName(platform);
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'edit', error: null });
  const isBusy = phase.kind === 'busy';

  useEffect(() => {
    if (phase.kind === 'edit') input.current?.focus();
  }, [phase.kind]);

  async function submit(raw: string, isRetry = false): Promise<void> {
    const key = normalizeKey(raw);
    if (key === '') return;
    const failed = (shown: ShownError): Phase => ({
      kind: 'edit',
      error:
        isRetry && !shown.isSessionExpired ? { ...shown, message: `${shown.message} ${PASTE_AGAIN}` } : shown,
    });
    setPhase({ kind: 'busy' });
    try {
      const result = await connectKey(platform, key);
      if (!result.ok) {
        setPhase(failed({ message: result.refusal.message, isSessionExpired: false }));
        return;
      }
      if (input.current !== null) input.current.value = '';
      onSaved(result.status);
    } catch (error) {
      setPhase(error instanceof ReauthRequired ? { kind: 'reauth', key } : failed(shownOf(error)));
    }
  }

  if (phase.kind === 'reauth') {
    return (
      <div className="nv-confirm sv-confirm">
        <PasswordPrompt
          lead={`Pour ${isReplace ? 'remplacer' : 'connecter'} la clé de ${name}, confirme ton mot de passe et ton code.`}
          onConfirmed={() => void submit(phase.key, true)}
          onCancel={() => {
            setPhase({ kind: 'edit', error: null });
          }}
        />
      </div>
    );
  }

  const error = phase.kind === 'edit' ? phase.error : null;
  return (
    <div className="sf-form">
      <ol className="sf-steps">
        <li>
          Dans {name}, ouvre <b>Paramètres › CRM / API</b> et crée une clé.
        </li>
        <li>
          Coche <b>Statistiques</b> et <b>Ventes une par une</b>.
        </li>
        <li>Colle-la ici : elle commence par « rvl_ » et Nirvana la vérifie toute seule.</li>
      </ol>
      <form
        className="sv-key"
        data-error={error !== null}
        onSubmit={(event) => {
          event.preventDefault();
          void submit(input.current?.value ?? '');
        }}
      >
        {/*
          Not `type=password`: a password manager would offer to save the key, or fill in the dashboard password,
          which would then go to the platform. The field is masked by CSS instead (services.css).
        */}
        <input
          ref={input}
          type="text"
          className="sv-key__secret"
          name="nv-sales-feed-key"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore=""
          data-lpignore="true"
          data-form-type="other"
          data-bwignore=""
          aria-label={`Clé de l’API CRM de ${name}`}
          aria-invalid={error !== null}
          aria-describedby="sf-key-msg"
          placeholder="rvl_…"
          disabled={isBusy}
          onPaste={(event) => {
            event.preventDefault();
            const pasted = normalizeKey(event.clipboardData.getData('text'));
            event.currentTarget.value = pasted;
            void submit(pasted);
          }}
        />
        <button type="submit" className="nv-btn nv-btn--soft nv-btn--sm" disabled={isBusy}>
          Vérifier
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
        id="sf-key-msg"
        className="sv-msg"
        data-kind={isBusy ? 'busy' : error === null ? 'none' : 'error'}
        aria-live="polite"
      >
        {isBusy ? `Vérification chez ${name}…` : (error?.message ?? null)}
      </p>
      {error?.isSessionExpired === true ? <SignInAgain /> : null}
    </div>
  );
}
