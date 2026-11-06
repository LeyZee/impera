import { PASSWORD_RESET_PAGE, isBackupCode } from '@impera/contracts';
import { useEffect, useState, type JSX, type SyntheticEvent } from 'react';

import { PublicBrand } from './PublicBrand';
import {
  addPasskey,
  canUsePasskeys,
  deviceHoldsPasskeys,
  gestureName,
  passkeyOffered,
  rememberPasskeyOffered,
  signInWithPasskey,
  type PasskeySignInResult,
} from './passkeys';
import { normalizeCode, signIn, verifySignInCode, type CodeResult, type SignInResult } from './session';

const MESSAGES: Record<Exclude<SignInResult, 'ok' | 'code_required'>, string> = {
  wrong_credentials: 'E-mail ou mot de passe incorrect.',
  too_many_attempts: 'Trop de tentatives. Réessaie dans un quart d’heure.',
  unavailable: 'Le serveur ne répond pas. Réessaie dans un instant.',
};

const CODE_MESSAGES: Record<Exclude<CodeResult, 'ok' | 'expired'>, string> = {
  wrong_code: 'Ce code ne marche pas. Vérifie l’heure de ton téléphone et réessaie.',
  locked: 'Trop de codes faux. Réessaie dans un quart d’heure.',
  too_many_attempts: 'Trop d’essais. Attends une minute avant de réessayer.',
  unavailable: 'Le serveur ne répond pas. Réessaie dans un instant.',
};

/** A wrong backup code: the clock of a phone she does not have at hand is beside the point. */
const WRONG_BACKUP_CODE = 'Ce code de secours ne marche pas, ou il a déjà servi. Chacun ne sert qu’une fois.';

const PASSKEY_MESSAGES: Record<Exclude<PasskeySignInResult, 'ok' | 'cancelled'>, string> = {
  refused: 'Cette clé n’ouvre aucun compte. Connecte-toi avec ton e-mail, ton mot de passe et ton code.',
  too_many_attempts: MESSAGES.too_many_attempts,
  unavailable: MESSAGES.unavailable,
};

