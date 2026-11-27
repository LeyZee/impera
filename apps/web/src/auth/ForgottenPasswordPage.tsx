import type { PasswordResetPreview } from '@impera/contracts';
import { useCallback, useEffect, useState, type JSX, type ReactNode, type SyntheticEvent } from 'react';

import { PublicBrand } from './PublicBrand';
import { inspectPasswordReset, redeemPasswordReset, takeLink } from './api';
import { NewPasswordField, REFUSED_PASSWORD, Refused, missingOf, useNoReferrer } from './link-parts';

/** What the sign-in page says once the password is changed (SEC-05 lot 3). */
export const PASSWORD_CHANGED_NOTICE =
  'Mot de passe changé, connecte-toi. Ton code à 6\u00a0chiffres reste demandé.';

type Step =
  | { readonly kind: 'ask' }
  | { readonly kind: 'reading' }
  | { readonly kind: 'gone' | 'used_by_this_page' | 'too_many_attempts' | 'unavailable' }
  | { readonly kind: 'ready'; readonly preview: PasswordResetPreview };

const two = (n: number): string => String(n).padStart(2, '0');

/** A number and its unit stay on one line (« 15 minutes », « 6 chiffres »). */
export function keepUnits(text: string): string {
  return text.replace(/(\d) (?=\p{L})/gu, '$1\u00a0');
}

/** « 15 h 40 », in the browser's time. */
function hourOf(iso: string): string {
  const at = new Date(iso);
  return `${two(at.getHours())}\u00a0h\u00a0${two(at.getMinutes())}`;
}

/**
 * `/mot-de-passe-oublie` (SEC-05 lot 3, ADR 0068, amended 27/11/2026): without a link, where to get one, since the page
 * no longer sends any (Telegram serves the creators' channels only): a member from the agency (Équipe, EQ-10), an
 * owner from the server. With the link
 * (`#t=…`, taken out of the address at once), the new password, then the sign-in page: every session has ended and
 * the code is still asked.
 */
export function ForgottenPasswordPage({
  onLeave,
  onChanged,
}: {
  /** Back to the sign-in page. */
  onLeave: () => void;
  /** The password is changed for this address: the sign-in page says so, with the address filled in. */
  onChanged: (email: string) => void;
}): JSX.Element {
  const [link] = useState(() => takeLink());
  const [step, setStep] = useState<Step>(() =>
    link.token !== null ? { kind: 'reading' } : { kind: link.present ? 'gone' : 'ask' },
  );
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
        return <NoLink onLeave={onLeave} />;
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
            action={{ label: 'Avoir un nouveau lien', onClick: askAgain }}
            secondary={{ label: 'Retour à la connexion', onClick: onLeave }}
          >
            Il a déjà servi, un plus récent l’a remplacé, ou ses 15&nbsp;minutes sont passées.
          </Refused>
        );
      case 'used_by_this_page':
        // An answer lost after the server used the link: the password chosen here is most likely the one saved.
        return (
          <Refused title="Ce lien a déjà servi" action={{ label: 'Retour à la connexion', onClick: onLeave }}>
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

/**
 * No link: where one comes from. Nothing to type here, so nothing here says whether an account has an address.
 */
function NoLink({ onLeave }: { onLeave: () => void }): JSX.Element {
  return (
    <section className="flex flex-col gap-5">
      <header className="nv-enter flex flex-col gap-2" style={{ '--nv-i': 1 }}>
        <h1 className="text-title-1 font-bold text-balance">Mot de passe oublié</h1>
        <p>Demande un nouveau lien à ton agence. Il vaut {keepUnits('15 minutes')} et sert une fois.</p>
      </header>
      <p className="nv-enter text-sm text-[var(--nv-ink-faint)]" style={{ '--nv-i': 2 }}>
        Tu es propriétaire&nbsp;: le lien se fait sur le serveur, par qui le gère.
      </p>
      <button
        type="button"
        className="nv-btn nv-btn--soft nv-enter"
        style={{ '--nv-i': 3 }}
        onClick={onLeave}
      >
        Retour à la connexion
      </button>
    </section>
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
  onChanged: (email: string) => void;
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
        onChanged(preview.email);
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
          className="nv-field__control nv-field__control--readonly"
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
