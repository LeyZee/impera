import type { LinkServiceStatus } from '@impera/contracts';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import { connectLinkServiceKey, disconnectLinkService, fetchLinkService } from './api';
import { dotOf, lineOf } from './view';

import { PasswordPrompt, SignInAgain } from '@/settings/services/PasswordPrompt';
import { RevealKey } from '@/settings/services/RevealKey';
import { isForbidden, ReauthRequired, showError, type ShownError } from '@/settings/services/api';
import { normalizeKey } from '@/settings/services/view';
import '@/settings/services/services.css';
import '@/settings/sales-feed/sales-feed.css';
import './link-service.css';

/** A key refused after the password prompt: the field was emptied for the prompt, so it is pasted again. */
const PASTE_AGAIN = 'Colle la clé une nouvelle fois.';

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly error: ShownError }
  | { readonly kind: 'ready'; readonly status: LinkServiceStatus };

/**
 * Réglages › Plateformes, « Liens de redirection » (INS-02): the agency's key of the redirect service, read only.
 * Checked at the service before it is kept, then sealed; nothing here ever shows it again, even masked. With it,
 * « Détecter ses liens » lists the account's links in a creator's file; nothing is ever written at the service.
 */
export function LinkServiceCard(): JSX.Element | null {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [isKeyOpen, setIsKeyOpen] = useState(false);
  const [isConfirmingRemove, setIsConfirmingRemove] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [notice, setNotice] = useState<ShownError | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setLoad({ kind: 'ready', status: await fetchLinkService() });
    } catch (error) {
      // The page's first card already says who may open Réglages: this one stays silent for anyone else.
      setLoad(isForbidden(error) ? { kind: 'loading' } : { kind: 'failed', error: showError(error) });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const remove = (): void => {
    setNotice(null);
    setIsRemoving(true);
    disconnectLinkService()
      .then(
        (status) => {
          setLoad({ kind: 'ready', status });
        },
        (error: unknown) => {
          if (error instanceof ReauthRequired) setNeedsPassword(true);
          else setNotice(showError(error, 'La clé n’a pas été retirée.'));
        },
      )
      .finally(() => {
        setIsRemoving(false);
      });
  };

  if (load.kind === 'loading') return null;
  if (load.kind === 'failed') {
    return (
      <div className="nv-plate sf-key">
        <h2 className="nv-h2 sv-lead">Liens de redirection</h2>
        <p className="sv-notice" role="alert" data-tone="error">
          {load.error.message}
        </p>
        {load.error.isSessionExpired ? (
          <SignInAgain />
        ) : (
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm sv-self-start"
            onClick={() => void refresh()}
          >
            Réessayer
          </button>
        )}
      </div>
    );
  }

  const { status } = load;
  const hasKey = status.state === 'connected' || status.state === 'needs_reconnect';
  return (
    <div className="nv-plate sf-key">
      <div className="sf-head">
        <span className="sv-dot sv-dot--big" data-dot={dotOf(status)} />
        <div className="sf-head__text">
          <h2 className="nv-h2 sv-lead">
            Liens de redirection <small className="sf-sub">lecture seule</small>
          </h2>
          <p className="sv-muted sf-line" data-state={status.state} aria-live="polite">
            {lineOf(status)}
          </p>
        </div>
        {isKeyOpen || status.state === 'off' ? null : (
          <div className="sf-head__act">
            <button
              type="button"
              className={
                status.state === 'connected' ? 'nv-btn nv-btn--soft nv-btn--sm' : 'nv-btn nv-btn--neon'
              }
              onClick={() => {
                setIsConfirmingRemove(false);
                setNeedsPassword(false);
                setIsKeyOpen(true);
              }}
            >
              {status.state === 'connected'
                ? 'Remplacer la clé'
                : status.state === 'needs_reconnect'
                  ? 'Reconnecter la clé'
                  : 'Connecter la clé'}
            </button>
            {hasKey ? (
              <button
                type="button"
                className="nv-btn nv-btn--plain nv-btn--sm"
                disabled={isRemoving}
                onClick={() => {
                  setNeedsPassword(false);
                  setIsConfirmingRemove(true);
                }}
              >
                Retirer
              </button>
            ) : null}
          </div>
        )}
      </div>

      {isKeyOpen ? (
        <KeyForm
          isReplace={hasKey}
          onSaved={(saved) => {
            setIsKeyOpen(false);
            setNotice(null);
            setLoad({ kind: 'ready', status: saved });
          }}
          onCancel={() => {
            setIsKeyOpen(false);
          }}
        />
      ) : null}

      {isConfirmingRemove ? (
        <div className="nv-confirm sv-confirm">
          <p>
            <b>Retirer la clé du service de liens ?</b> {'« Détecter ses liens »'} ne marche plus. Les liens
            déjà ajoutés aux créatrices restent. Dans le service, la clé reste valide tant que tu ne la
            supprimes pas.
          </p>
          <div className="nv-confirm__actions">
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm"
              onClick={() => {
                setIsConfirmingRemove(false);
              }}
            >
              Garder
            </button>
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--destructive nv-btn--sm"
              onClick={() => {
                setIsConfirmingRemove(false);
                remove();
              }}
            >
              Retirer la clé
            </button>
          </div>
        </div>
      ) : null}

      {needsPassword ? (
        <div className="nv-confirm sv-confirm">
          <PasswordPrompt
            lead="Pour retirer la clé, confirme ton mot de passe et ton code."
            onConfirmed={() => {
              setNeedsPassword(false);
              remove();
            }}
            onCancel={() => {
              setNeedsPassword(false);
            }}
          />
        </div>
      ) : null}

      {notice === null ? null : (
        <>
          <p className="sv-notice" role="alert" data-tone="error">
            {notice.message}
          </p>
          {notice.isSessionExpired ? <SignInAgain /> : null}
        </>
      )}
    </div>
  );
}