function fieldOf(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

/**
 * The only public screen: email and password on a plate, one neon action, the error said plainly in amber (a warning:
 * the red stays the urgencies'). For an account whose code is active, a second step asks for it (ADR 0046): the
 * authenticator's 6 digits or a backup code, and whether to trust this device for 30 days. A browser that can make a
 * gesture also offers a passkey (ADR 0053): one gesture, no password, no code; after a sign-in by the code, a device
 * that holds keys is asked once whether to add one.
 */
export function SignInPage({
  onSignedIn,
  notice = null,
  confirmation = null,
  email = null,
}: {
  onSignedIn: () => void;
  /** Why the page is shown again, when the session ended while the app was open (recette 05/11, SEC-01). */
  notice?: string | null;
  /** What just went well before it: a new password chosen from the « mot de passe oublié » link (SEC-05 lot 3). */
  confirmation?: string | null;
  /** The account's address when it is already known (that same link): filled in, and the password asked first. */
  email?: string | null;
}): JSX.Element {
  const [step, setStep] = useState<'password' | 'code' | 'offer'>('password');
  // The notice stands in the error's place until the first try, which says its own.
  const [error, setError] = useState<string | null>(notice);
  const [done, setDone] = useState<string | null>(confirmation);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [withPasskey] = useState(canUsePasskeys);

  async function passkey(): Promise<void> {
    setIsSubmitting(true);
    setError(null);
    setDone(null);
    const result = await signInWithPasskey().catch((): PasskeySignInResult => 'unavailable');
    setIsSubmitting(false);
    if (result === 'ok') onSignedIn();
    // A closed Face ID is the person's choice: nothing to say.
    else if (result !== 'cancelled') setError(PASSKEY_MESSAGES[result]);
  }

  /** After the code: the offer to add a key, once per device and only on a device that holds keys. */
  async function codeGiven(): Promise<void> {
    if (!passkeyOffered() && (await deviceHoldsPasskeys())) setStep('offer');
    else onSignedIn();
  }

  async function submit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setIsSubmitting(true);
    setError(null);
    setDone(null);
    const result = await signIn(fieldOf(form, 'email'), fieldOf(form, 'password')).catch(
      (): SignInResult => 'unavailable',
    );
    setIsSubmitting(false);
    if (result === 'ok') onSignedIn();
    else if (result === 'code_required') setStep('code');
    else setError(MESSAGES[result]);
  }

  return (
    <main className="nv-aura grid min-h-dvh place-items-center px-4">
      {step === 'offer' ? (
        <PasskeyOffer onDone={onSignedIn} />
      ) : step === 'code' ? (
        <CodeStep
          onSignedIn={() => void codeGiven()}
          onExpired={() => {
            setStep('password');
            setError('La vérification a expiré. Reconnecte-toi.');
          }}
        />
      ) : (
        <form
          className="nv-plate nv-plate--pad flex w-full max-w-sm flex-col gap-5"
          onSubmit={(event) => void submit(event)}
        >
          <PublicBrand page="Connexion" />
          <h1 className="sr-only">Connexion</h1>
          {/* Said first, before the fields it is about: what just went well, until the first try. */}
          {done === null ? null : (
            <p role="status" className="nv-enter flex items-start gap-3 text-sm">
              <span className="nv-orb nv-tone--ok mt-0.5 shrink-0" aria-hidden="true" />
              <span>{done}</span>
            </p>
          )}
          <label className="nv-field">
            <span className="nv-field__label">E-mail</span>
            <input
              className="nv-field__control"
              name="email"
              type="email"
              autoComplete="username"
              required
              defaultValue={email ?? undefined}
              autoFocus={email === null}
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
              autoFocus={email !== null}
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
          {withPasskey ? (
            <button
              className="nv-btn nv-btn--soft"
              type="button"
              disabled={isSubmitting}
              onClick={() => void passkey()}
            >
              Se connecter avec {gestureName()}
            </button>
          ) : null}
          {/* A page of its own, opened as any address: the link to it can be kept or shared. */}
          <a className="nv-btn nv-btn--plain nv-btn--sm self-center" href={PASSWORD_RESET_PAGE}>
            Mot de passe oublié ?
          </a>
        </form>
      )}
    </main>
  );
}

