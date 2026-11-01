import { useState, type JSX, type SyntheticEvent } from 'react';

import { PublicBrand } from './PublicBrand';
import { signIn, type SignInResult } from './session';

const MESSAGES: Record<Exclude<SignInResult, 'ok'>, string> = {
  wrong_credentials: 'E-mail ou mot de passe incorrect.',
  too_many_attempts: 'Trop de tentatives. Réessaie dans un quart d’heure.',
  unavailable: 'Le serveur ne répond pas. Réessaie dans un instant.',
};

/**
 * The only public screen: email and password on a plate, one neon action, the error said plainly in amber (a warning:
 * the red stays the urgencies').
 */
export function SignInPage({ onSignedIn }: { onSignedIn: () => void }): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string): string => {
      const value = form.get(name);
      return typeof value === 'string' ? value : '';
    };
    setIsSubmitting(true);
    setError(null);
    const result = await signIn(field('email'), field('password')).catch((): SignInResult => 'unavailable');
    setIsSubmitting(false);
    if (result === 'ok') onSignedIn();
    else setError(MESSAGES[result]);
  }

  return (
    <main className="nv-aura grid min-h-dvh place-items-center px-4">
      <form
        className="nv-plate nv-plate--pad flex w-full max-w-sm flex-col gap-5"
        onSubmit={(event) => void submit(event)}
      >
        <PublicBrand page="Connexion" />
        <h1 className="sr-only">Connexion</h1>
        <label className="nv-field">
          <span className="nv-field__label">E-mail</span>
          <input
            className="nv-field__control"
            name="email"
            type="email"
            autoComplete="username"
            required
            autoFocus
          />
        </label>
        <label className="nv-field">
          <span className="nv-field__label">Mot de passe</span>
          <input
            className="nv-field__control"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        {error === null ? null : (
          <p role="alert" className="text-sm text-[var(--nv-warning)]">
            {error}
          </p>
        )}
        <button className="nv-btn nv-btn--neon" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Connexion…' : 'Se connecter'}
        </button>
        <p className="text-center text-sm text-[var(--nv-ink-faint)]">
          Mot de passe oublié ? Demande un nouveau lien à la personne qui gère ton accès.
        </p>
      </form>
    </main>
  );
}
