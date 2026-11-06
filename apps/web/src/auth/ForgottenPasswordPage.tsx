import type { PasswordResetPreview } from '@impera/contracts';
import { useCallback, useEffect, useState, type JSX, type ReactNode, type SyntheticEvent } from 'react';

import { PublicBrand } from './PublicBrand';
import { inspectPasswordReset, redeemPasswordReset, requestPasswordReset, takeLink } from './api';
import { NewPasswordField, REFUSED_PASSWORD, Refused, missingOf, useNoReferrer } from './link-parts';

/** What the sign-in page says once the password is changed (SEC-05 lot 3). */
export const PASSWORD_CHANGED_NOTICE =
  'Mot de passe changé, connecte-toi. Ton code à 6 chiffres reste demandé.';

type Step =
  | { readonly kind: 'ask' }
  | { readonly kind: 'requested'; readonly message: string }
  | { readonly kind: 'reading' }
  | { readonly kind: 'gone' | 'used_by_this_page' | 'too_many_attempts' | 'unavailable' }
  | { readonly kind: 'ready'; readonly preview: PasswordResetPreview };

const two = (n: number): string => String(n).padStart(2, '0');

/** « 15 h 40 », in the browser's time. */
function hourOf(iso: string): string {
  const at = new Date(iso);
  return `${two(at.getHours())} h ${two(at.getMinutes())}`;
}

/**
 * `/mot-de-passe-oublie` (SEC-05 lot 3, ADR 0068): without a link, an address and one button; the link goes to the
 * account's private Telegram chat, never to this page, and the answer is the same whoever asks. With the link
 * (`#t=…`, taken out of the address at once), the new password, then the sign-in page: every session has ended and
 * the code is still asked.
 */
export function ForgottenPasswordPage({
  onLeave,
  onChanged,
}: {
  /** Back to the sign-in page. */
  onLeave: () => void;
  /** The password is changed: the sign-in page says so. */
  onChanged: () => void;
}): JSX.Element {
  const [link] = useState(() => takeLink());
  const [step, setStep] = useState<Step>(() =>
    link.token !== null ? { kind: 'reading' } : { kind: link.present ? 'gone' : 'ask' },
  );
  /** Kept between the request and « Corriger l’adresse ». */
  const [email, setEmail] = useState('');

  useNoReferrer();

  const read = useCallback(() => {
    if (link.token === null) return;
    setStep({ kind: 'reading' });
    void inspectPasswordReset(link.token).then((result) => {
      setStep(result.kind === 'ok' ? { kind: 'ready', preview: result.preview } : { kind: result.kind });
    });
  }, [link.token]);

  useEffect(read, [read]);

  const askAgain = (): void => {
    setStep({ kind: 'ask' });
  };

  return (
    <main className="nv-aura grid min-h-dvh place-items-center px-4 py-10">
      <div className="nv-plate nv-plate--pad flex w-full max-w-sm flex-col gap-6">
        <PublicBrand page={step.kind === 'ready' ? 'Nouveau mot de passe' : 'Mot de passe oublié'} />
        {/* Each step comes in on its own; the wordmark stays put. */}
        <div key={step.kind}>{renderStep()}</div>
      </div>
    </main>
  );

  function renderStep(): ReactNode {
    switch (step.kind) {
      case 'ask':
        return (
          <RequestForm
            email={email}
            onEmail={setEmail}
            onRequested={(message) => {
              setStep({ kind: 'requested', message });
            }}
            onLeave={onLeave}
          />
        );
      case 'requested':
        return (
          <section className="flex flex-col gap-5" role="status">
            <div className="nv-enter flex items-start gap-4" style={{ '--nv-i': 1 }}>
              <span className="nv-orb nv-tone--ok mt-1 shrink-0" aria-hidden="true" />
              <div className="flex flex-col gap-1">
                <h1 className="text-xl font-semibold">Demande reçue</h1>
                <p className="text-sm text-[var(--nv-ink-muted)]">{step.message}</p>
              </div>
            </div>
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-enter"
              style={{ '--nv-i': 2 }}
              onClick={onLeave}
            >
              Retour à la connexion
            </button>
            <button
              type="button"
              className="nv-btn nv-btn--plain nv-btn--sm nv-enter self-center"
              style={{ '--nv-i': 3 }}
              onClick={askAgain}
            >
              Corriger l’adresse
            </button>
          </section>
        );
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
            action={{ label: 'Demander un nouveau lien', onClick: askAgain }}
            secondary={{ label: 'Aller à la connexion', onClick: onLeave }}
          >
            Il a déjà servi, un plus récent l’a remplacé, ou ses 15 minutes sont passées.
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
          <ResetForm
            preview={step.preview}
            token={link.token ?? ''}
            onGone={(afterLostAnswer) => {
              setStep({ kind: afterLostAnswer ? 'used_by_this_page' : 'gone' });
            }}
            onChanged={onChanged}
          />
        );
    }
  }
}

