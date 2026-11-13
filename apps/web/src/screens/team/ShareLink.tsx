import type { InvitationLinkCreated, InvitationLinkPurpose } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type JSX } from 'react';

import { createInvitationLink, MEMBERS_KEY } from './api';
import { deadline, ERROR_MESSAGES } from './model';
import './team.css';

import { PasswordPrompt } from '@/settings/services/PasswordPrompt';

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
  onAsking,
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
  /** Told when the password is asked and when it is no longer: the panel around hides its other way out meanwhile. */
  onAsking?: (asking: boolean) => void;
}): JSX.Element {
  const client = useQueryClient();
  return (
    <LinkShare
      label={label}
      initial={initial}
      primary={primary}
      onAsking={onAsking}
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
  onAsking,
}: {
  make: () => Promise<LinkOutcome>;
  /** The message's words before the link: « Bienvenue dans l’équipe, Théo ! Choisis ton mot de passe ici : ». */
  welcome: string;
  label: string;
  initial?: InvitationLinkCreated | null;
  primary?: boolean;
  /** Nothing to make the link with yet (an e-mail still to type). */
  disabled?: boolean;
  onAsking?: ((asking: boolean) => void) | undefined;
}): JSX.Element {
  const [step, setStep] = useState<Step>(
    initial === null ? { kind: 'idle' } : { kind: 'made', link: initial },
  );
  const go = (next: Step): void => {
    setStep(next);
    onAsking?.(next.kind === 'password');
  };

  const run = async (): Promise<void> => {
    go({ kind: 'busy' });
    const outcome = await make();
    if (outcome.kind === 'ok') go({ kind: 'made', link: outcome.value });
    else if (outcome.kind === 'reauth') go({ kind: 'password' });
    else
      go({
        kind: 'error',
        message:
          outcome.kind === 'refused'
            ? outcome.message
            : 'Aucun lien n’a été créé : le serveur ne répond pas. Réessaie dans un instant.',
      });
  };

  if (step.kind === 'made') return <Made link={step.link} welcome={welcome} primary={primary} />;
  if (step.kind === 'password') {
    // The same prompt as every key and setting of the CRM: password and code, then « Confirmer » (GES-13).
    return (
      <PasswordPrompt
        lead="Pour créer un lien d’accès, confirme ton mot de passe et ton code."
        passkey={false}
        onConfirmed={() => {
          void run();
        }}
        onCancel={() => {
          go({ kind: 'idle' });
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
      {/* Labelled as the e-mail above it is, and told before the button what « Copier le message » copies. */}
      <label className="nv-field">
        <span className="nv-field__label">Son lien</span>
        <input
          ref={field}
          className="nv-field__control nv-glass tm-link"
          value={link.url}
          readOnly
          onFocus={(event) => {
            event.target.select();
            // Selected whole, read from its start: the address, not the end of its token (EQ-12).
            event.target.scrollLeft = 0;
          }}
        />
      </label>
      <p className="tm-hint">
        Le message : « {welcome} » suivi du lien. Valable jusqu’à {deadline(new Date(link.expiresAt))}, pour
        un seul usage. Un nouveau lien annule celui-ci.
      </p>
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
    </div>
  );
}
