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
    // A labelled region with its buttons; only one sentence is announced, not the whole card (relecture #402).
    <aside className="nv-float nv-update nv-glass nv-glass--thick" aria-label="Nouvelle version de Nirvana">
      <p className="sr-only" role="status">
        Une nouvelle version de Nirvana est prête.
      </p>
      <img className="nv-float__icon" src="/icons/icon-192.png" alt="" width={44} height={44} />
      <div className="nv-float__body">
        <p className="nv-float__title">Nouvelle version de Nirvana</p>
        <p className="nv-float__text">La page se recharge : termine d’abord ce que tu écris.</p>
      </div>
      <div className="nv-float__actions">
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
    </aside>
  );
}