/** The code step: the app's 6 digits, or a backup code when the phone is not at hand. */
function CodeStep({ onSignedIn, onExpired }: { onSignedIn: () => void; onExpired: () => void }): JSX.Element {
  const [backup, setBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setIsSubmitting(true);
    setError(null);
    const code = normalizeCode(fieldOf(form, 'code'));
    // A backup code typed in the app's field is still a backup code: its shape picks the check, not the button.
    const isBackup = isBackupCode(code);
    const result = await verifySignInCode(code, {
      backup: isBackup,
      trustDevice: form.get('trust') === 'on',
    }).catch((): CodeResult => 'unavailable');
    setIsSubmitting(false);
    if (result === 'ok') {
      onSignedIn();
      return;
    }
    if (result === 'expired') {
      onExpired();
      return;
    }
    const field = formElement.elements.namedItem('code');
    if (field instanceof HTMLInputElement) {
      field.value = '';
      field.focus();
    }
    setError(result === 'wrong_code' && isBackup ? WRONG_BACKUP_CODE : CODE_MESSAGES[result]);
  }

  return (
    <form
      className="nv-plate nv-plate--pad flex w-full max-w-sm flex-col gap-5"
      onSubmit={(event) => void submit(event)}
    >
      <PublicBrand page="Connexion" />
      <div className="nv-enter flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{backup ? 'Code de secours' : 'Code de connexion'}</h1>
        <p className="text-sm text-[var(--nv-ink-muted)]">
          {backup
            ? 'Un des dix codes notés à l’activation, recopié avec ses majuscules et ses minuscules. Chacun ne sert qu’une fois.'
            : 'Ouvre ton application d’authentification et recopie le code à 6 chiffres d’Impera.'}
        </p>
      </div>
      <label className="nv-field">
        <span className="nv-field__label">{backup ? 'Code de secours' : 'Code à 6 chiffres'}</span>
        <input
          key={backup ? 'backup' : 'app'}
          className="nv-field__control font-mono tracking-[0.2em]"
          name="code"
          type="text"
          inputMode={backup ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={13}
          placeholder={backup ? 'xxxxx-xxxxx' : '123 456'}
          required
          autoFocus
          aria-invalid={error !== null}
        />
      </label>
      <label className="flex items-start gap-3 text-sm text-[var(--nv-ink-muted)]">
        <input className="mt-1" type="checkbox" name="trust" />
        <span>Se souvenir de cet appareil 30 jours. Le code restera demandé avant une action sensible.</span>
      </label>
      {error === null ? null : (
        <p role="alert" className="text-sm text-[var(--nv-warning)]">
          {error}
        </p>
      )}
      <button className="nv-btn nv-btn--neon" type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Vérification…' : 'Valider'}
      </button>
      <button
        type="button"
        className="nv-btn nv-btn--plain nv-btn--sm self-center"
        onClick={() => {
          setBackup((value) => !value);
          setError(null);
        }}
      >
        {backup ? 'Utiliser le code de l’application' : 'Pas ton téléphone ? Utiliser un code de secours'}
      </button>
    </form>
  );
}

/**
 * « Te connecter avec Face ID la prochaine fois ? » (ADR 0053 § 2), right after the code, while the session counts as
 * confirmed: asked once on this device, whatever the answer. Nothing biometric leaves the device.
 */
function PasskeyOffer({ onDone }: { onDone: () => void }): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const gesture = gestureName();

  useEffect(() => {
    rememberPasskeyOffered();
  }, []);

  async function add(): Promise<void> {
    setIsAdding(true);
    setError(null);
    const result = await addPasskey().catch(() => ({ kind: 'unavailable' as const }));
    setIsAdding(false);
    if (result.kind === 'ok' || result.kind === 'already') {
      onDone();
      return;
    }
    if (result.kind === 'cancelled') return;
    setError(
      result.kind === 'refused'
        ? 'Cet appareil n’a pas demandé ton visage, ton doigt ou son code : la clé n’a pas été ajoutée.'
        : 'La clé n’a pas pu être ajoutée. Tu pourras réessayer depuis Sécurité.',
    );
  }

  return (
    <section
      className="nv-plate nv-plate--pad flex w-full max-w-sm flex-col gap-5"
      aria-labelledby="nv-offer"
    >
      <PublicBrand page="Connexion" />
      <div className="nv-enter flex flex-col gap-1">
        <h1 id="nv-offer" className="text-xl font-semibold">
          Te connecter avec {gesture} la prochaine fois&nbsp;?
        </h1>
        <p className="text-sm text-[var(--nv-ink-muted)]">
          Un geste suffira, sans mot de passe ni code. Ton visage ou ton empreinte restent sur cet
          appareil&nbsp;: Impera n’en voit rien.
        </p>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-sm text-[var(--nv-warning)]">
          {error}
        </p>
      )}
      <button className="nv-btn nv-btn--neon" type="button" disabled={isAdding} onClick={() => void add()}>
        {isAdding ? 'Ajout…' : 'Oui, activer'}
      </button>
      <button
        className="nv-btn nv-btn--plain nv-btn--sm self-center"
        type="button"
        disabled={isAdding}
        onClick={onDone}
      >
        Plus tard
      </button>
      <p className="text-center text-sm text-[var(--nv-ink-faint)]">
        Tu pourras l’ajouter à tout moment dans Sécurité.
      </p>
    </section>
  );
}
