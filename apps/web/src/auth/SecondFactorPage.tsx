import type { SecondFactorSetup } from '@impera/contracts';
import { useEffect, useLayoutEffect, useRef, useState, type JSX, type SyntheticEvent } from 'react';

import { BackupCodesList, CopyButton } from './BackupCodesList';
import { PasskeyOffer } from './PasskeyOffer';
import { PublicBrand } from './PublicBrand';
import { QrCode } from './QrCode';
import { activationStarted, clearActivationStarted, markActivationStarted } from './activation-started';
import { chosenPassword, forgetChosenPassword } from './chosen-password';
import { clearCodesUnconfirmed, markCodesUnconfirmed } from './codes-pending';
import { deviceHoldsPasskeys, passkeyOffered } from './passkeys';
import {
  confirmActivation,
  markFirstStep,
  startActivation,
  type ActivationStart,
  type CodeResult,
} from './session';

type Step =
  | { readonly kind: 'password' }
  | { readonly kind: 'scan'; readonly setup: SecondFactorSetup }
  | { readonly kind: 'codes'; readonly backupCodes: readonly string[] }
  /** Face ID offered right away (recette 27/11, P2): the app to install was the hard part, the gesture is the easy one. */
  | { readonly kind: 'offer' };

const START_MESSAGES: Record<Exclude<ActivationStart['kind'], 'ok'>, string> = {
  wrong_password: 'Ce n’est pas le bon mot de passe.',
  password_needed: 'Confirme ton mot de passe pour continuer.',
  session_expired: 'Ta session a expiré. Reconnecte-toi.',
  too_many_attempts: 'Trop d’essais. Attends une minute avant de réessayer.',
  unavailable: 'Le serveur ne répond pas. Réessaie dans un instant.',
};

const CODE_MESSAGES: Record<Exclude<CodeResult, 'ok'>, string> = {
  wrong_code: 'Ce code ne marche pas. Vérifie l’heure de ton téléphone et recopie le code affiché.',
  expired: 'Ta session a expiré. Reconnecte-toi.',
  locked: 'Trop de codes faux. Réessaie dans un quart d’heure.',
  too_many_attempts: 'Trop d’essais. Attends une minute avant de réessayer.',
  unavailable: 'Le serveur ne répond pas. Réessaie dans un instant.',
};

/** The key an authenticator app reads, by groups of four so that it can be typed without losing one's place. */
export function keyOf(totpUri: string): string {
  const secret = new URL(totpUri).searchParams.get('secret') ?? '';
  return secret.replace(/(.{4})/gu, '$1 ').trim();
}

