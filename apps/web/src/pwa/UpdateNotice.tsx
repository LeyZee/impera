import { useState, useSyncExternalStore, type JSX } from 'react';

import { applyUpdate, onUpdateReady, updateReady } from './serviceWorker';

/**
 * « Nouvelle version de Nirvana » (CR-01): offered, never imposed. « Plus tard » hides it for this visit; the
 * version waits and is offered again at the next opening.
 */
export function UpdateNotice(): JSX.Element | null {
  const ready = useSyncExternalStore(onUpdateReady, updateReady, () => false);
  const [later, setLater] = useState(false);
  if (!ready || later) return null;
  return (
    <div className="nv-update nv-glass nv-glass--thick" role="status" aria-live="polite">
      <img className="nv-update__icon" src="/icons/icon-192.png" alt="" width={40} height={40} />
      <div className="nv-update__body">
        <p className="nv-update__title">Nouvelle version de Nirvana</p>
        <p className="nv-update__text">La page se recharge : termine d’abord ce que tu écris.</p>
      </div>
      <div className="nv-update__actions">
        <button
          type="button"
          className="nv-btn nv-btn--sm nv-btn--plain"
          onClick={() => {
            setLater(true);
          }}
        >
          Plus tard
        </button>
        <button type="button" className="nv-btn nv-btn--sm nv-btn--neon" onClick={applyUpdate}>
          Mettre à jour
        </button>
      </div>
    </div>
  );
}
