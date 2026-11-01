import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  type InvitationLinkPreview,
  type Me,
  type PasswordInvalidReason,
} from '@nirvana/contracts';
import { useCallback, useEffect, useState, type JSX, type ReactNode, type SyntheticEvent } from 'react';

import { PublicBrand } from './PublicBrand';
import { inspectInvitationLink, redeemInvitationLink, takeToken } from './api';
import { fetchCurrentUser } from './session';

export interface LinkPageProps {
  /** The member is in, his session open (in place of any other on this browser); `null` when it could not be read. */
  onSignedIn: (me: Me | null) => void;
  /** Leaves a link that does not work, for the sign-in page. */
  onLeave: () => void;
}

/** What tells the two pages apart; the rest is the same walk. */
export interface LinkPageCopy {
  /** Above the title: what the member checks of his record (EQ-10 « vérifier son nom et son pays »). */
  readonly eyebrow?: (preview: InvitationLinkPreview) => string;
  readonly title: (preview: InvitationLinkPreview) => string;
  /** The browser tab's name for the page, before the link is read. */
  readonly page: string;
  readonly lead: string;
  readonly passwordLabel: string;
  readonly submit: string;
  /** Under the button, faint. */
  readonly footnote?: string;
}

type Step =
  | { readonly kind: 'reading' }
  | { readonly kind: 'gone' | 'used_by_this_page' | 'too_many_attempts' | 'unavailable' }
  | { readonly kind: 'ready'; readonly preview: InvitationLinkPreview };

/**
 * A one-time link (EQ-10), on the sign-in page's plate: the link is read first (whose it is, his e-mail read only),
 * then the member chooses his password, and his session opens. Chatters open it from WhatsApp: the phone comes first.
 */
export function LinkPage({ copy, onSignedIn, onLeave }: LinkPageProps & { copy: LinkPageCopy }): JSX.Element {
  const [token] = useState(() => takeToken());
  const [step, setStep] = useState<Step>({ kind: token === null ? 'gone' : 'reading' });
  /** Who this browser is signed in as, if anyone: redeem opens the member's session in place of it. */
  const [signedIn, setSignedIn] = useState<Me | null>(null);

  useNoReferrer();

  const read = useCallback(() => {
    if (token === null) return;
    setStep({ kind: 'reading' });
    void inspectInvitationLink(token).then((result) => {
      setStep(result.kind === 'ok' ? { kind: 'ready', preview: result.preview } : { kind: result.kind });
    });
  }, [token]);

  useEffect(read, [read]);

  useEffect(() => {
    if (token === null) return;
    // Only to warn: a session that cannot be read is no session to replace.
    void fetchCurrentUser()
      .catch(() => null)
      .then(setSignedIn);
  }, [token]);

  return (
    <main className="nv-aura grid min-h-dvh place-items-center px-4 py-10">
      <div className="nv-plate nv-plate--pad flex w-full max-w-sm flex-col gap-6">
        <PublicBrand page={copy.page} />
        {/* Each step comes in on its own; the wordmark stays put. */}
        <div key={step.kind}>{renderStep()}</div>
      </div>
    </main>
  );

  function renderStep(): ReactNode {
    switch (step.kind) {
      case 'reading':
        return (
          <p className="nv-enter flex items-center gap-3 text-[var(--nv-ink-muted)]" role="status">
            <span className="nv-dot nv-dot--live" aria-hidden="true" />
            Lecture du lien…
          </p>
        );
      case 'gone':
        return (
          <Refused
            title="Ce lien ne marche plus"
            action={{ label: 'Aller à la connexion', onClick: onLeave }}
          >
            Demande un nouveau lien à ton responsable.
          </Refused>
        );
      case 'used_by_this_page':
        // An answer lost after the server used the link: the password chosen here is most likely the one saved.
        return (
          <Refused title="Ce lien a déjà servi" action={{ label: 'Aller à la connexion', onClick: onLeave }}>
            Ton mot de passe a sans doute été enregistré à l’essai précédent : connecte-toi avec lui.
          </Refused>
        );
      case 'too_many_attempts':
        return (
          <Refused title="Trop d’essais" action={{ label: 'Réessayer', onClick: read }}>
            Attends quelques minutes, puis réessaie.
          </Refused>
        );
      case 'unavailable':
        return (
          <Refused title="Le serveur ne répond pas" action={{ label: 'Réessayer', onClick: read }}>
            Ton lien n’a pas servi. Réessaie dans un instant.
          </Refused>
        );
      case 'ready':
        return (
          <PasswordForm
            copy={copy}
            preview={step.preview}
            otherAccount={
              signedIn !== null && signedIn.email.toLowerCase() !== step.preview.email.toLowerCase()
                ? signedIn
                : null
            }
            token={token ?? ''}
            onGone={(afterLostAnswer) => {
              setStep({ kind: afterLostAnswer ? 'used_by_this_page' : 'gone' });
            }}
            onSignedIn={onSignedIn}
          />
        );
    }
  }
}

