import { useEffect, useState, type JSX } from 'react';

import { PublicBrand } from './PublicBrand';
import { addPasskey, gestureName, rememberPasskeyOffered } from './passkeys';

/**
 * « Te connecter avec Face ID la prochaine fois ? » (ADR 0053 § 2), right after the code at sign-in or the activation
 * of the code (recette 27/11, P2), while the session counts as confirmed: asked once on this device, whatever the answer. Nothing biometric leaves the device.
 */
export function PasskeyOffer({ page, onDone }: { page: string; onDone: () => void }): JSX.Element {
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
      <PublicBrand page={page} />
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
