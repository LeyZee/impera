import { useState, type JSX } from 'react';

import { closeCare } from './api';
import { careSinceText } from './reader-model';

/**
 * His care mode, at the top of the conversation (ADR 0088, trou béant 4): since when, what it means, and « Il va
 * mieux » for whoever reads the whole creator (the owner, an active manager), asked twice since it lets the agent
 * answer him alone again. A chatter reads it without the button: the server refuses him too.
 */
export function CareBanner({
  creatorId,
  conversationId,
  since,
  canClose,
  onClosed,
}: {
  creatorId: string;
  conversationId: string;
  since: string;
  canClose: boolean;
  onClosed: () => Promise<void>;
}): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = async (): Promise<void> => {
    setPending(true);
    setError(null);
    const result = await closeCare(creatorId, conversationId);
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setConfirming(false);
    await onClosed();
  };

  return (
    <div className="tr-hand tr-hand--alert tr-care" role="status">
      <p>
        <strong>{careSinceText(since, new Date())}</strong>
        <span>
          Il traverse un moment difficile : chaque réponse de l’agent attend un humain, et rien ne lui est
          vendu.
        </span>
      </p>
      {canClose ? (
        confirming ? (
          <div className="tr-care__confirm">
            <p>
              L’agent lui répondra de nouveau seul. Ses ventes restent gelées et rien d’explicite, jusqu’à ce
              que tu lèves ses limites.
            </p>
            <div className="tr-care__actions">
              <button
                type="button"
                className="nv-btn nv-btn--sm nv-btn--soft"
                disabled={pending}
                onClick={() => void close()}
              >
                {pending ? 'Envoi au serveur…' : 'Oui, il va mieux'}
              </button>
              <button
                type="button"
                className="nv-btn nv-btn--sm nv-btn--plain"
                disabled={pending}
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Annuler
              </button>
            </div>
          </div>
        ) : (
          <div className="tr-care__actions">
            <button
              type="button"
              className="nv-btn nv-btn--sm nv-btn--soft"
              onClick={() => {
                setConfirming(true);
              }}
            >
              Il va mieux
            </button>
          </div>
        )
      ) : (
        <p className="nv-meta">Seuls le propriétaire et un manager peuvent dire qu’il va mieux.</p>
      )}
      {error === null ? null : (
        <p className="tr-warn tr-line" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