/** These pages send no `Referer`, whatever they load (EQ-10). */
function useNoReferrer(): void {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'referrer';
    meta.content = 'no-referrer';
    document.head.append(meta);
    return () => {
      meta.remove();
    };
  }, []);
}

function Refused({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action: { readonly label: string; readonly onClick: () => void };
}): JSX.Element {
  return (
    <section className="flex flex-col gap-5" role="alert">
      <div className="nv-enter flex items-start gap-4" style={{ '--nv-i': 1 }}>
        <span className="nv-orb nv-tone--warn mt-1 shrink-0" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="text-sm text-[var(--nv-ink-muted)]">{children}</p>
        </div>
      </div>
      <button
        type="button"
        className="nv-btn nv-btn--soft nv-enter"
        style={{ '--nv-i': 2 }}
        onClick={action.onClick}
      >
        {action.label}
      </button>
    </section>
  );
}

/** The server's refusal of a password, in words; the link still works and the member tries again. */
const REFUSED_PASSWORD: Readonly<Record<PasswordInvalidReason, string>> = {
  too_short: `Ce mot de passe est trop court : il faut ${String(PASSWORD_MIN_LENGTH)} caractères au moins.`,
  too_long: `Ce mot de passe est trop long : ${String(PASSWORD_MAX_LENGTH)} caractères au plus.`,
  refused: 'Ce mot de passe est refusé. Choisis-en un autre.',
};

type SendError =
  { readonly kind: 'password'; readonly text: string } | { readonly kind: 'retry'; readonly text: string };