function fieldOf(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

/**
 * The activation of the second factor (ADR 0046 § 1–2), the only screen of an account whose code is not active yet:
 * the password once more, the key in the authenticator app (a tap on a phone, the key typed elsewhere), a first code,
 * then the ten backup codes, shown this once.
 */
export function SecondFactorPage({
  onActivated,
  onSignOut,
}: {
  onActivated: () => void;
  onSignOut: () => void;
}): JSX.Element {
  const [step, setStep] = useState<Step>({ kind: 'password' });
  // The first step only explains: the password just chosen on the link page serves (recette SEC-15), and without it
  // the server takes a session that has just proven it (recette 27/11, A8). The field comes only when it asks.
  const [asksPassword, setAsksPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A reload at the key, or a return from the authenticator app: the same key comes back, not the first step.
  const [isBusy, setIsBusy] = useState(activationStarted);
  const keyRef = useRef<HTMLElement>(null);
  const stepRef = useRef<HTMLDivElement>(null);

  // Each new step is announced where the eye and a screen reader go: its title takes the focus (the first step's
  // field has it already). In the commit itself, so that nothing the person does next comes before it.
  useLayoutEffect(() => {
    if (step.kind === 'password') return;
    stepRef.current?.querySelector<HTMLElement>('h1')?.focus();
  }, [step.kind]);

  /** Asks for the key; `password` left out when none is at hand. Says what the first step must now show. */
  async function start(password: string | undefined, isHeld: boolean): Promise<void> {
    setIsBusy(true);
    setError(null);
    const result = await startActivation(password).catch((): ActivationStart => ({ kind: 'unavailable' }));
    setIsBusy(false);
    if (result.kind === 'ok') {
      forgetChosenPassword();
      markActivationStarted();
      setStep({ kind: 'scan', setup: result.setup });
      return;
    }
    if (result.kind === 'password_needed' || (isHeld && result.kind === 'wrong_password')) {
      // Proven too long ago, or no longer the account's (changed in between): the field comes, with nothing to
      // blame her for.
      forgetChosenPassword();
      setAsksPassword(true);
      return;
    }
    setError(START_MESSAGES[result.kind]);
  }

  useEffect(() => {
    if (!activationStarted()) return undefined;
    let isGone = false;
    void startActivation()
      .catch((): ActivationStart => ({ kind: 'unavailable' }))
      .then((result) => {
        if (isGone) return;
        setIsBusy(false);
        if (result.kind === 'ok') setStep({ kind: 'scan', setup: result.setup });
        else if (result.kind === 'password_needed') setAsksPassword(true);
        else setError(START_MESSAGES[result.kind]);
      });
    return () => {
      isGone = true;
    };
  }, []);

  async function sendPassword(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (asksPassword) {
      await start(fieldOf(new FormData(event.currentTarget), 'password'), false);
      return;
    }
    const held = chosenPassword();
    await start(held ?? undefined, held !== null);
  }

  const signOut = (): void => {
    clearActivationStarted();
    forgetChosenPassword();
    onSignOut();
  };

  async function sendCode(event: SyntheticEvent<HTMLFormElement>, setup: SecondFactorSetup): Promise<void> {
    event.preventDefault();
    const formElement = event.currentTarget;
    setIsBusy(true);
    setError(null);
    const result = await confirmActivation(fieldOf(new FormData(formElement), 'code')).catch(
      (): CodeResult => 'unavailable',
    );
    setIsBusy(false);
    if (result === 'ok') {
      clearActivationStarted();
      setStep({ kind: 'codes', backupCodes: setup.backupCodes });
      return;
    }
    const field = formElement.elements.namedItem('code');
    if (field instanceof HTMLInputElement) field.value = '';
    setError(CODE_MESSAGES[result]);
  }

  /** After the backup codes: the offer of a key, once per device and only on a device that holds keys. */
  async function codesKept(): Promise<void> {
    // Said on the account: until then, a reload shows the codes again instead of opening the app.
    await markFirstStep('codes-kept');
    if (!passkeyOffered() && (await deviceHoldsPasskeys())) setStep({ kind: 'offer' });
    else onActivated();
  }

  if (step.kind === 'offer') {
    return (
      <main className="nv-aura grid min-h-dvh place-items-center px-4 py-10">
        <PasskeyOffer page="Validation en deux étapes" onDone={onActivated} />
      </main>
    );
  }

  return (
    <main className="nv-aura grid min-h-dvh place-items-center px-4 py-10">
      <div className="nv-plate nv-plate--pad flex w-full max-w-md flex-col gap-6">
        <PublicBrand page="Validation en deux étapes" />
        <div key={step.kind} ref={stepRef} className="flex flex-col gap-5">
          {renderStep()}
        </div>
        {error === null ? null : (
          <p role="alert" className="text-sm text-[var(--nv-warning)]">
            {error}
          </p>
        )}
        {step.kind === 'codes' ? null : (
          <button type="button" className="nv-btn nv-btn--plain nv-btn--sm self-center" onClick={signOut}>
            Se déconnecter
          </button>
        )}
      </div>
    </main>
  );

  function renderStep(): JSX.Element {
    switch (step.kind) {
      case 'password':
        return (
          <form className="flex flex-col gap-5" onSubmit={(event) => void sendPassword(event)}>
            <div className="nv-enter flex flex-col gap-2">
              <h1 className="text-xl font-semibold">Active la validation en deux étapes</h1>
              <p className="text-sm text-[var(--nv-ink-muted)]">
                En plus de ton mot de passe, Impera te demandera un code à 6 chiffres qui change toutes les 30
                secondes. Il s’affiche dans une application d’authentification sur ton téléphone : Google
                Authenticator, Microsoft Authenticator, 1Password, Bitwarden…
              </p>
              <p className="text-sm text-[var(--nv-ink-muted)]">
                {asksPassword
                  ? 'Installe-la, puis confirme ton mot de passe.'
                  : 'Installe-la, puis continue.'}
              </p>
            </div>
            {asksPassword ? (
              <label className="nv-field">
                <span className="nv-field__label">Mot de passe</span>
                <input
                  className="nv-field__control"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  autoFocus
                />
              </label>
            ) : null}
            <button className="nv-btn nv-btn--neon" type="submit" disabled={isBusy} autoFocus={!asksPassword}>
              {isBusy ? 'Préparation…' : 'Continuer'}
            </button>
          </form>
        );
      case 'scan': {
        const { setup } = step;
        return (
          <form className="flex flex-col gap-5" onSubmit={(event) => void sendCode(event, setup)}>
            <div className="nv-enter flex flex-col gap-2">
              <h1 tabIndex={-1} className="text-xl font-semibold outline-none">
                Ajoute Impera dans ton application
              </h1>
              <p className="text-sm text-[var(--nv-ink-muted)]">
                <span className="sm:hidden">
                  Touche le bouton pour ouvrir ton application, ou recopie la clé ci-dessous.
                </span>
                <span className="hidden sm:inline">
                  Scanne le code avec l’application de ton téléphone, ou recopie la clé ci-dessous.
                </span>
              </p>
            </div>
            {/* A computer's screen only: a phone cannot scan itself, its button opens the app (recette 27/11, G7). */}
            <div className="hidden justify-center sm:flex">
              <QrCode text={setup.totpURI} label="Code à scanner avec l’application" />
            </div>
            {/* A phone's screen only: on a computer the address opens nothing (recette 27/11, CH-12). */}
            <a className="nv-btn nv-btn--soft sm:hidden" href={setup.totpURI}>
              Ouvrir dans l’application
            </a>
            <div className="flex flex-col gap-2">
              <span className="nv-field__label">Clé</span>
              <code
                ref={keyRef}
                className="nv-glass rounded-[var(--nv-radius-md)] px-3 py-2 font-mono text-sm break-words select-all"
                aria-label="Clé à recopier dans l’application"
              >
                {keyOf(setup.totpURI)}
              </code>
              <CopyButton
                text={keyOf(setup.totpURI).replace(/\s/gu, '')}
                label="Copier la clé"
                shown={keyRef}
              />
            </div>
            <label className="nv-field">
              <span className="nv-field__label">Code affiché par l’application</span>
              <input
                className="nv-field__control font-mono tracking-[0.2em]"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                placeholder="123 456"
                required
              />
            </label>
            <button className="nv-btn nv-btn--neon" type="submit" disabled={isBusy}>
              {isBusy ? 'Vérification…' : 'Activer'}
            </button>
          </form>
        );
      }
      case 'codes':
        return <BackupCodes codes={step.backupCodes} onDone={() => void codesKept()} />;
      case 'offer':
        // Drawn on its own page above.
        return <></>;
    }
  }
}

/** Ten backup codes, shown once (the shared list), and the person says they are kept before going on. */
export function BackupCodes({
  codes,
  onDone,
}: {
  codes: readonly string[];
  onDone: () => void;
}): JSX.Element {
  const [kept, setKept] = useState(false);
  const leaving = useRef(false);
  // Until they are said kept: leaving asks first, and a reload leaves a mark Sécurité reads (COUV-08).
  useEffect(() => {
    markCodesUnconfirmed();
    const warn = (event: BeforeUnloadEvent): void => {
      if (!leaving.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, []);
  return (
    <>
      <div className="nv-enter flex flex-col gap-2">
        <h1 tabIndex={-1} className="text-xl font-semibold outline-none">
          C’est actif. Note tes codes de secours
        </h1>
        <p className="text-sm text-[var(--nv-ink-muted)]">
          Sans ton téléphone, chacun de ces codes remplace une fois le code de l’application. Ils ne seront
          plus affichés : garde-les dans ton gestionnaire de mots de passe ou sur papier, jamais en photo.
        </p>
      </div>
      <BackupCodesList codes={codes} />
      <label className="flex items-start gap-3 text-sm">
        <input
          className="nv-check"
          type="checkbox"
          checked={kept}
          onChange={(event) => {
            setKept(event.currentTarget.checked);
          }}
        />
        <span>J’ai mis ces codes en lieu sûr.</span>
      </label>
      <button
        type="button"
        className="nv-btn nv-btn--neon"
        disabled={!kept}
        onClick={() => {
          leaving.current = true;
          clearCodesUnconfirmed();
          onDone();
        }}
      >
        Ouvrir Impera
      </button>
    </>
  );
}
