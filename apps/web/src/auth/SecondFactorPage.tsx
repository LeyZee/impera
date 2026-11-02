import type { SecondFactorSetup } from '@nirvana/contracts';
import { useState, type JSX, type SyntheticEvent } from 'react';

import { PublicBrand } from './PublicBrand';
import { confirmActivation, startActivation, type ActivationStart, type CodeResult } from './session';

type Step =
  | { readonly kind: 'password' }
  | { readonly kind: 'scan'; readonly setup: SecondFactorSetup }
  | { readonly kind: 'codes'; readonly backupCodes: readonly string[] };

const START_MESSAGES: Record<Exclude<ActivationStart['kind'], 'ok'>, string> = {
  wrong_password: 'Ce n’est pas le bon mot de passe.',
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
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function sendPassword(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setIsBusy(true);
    setError(null);
    const result = await startActivation(fieldOf(form, 'password')).catch((): ActivationStart => ({
      kind: 'unavailable',
    }));
    setIsBusy(false);
    if (result.kind === 'ok') setStep({ kind: 'scan', setup: result.setup });
    else setError(START_MESSAGES[result.kind]);
  }

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
      setStep({ kind: 'codes', backupCodes: setup.backupCodes });
      return;
    }
    const field = formElement.elements.namedItem('code');
    if (field instanceof HTMLInputElement) field.value = '';
    setError(CODE_MESSAGES[result]);
  }

  return (
    <main className="nv-aura grid min-h-dvh place-items-center px-4 py-10">
      <div className="nv-plate nv-plate--pad flex w-full max-w-md flex-col gap-6">
        <PublicBrand page="Validation en deux étapes" />
        <div key={step.kind} className="flex flex-col gap-5">
          {renderStep()}
        </div>
        {error === null ? null : (
          <p role="alert" className="text-sm text-[var(--nv-warning)]">
            {error}
          </p>
        )}
        {step.kind === 'codes' ? null : (
          <button type="button" className="nv-btn nv-btn--plain nv-btn--sm self-center" onClick={onSignOut}>
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
                En plus de ton mot de passe, Nirvana te demandera un code à 6 chiffres qui change toutes les
                30 secondes. Il s’affiche dans une application d’authentification sur ton téléphone : Google
                Authenticator, Microsoft Authenticator, 1Password, Bitwarden…
              </p>
              <p className="text-sm text-[var(--nv-ink-muted)]">
                Installe-la, puis confirme ton mot de passe.
              </p>
            </div>
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
            <button className="nv-btn nv-btn--neon" type="submit" disabled={isBusy}>
              {isBusy ? 'Préparation…' : 'Continuer'}
            </button>
          </form>
        );
      case 'scan': {
        const { setup } = step;
        return (
          <form className="flex flex-col gap-5" onSubmit={(event) => void sendCode(event, setup)}>
            <div className="nv-enter flex flex-col gap-2">
              <h1 className="text-xl font-semibold">Ajoute Nirvana dans ton application</h1>
              <p className="text-sm text-[var(--nv-ink-muted)]">
                Sur ton téléphone, touche le bouton. Sur un ordinateur, choisis « Saisir une clé » dans
                l’application et recopie celle-ci.
              </p>
            </div>
            <a className="nv-btn nv-btn--soft" href={setup.totpURI}>
              Ouvrir dans l’application
            </a>
            <div className="flex flex-col gap-2">
              <span className="nv-field__label">Clé</span>
              <code
                className="nv-glass rounded-[var(--nv-radius-md)] px-3 py-2 font-mono text-sm break-all select-all"
                aria-label="Clé à recopier dans l’application"
              >
                {keyOf(setup.totpURI)}
              </code>
              <CopyButton text={keyOf(setup.totpURI).replace(/\s/gu, '')} label="Copier la clé" />
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
        return <BackupCodes codes={step.backupCodes} onDone={onActivated} />;
    }
  }
}

/** Ten backup codes, shown once: copied, saved as a file, and the person says they are kept before going on. */
function BackupCodes({ codes, onDone }: { codes: readonly string[]; onDone: () => void }): JSX.Element {
  const [kept, setKept] = useState(false);
  const text = `Nirvana : codes de secours (chacun ne sert qu’une fois)\n\n${codes.join('\n')}\n`;
  return (
    <>
      <div className="nv-enter flex flex-col gap-2">
        <h1 className="text-xl font-semibold">C’est actif. Note tes codes de secours</h1>
        <p className="text-sm text-[var(--nv-ink-muted)]">
          Sans ton téléphone, chacun de ces codes remplace une fois le code de l’application. Ils ne seront
          plus affichés : garde-les dans ton gestionnaire de mots de passe ou sur papier, jamais en photo.
        </p>
      </div>
      <ul
        className="nv-glass grid grid-cols-2 gap-x-6 gap-y-2 rounded-[var(--nv-radius-md)] px-4 py-3 font-mono text-sm"
        aria-label="Codes de secours"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={text} label="Copier les codes" />
        <button
          type="button"
          className="nv-btn nv-btn--soft nv-btn--sm"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = 'nirvana-codes-de-secours.txt';
            link.click();
            URL.revokeObjectURL(url);
          }}
        >
          Enregistrer en fichier
        </button>
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input
          className="mt-1"
          type="checkbox"
          checked={kept}
          onChange={(event) => {
            setKept(event.currentTarget.checked);
          }}
        />
        <span>J’ai mis ces codes en lieu sûr.</span>
      </label>
      <button type="button" className="nv-btn nv-btn--neon" disabled={!kept} onClick={onDone}>
        Ouvrir Nirvana
      </button>
    </>
  );
}

function CopyButton({ text, label }: { text: string; label: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="nv-btn nv-btn--soft nv-btn--sm self-start"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true);
          },
          () => undefined,
        );
      }}
    >
      {copied ? 'Copié' : label}
    </button>
  );
}