function PasswordForm({
  copy,
  preview,
  otherAccount,
  token,
  onGone,
  onSignedIn,
}: {
  copy: LinkPageCopy;
  preview: InvitationLinkPreview;
  /** Another account signed in on this browser, which the member's session will replace. */
  otherAccount: Me | null;
  token: string;
  /** `afterLostAnswer`: an earlier try from this page got no answer, and may have used the link. */
  onGone: (afterLostAnswer: boolean) => void;
  onSignedIn: (me: Me | null) => void;
}): JSX.Element {
  const [password, setPassword] = useState('');
  const [hasLostAnswer, setHasLostAnswer] = useState(false);
  const [isShown, setIsShown] = useState(false);
  const [error, setError] = useState<SendError | null>(null);
  const [isSending, setIsSending] = useState(false);
  const missing = Math.max(0, PASSWORD_MIN_LENGTH - password.length);

  async function send(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (missing > 0 || isSending) return;
    setIsSending(true);
    setError(null);
    const result = await redeemInvitationLink(token, password);
    setIsSending(false);
    switch (result.kind) {
      case 'ok':
        onSignedIn(result.me);
        return;
      case 'gone':
        onGone(hasLostAnswer);
        return;
      case 'password_refused':
        setError({ kind: 'password', text: REFUSED_PASSWORD[result.reason] });
        return;
      case 'too_many_attempts':
        setError({ kind: 'retry', text: 'Trop d’essais. Attends quelques minutes, puis réessaie.' });
        return;
      case 'unavailable':
        setHasLostAnswer(true);
        setError({ kind: 'retry', text: 'Le serveur ne répond pas. Réessaie dans un instant.' });
    }
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={(event) => void send(event)}>
      <header className="nv-enter flex flex-col gap-2" style={{ '--nv-i': 1 }}>
        {copy.eyebrow === undefined ? null : (
          <p className="text-sm font-medium text-[var(--nv-ink-muted)]">{copy.eyebrow(preview)}</p>
        )}
        <h1 className="text-title-1 font-bold text-balance">{copy.title(preview)}</h1>
        <p className="text-[var(--nv-ink-muted)]">{copy.lead}</p>
      </header>
      <label className="nv-field nv-enter" style={{ '--nv-i': 2 }}>
        <span className="nv-field__label">E-mail</span>
        <input
          className="nv-field__control text-[var(--nv-ink-muted)]"
          name="email"
          type="email"
          autoComplete="username"
          value={preview.email}
          readOnly
        />
      </label>
      <div className="nv-field nv-enter" style={{ '--nv-i': 3 }}>
        <div className="flex items-center justify-between">
          <label className="nv-field__label" htmlFor="link-password">
            {copy.passwordLabel}
          </label>
          <button
            type="button"
            className="nv-btn nv-btn--plain nv-btn--sm"
            aria-pressed={isShown}
            aria-controls="link-password"
            onClick={() => {
              setIsShown(!isShown);
            }}
          >
            {isShown ? 'Masquer' : 'Afficher'}
          </button>
        </div>
        <input
          id="link-password"
          className="nv-field__control"
          name="password"
          type={isShown ? 'text' : 'password'}
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={PASSWORD_MAX_LENGTH}
          required
          autoFocus
          aria-describedby="link-password-hint"
          aria-invalid={error?.kind === 'password'}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            if (error?.kind === 'password') setError(null);
          }}
        />
        {/* One line under the field: the server's refusal takes the place of the length it no longer needs to say. */}
        {error?.kind === 'password' ? (
          <p id="link-password-hint" role="alert" className="text-sm text-[var(--nv-warning)]">
            {error.text}
          </p>
        ) : (
          <p
            id="link-password-hint"
            className={`text-sm ${missing === 0 ? 'text-[var(--nv-success)]' : 'text-[var(--nv-ink-faint)]'}`}
            aria-live="polite"
          >
            {missing === 0
              ? 'C’est bon.'
              : `${String(PASSWORD_MIN_LENGTH)} caractères au moins (encore ${String(missing)}). Une phrase que toi seul connais marche très bien.`}
          </p>
        )}
      </div>
      {error?.kind === 'retry' ? (
        <p role="alert" className="text-sm text-[var(--nv-warning)]">
          {error.text}
        </p>
      ) : null}
      {otherAccount === null ? null : (
        <p className="nv-enter text-sm text-[var(--nv-ink-muted)]" style={{ '--nv-i': 4 }}>
          Ce navigateur est ouvert sur le compte {otherAccount.name}. « {copy.submit} » ouvrira à sa place le
          compte {preview.displayName}.
        </p>
      )}
      <button
        className="nv-btn nv-btn--neon nv-enter"
        style={{ '--nv-i': 4 }}
        type="submit"
        disabled={isSending || missing > 0}
        aria-busy={isSending}
      >
        {isSending ? 'Un instant…' : error?.kind === 'retry' ? 'Réessayer' : copy.submit}
      </button>
      {copy.footnote === undefined ? null : (
        <p className="nv-enter text-center text-sm text-[var(--nv-ink-faint)]" style={{ '--nv-i': 5 }}>
          {copy.footnote}
        </p>
      )}
    </form>
  );
}
