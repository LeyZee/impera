import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_DISTINCT,
  PASSWORD_MIN_LENGTH,
  type PasswordInvalidReason,
} from '@impera/contracts';
import { useEffect, useState, type JSX, type ReactNode } from 'react';

/**
 * What the one-time link pages share (EQ-10, SEC-05 lot 3): no `Referer`, the same refusal, the same password field
 * and the same words for a password the server refuses.
 */

/** These pages send no `Referer`, whatever they load (EQ-10). */
export function useNoReferrer(): void {
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

interface RefusedAction {
  readonly label: string;
  readonly onClick: () => void;
}

/** A link the page cannot use, said once, with the way out under it. */
export function Refused({
  title,
  children,
  action,
  secondary,
}: {
  title: string;
  children: ReactNode;
  action: RefusedAction;
  /** A quieter second way out, under the first. */
  secondary?: RefusedAction;
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
      {secondary === undefined ? null : (
        <button
          type="button"
          className="nv-btn nv-btn--plain nv-btn--sm nv-enter self-center"
          style={{ '--nv-i': 3 }}
          onClick={secondary.onClick}
        >
          {secondary.label}
        </button>
      )}
    </section>
  );
}

/** The server's refusal of a password, in words; the link still works and the member tries again. */
export const REFUSED_PASSWORD: Readonly<Record<PasswordInvalidReason, string>> = {
  too_short: `Ce mot de passe est trop court : il faut ${String(PASSWORD_MIN_LENGTH)} caractères au moins.`,
  too_long: `Ce mot de passe est trop long : ${String(PASSWORD_MAX_LENGTH)} caractères au plus.`,
  too_plain: `Ce mot de passe est trop simple : ${String(PASSWORD_MIN_LENGTH)} caractères hors espaces, dont ${String(PASSWORD_MIN_DISTINCT)} différents au moins.`,
  breached: 'Ce mot de passe circule déjà dans des fuites de données connues. Choisis-en un autre.',
  refused: 'Ce mot de passe est refusé. Choisis-en un autre.',
};

/** How many characters the password still lacks; 0 once it is long enough to send. */
export function missingOf(password: string): number {
  return Math.max(0, PASSWORD_MIN_LENGTH - password.length);
}

/**
 * The new password, with « Afficher » beside its label and one line under it: what it still lacks, or the server's
 * refusal in place of the length it no longer needs to say.
 */
export function NewPasswordField({
  id,
  label,
  value,
  refusal,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  /** The server's refusal of the last password sent, in words. */
  refusal: string | null;
  onChange: (value: string) => void;
}): JSX.Element {
  const [isShown, setIsShown] = useState(false);
  const missing = missingOf(value);
  const hint = `${id}-hint`;
  return (
    <>
      <div className="flex items-center justify-between">
        <label className="nv-field__label" htmlFor={id}>
          {label}
        </label>
        <button
          type="button"
          className="nv-btn nv-btn--plain nv-btn--sm"
          aria-pressed={isShown}
          aria-controls={id}
          onClick={() => {
            setIsShown(!isShown);
          }}
        >
          {isShown ? 'Masquer' : 'Afficher'}
        </button>
      </div>
      <input
        id={id}
        className="nv-field__control"
        name="password"
        type={isShown ? 'text' : 'password'}
        autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH}
        maxLength={PASSWORD_MAX_LENGTH}
        required
        autoFocus
        aria-describedby={hint}
        aria-invalid={refusal !== null}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {refusal === null ? (
        <p
          id={hint}
          className={`text-sm ${missing === 0 ? 'text-[var(--nv-success)]' : 'text-[var(--nv-ink-faint)]'}`}
          aria-live="polite"
        >
          {missing === 0
            ? 'C’est bon.'
            : `${String(PASSWORD_MIN_LENGTH)} caractères au moins (encore ${String(missing)}). Une phrase que toi seul connais marche très bien.`}
        </p>
      ) : (
        <p id={hint} role="alert" className="text-sm text-[var(--nv-warning)]">
          {refusal}
        </p>
      )}
    </>
  );
}