type Phase =
  | { readonly kind: 'edit'; readonly error: ShownError | null }
  | { readonly kind: 'busy' }
  | { readonly kind: 'reauth'; readonly key: string };

/** The key field: a paste is checked at once, and a key the service refuses is never kept. */
function KeyForm({
  isReplace,
  onSaved,
  onCancel,
}: {
  isReplace: boolean;
  onSaved: (status: LinkServiceStatus) => void;
  onCancel: () => void;
}): JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const [shown, setShown] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'edit', error: null });
  const isBusy = phase.kind === 'busy';

  useEffect(() => {
    if (phase.kind === 'edit') input.current?.focus();
  }, [phase.kind]);

  async function submit(raw: string, isRetry = false): Promise<void> {
    const key = normalizeKey(raw);
    if (key === '') return;
    const failed = (error: ShownError): Phase => ({
      kind: 'edit',
      error:
        isRetry && !error.isSessionExpired ? { ...error, message: `${error.message} ${PASTE_AGAIN}` } : error,
    });
    setPhase({ kind: 'busy' });
    try {
      const result = await connectLinkServiceKey(key);
      if (!result.ok) {
        setPhase(failed({ message: result.refusal.message, isSessionExpired: false }));
        return;
      }
      if (input.current !== null) input.current.value = '';
      onSaved(result.status);
    } catch (error) {
      setPhase(error instanceof ReauthRequired ? { kind: 'reauth', key } : failed(showError(error)));
    }
  }

  if (phase.kind === 'reauth') {
    return (
      <div className="nv-confirm sv-confirm">
        <PasswordPrompt
          lead={`Pour ${isReplace ? 'remplacer' : 'connecter'} la clé du service de liens, confirme ton mot de passe et ton code.`}
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
      <p className="sv-muted ls-help">
        Dans ton service de liens, crée une clé d’API en <b>lecture seule</b>, rien que pour Impera, et
        colle-la ici. Impera la vérifie puis la garde chiffrée : elle ne se relit plus, même ici.
      </p>
      <form
        className="ls-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(input.current?.value ?? '');
        }}
      >
        <div className="sv-key ls-key" data-error={error !== null}>
          {/* Not `type=password`: a password manager would offer to save it. Masked by CSS (services.css). */}
          <input
            ref={input}
            type="text"
            className="sv-key__secret"
            data-shown={shown ? 'true' : undefined}
            name="nv-link-service-key"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore=""
            data-lpignore="true"
            data-form-type="other"
            data-bwignore=""
            aria-label="Clé du service de liens"
            aria-invalid={error !== null}
            aria-describedby="ls-key-msg"
            disabled={isBusy}
            onPaste={(event) => {
              event.preventDefault();
              const pasted = normalizeKey(event.clipboardData.getData('text'));
              event.currentTarget.value = pasted;
              void submit(pasted);
            }}
          />
          <RevealKey
            shown={shown}
            disabled={isBusy}
            onToggle={() => {
              setShown(!shown);
            }}
          />
        </div>
        <div className="ls-form__act">
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
        </div>
      </form>
      <p
        id="ls-key-msg"
        className="sv-msg"
        data-kind={isBusy ? 'busy' : error === null ? 'none' : 'error'}
        aria-live="polite"
      >
        {isBusy ? 'Vérification auprès du service…' : (error?.message ?? null)}
      </p>
      {error?.isSessionExpired === true ? <SignInAgain /> : null}
    </div>
  );
}
