import type { InvitationLinkCreated, InvitationLinkPurpose } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type JSX } from 'react';

import { createInvitationLink, MEMBERS_KEY } from './api';
import { deadline, ERROR_MESSAGES } from './model';
import './team.css';

import { CodeInput } from '@/auth/CodeInput';
import { confirmIdentity, type ConfirmResult } from '@/settings/services/api';

const PASSWORD_MESSAGES: Record<Exclude<ConfirmResult, 'ok'>, string> = {
  wrong_credentials: 'Mot de passe ou code incorrect.',
  too_many_attempts: 'Trop d’essais. Réessaie dans quelques minutes.',
  unavailable: 'Le serveur ne répond pas. Réessaie dans un instant.',
  session_expired: 'Ta session a expiré. Reconnecte-toi.',
};

const SHARE_TEXT: Record<InvitationLinkPurpose, (name: string) => string> = {
  invitation: (name) => `Bienvenue dans l’équipe, ${name} ! Choisis ton mot de passe ici :`,
  reset: (name) => `${name}, choisis ton nouveau mot de passe ici :`,
};

/** What making a link came to, said in the screen's own words: a refusal carries its sentence. */
export type LinkOutcome =
  | { readonly kind: 'ok'; readonly value: InvitationLinkCreated }
  | { readonly kind: 'reauth' }
  | { readonly kind: 'refused'; readonly message: string }
  | { readonly kind: 'failed' };

type Step =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'password' }
  | { readonly kind: 'made'; readonly link: InvitationLinkCreated }
  | { readonly kind: 'error'; readonly message: string };

/**
 * Makes a member's link (EQ-10) and hands it over: copied, or shared through the phone's sheet (WhatsApp). Impera
 * sends no e-mail. A new link cancels the one before; making one asks for a recent sign-in, so the owner may be asked
 * for his password first.
 */
export function ShareLink({
  memberId,
  name,
  purpose,
  label,
  initial = null,
  primary = false,
}: {
  memberId: string;
  name: string;
  purpose: InvitationLinkPurpose;
  /** What the button says: « Créer son lien », « Nouveau lien »… */
  label: string;
  /** A link already made (the add panel asks for it right after creating the member). */
  initial?: InvitationLinkCreated | null;
  /** The panel's main action: « Copier le message » in neon (the add panel); soft on the member's sheet. */
  primary?: boolean;
}): JSX.Element {
  const client = useQueryClient();
  return (
    <LinkShare
      label={label}
      initial={initial}
      primary={primary}
      welcome={SHARE_TEXT[purpose](name)}
      make={async () => {
        const outcome = await createInvitationLink(memberId, purpose);
        if (outcome.kind === 'ok') await client.invalidateQueries({ queryKey: MEMBERS_KEY });
        return outcome.kind === 'refused'
          ? { kind: 'refused', message: ERROR_MESSAGES[outcome.code] }
          : outcome;
      }}
    />
  );
}

/**
 * The walk of any access link, a member's or a creator's own (CR-02): the button, the password asked again when the
 * sign-in is not recent, then the link handed over with its message. `make` says how the link is made and what a
 * refusal says.
 */