/** One address, one button; nothing here checks the address, so nothing says whether an account has it. */
function RequestForm({
  email,
  onEmail,
  onRequested,
  onLeave,
}: {
  email: string;
  onEmail: (email: string) => void;
  onRequested: (message: string) => void;
  onLeave: () => void;
}): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const isEmpty = email.trim() === '';

  async function send(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isEmpty || isSending) return;
    setIsSending(true);
    setError(null);
    const result = await requestPasswordReset(email.trim());
    setIsSending(false);
    if (result.kind === 'requested') onRequested(result.message);
    else if (result.kind === 'too_many_attempts') {
      setError('Trop de demandes d’un coup : réessaie dans quelques minutes.');
    } else setError('Le serveur ne répond pas. Réessaie dans un instant.');
  }

  return (
    // No check of the browser's either: its bubble would say more than the server's one sentence.
    <form className="flex flex-col gap-5" noValidate onSubmit={(event) => void send(event)}>
      <header className="nv-enter flex flex-col gap-2" style={{ '--nv-i': 1 }}>
        <h1 className="text-title-1 font-bold text-balance">Mot de passe oublié</h1>
        <p className="text-[var(--nv-ink-muted)]">
          Donne l’adresse e-mail de ton compte. Le lien pour en choisir un nouveau part dans ton chat Telegram
          privé, celui que tu as relié dans Sécurité.
        </p>
      </header>
      <label className="nv-field nv-enter" style={{ '--nv-i': 2 }}>
        <span className="nv-field__label">E-mail</span>
        <input
          className="nv-field__control"
          name="email"
          type="email"
          autoComplete="username"
          autoFocus
          value={email}
          onChange={(event) => {
            onEmail(event.target.value);
            setError(null);
          }}
        />
      </label>
      {error === null ? null : (
        <p role="alert" className="text-sm text-[var(--nv-warning)]">
          {error}
        </p>
      )}
      <button
        className="nv-btn nv-btn--neon nv-enter"
        style={{ '--nv-i': 3 }}
        type="submit"
        disabled={isSending || isEmpty}
        aria-busy={isSending}
      >
        {isSending ? 'Un instant…' : 'Envoyer le lien'}
      </button>
      <button
        type="button"
        className="nv-btn nv-btn--plain nv-btn--sm nv-enter self-center"
        style={{ '--nv-i': 4 }}
        onClick={onLeave}
      >
        Retour à la connexion
      </button>
    </form>
  );
}

type SendError =
  { readonly kind: 'password'; readonly text: string } | { readonly kind: 'retry'; readonly text: string };

/** The new password, under the account's address and until when the link is valid; the same rules as EQ-10. */
function ResetForm({
  preview,
  token,
  onGone,
  onChanged,
}: {
  preview: PasswordResetPreview;
  token: string;
  /** `afterLostAnswer`: an earlier try from this page got no answer, and may have used the link. */
  onGone: (afterLostAnswer: boolean) => void;
  onChanged: () => void;
}): JSX.Element {
  const [password, setPassword] = useState('');
  const [hasLostAnswer, setHasLostAnswer] = useState(false);
  const [error, setError] = useState<SendError | null>(null);
  const [isSending, setIsSending] = useState(false);
  const missing = missingOf(password);

  async function send(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (missing > 0 || isSending) return;
    setIsSending(true);
    setError(null);
    const result = await redeemPasswordReset(token, password);
    setIsSending(false);
    switch (result.kind) {
      case 'ok':
        onChanged();
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
      case 'password_check_unavailable':
        setError({
          kind: 'retry',
          text: 'La vérification de ton mot de passe ne répond pas. Réessaie dans un instant, ton lien reste valable.',
        });
        return;
      case 'unavailable':
        setHasLostAnswer(true);
        setError({ kind: 'retry', text: 'Le serveur ne répond pas. Réessaie dans un instant.' });
    }
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={(event) => void send(event)}>
      <header className="nv-enter flex flex-col gap-2" style={{ '--nv-i': 1 }}>
        <h1 className="text-title-1 font-bold text-balance">Nouveau mot de passe</h1>
        <p className="text-[var(--nv-ink-muted)]">
          Choisis-en un nouveau. Tous tes appareils seront déconnectés, celui-ci compris.
        </p>
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
        <NewPasswordField
          id="reset-password"
          label="Nouveau mot de passe"
          value={password}
          refusal={error?.kind === 'password' ? error.text : null}
          onChange={(value) => {
            setPassword(value);
            if (error?.kind === 'password') setError(null);
          }}
        />
      </div>
      {error?.kind === 'retry' ? (
        <p role="alert" className="text-sm text-[var(--nv-warning)]">
          {error.text}
        </p>
      ) : null}
      <button
        className="nv-btn nv-btn--neon nv-enter"
        style={{ '--nv-i': 4 }}
        type="submit"
        disabled={isSending || missing > 0}
        aria-busy={isSending}
      >
        {isSending ? 'Un instant…' : error?.kind === 'retry' ? 'Réessayer' : 'Enregistrer'}
      </button>
      <p className="nv-enter text-center text-sm text-[var(--nv-ink-faint)]" style={{ '--nv-i': 5 }}>
        Lien valable jusqu’à <span className="nv-num">{hourOf(preview.expiresAt)}</span>
      </p>
    </form>
  );
}