export function LinkShare({
  make,
  welcome,
  label,
  initial = null,
  primary = false,
  disabled = false,
}: {
  make: () => Promise<LinkOutcome>;
  /** The message's words before the link: « Bienvenue dans l’équipe, Théo ! Choisis ton mot de passe ici : ». */
  welcome: string;
  label: string;
  initial?: InvitationLinkCreated | null;
  primary?: boolean;
  /** Nothing to make the link with yet (an e-mail still to type). */
  disabled?: boolean;
}): JSX.Element {
  const [step, setStep] = useState<Step>(
    initial === null ? { kind: 'idle' } : { kind: 'made', link: initial },
  );

  const run = async (): Promise<void> => {
    setStep({ kind: 'busy' });
    const outcome = await make();
    if (outcome.kind === 'ok') setStep({ kind: 'made', link: outcome.value });
    else if (outcome.kind === 'reauth') setStep({ kind: 'password' });
    else
      setStep({
        kind: 'error',
        message:
          outcome.kind === 'refused'
            ? outcome.message
            : 'Aucun lien n’a été créé : le serveur ne répond pas. Réessaie dans un instant.',
      });
  };

  if (step.kind === 'made') return <Made link={step.link} welcome={welcome} primary={primary} />;
  if (step.kind === 'password') {
    return (
      <PasswordStep
        onConfirmed={() => {
          void run();
        }}
        onCancel={() => {
          setStep({ kind: 'idle' });
        }}
      />
    );
  }
  return (
    <div className="tm-share">
      <button
        type="button"
        className="nv-btn nv-btn--soft nv-btn--sm tm-self-start"
        disabled={disabled || step.kind === 'busy'}
        aria-busy={step.kind === 'busy'}
        onClick={() => {
          void run();
        }}
      >
        {step.kind === 'busy' ? 'Création du lien…' : label}
      </button>
      {step.kind === 'error' ? (
        <p className="tm-warn nv-swap" role="alert">
          {step.message}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The link made, handed over as a message (EQ-12): « Copier le message » copies the welcome and the link together, so
 * that WhatsApp never carries a bare address; « Partager » opens the phone's sheet with the same.
 */
function Made({
  link,
  welcome,
  primary,
}: {
  link: InvitationLinkCreated;
  welcome: string;
  primary: boolean;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const canShare = typeof navigator.share === 'function';
  const message = `${welcome} ${link.url}`;

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
    } catch {
      // No clipboard (an old browser, a refusal): the link stays selected, ready for a copy by hand.
      field.current?.select();
    }
  };

  return (
    <div className="tm-share tm-share--made nv-enter">
      <input
        ref={field}
        className="nv-field__control nv-glass tm-link"
        value={link.url}
        readOnly
        aria-label="Lien à envoyer"
        onFocus={(event) => {
          event.target.select();
          // Selected whole, read from its start: the address, not the end of its token (EQ-12).
          event.target.scrollLeft = 0;
        }}
      />
      <div className="tm-share__actions">
        <button
          type="button"
          className={`nv-btn ${primary ? 'nv-btn--neon tm-primary' : 'nv-btn--soft nv-btn--sm'}`}
          onClick={() => {
            void copy();
          }}
        >
          {copied ? 'Message copié' : 'Copier le message'}
        </button>
        {canShare ? (
          <button
            type="button"
            className={`nv-btn nv-btn--soft${primary ? '' : ' nv-btn--sm'}`}
            onClick={() => {
              void navigator.share({ text: welcome, url: link.url }).catch(() => undefined);
            }}
          >
            Partager
          </button>
        ) : null}
      </div>
      <p className="tm-hint">
        Le message : « {welcome} » suivi du lien. Valable jusqu’à {deadline(new Date(link.expiresAt))}, pour
        un seul usage. Un nouveau lien annule celui-ci.
      </p>
    </div>
  );
}

function PasswordStep({
  onConfirmed,
  onCancel,
}: {
  onConfirmed: () => void;
  onCancel: () => void;
}): JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Exclude<ConfirmResult, 'ok'> | null>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const confirm = async (password: string, code: string): Promise<void> => {
    if (password === '') return;
    if (code.trim() === '') {
      codeInput.current?.focus();
      return;
    }
    setBusy(true);
    const result = await confirmIdentity(password, code).catch(() => 'unavailable' as const);
    setBusy(false);
    if (result === 'ok') {
      onConfirmed();
      return;
    }
    if (input.current !== null) input.current.value = '';
    if (codeInput.current !== null) codeInput.current.value = '';
    setFailure(result);
  };

  return (
    <div
      className="tm-share nv-enter"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        // Leaves the prompt only, not the panel around it.
        event.stopPropagation();
        if (!busy) onCancel();
      }}
    >
      <p className="tm-hint">Pour créer un lien d’accès, confirme ton mot de passe et ton code.</p>
      <form
        className="tm-inline"
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
          aria-label="Ton mot de passe"
          aria-invalid={failure !== null}
          disabled={busy}
        />
        <CodeInput ref={codeInput} disabled={busy} invalid={failure !== null} />
        <button type="submit" className="nv-btn nv-btn--soft nv-btn--sm" disabled={busy} aria-busy={busy}>
          Confirmer
        </button>
        <button type="button" className="nv-btn nv-btn--plain nv-btn--sm" disabled={busy} onClick={onCancel}>
          Annuler
        </button>
      </form>
      {failure === null ? null : (
        <p className="tm-warn nv-swap" role="alert">
          {PASSWORD_MESSAGES[failure]}
        </p>
      )}
      {failure === 'session_expired' ? (
        <button
          type="button"
          className="nv-btn nv-btn--soft nv-btn--sm tm-self-start"
          onClick={() => {
            window.location.reload();
          }}
        >
          Se reconnecter
        </button>
      ) : null}
    </div>
  );
}
