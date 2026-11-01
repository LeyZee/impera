import { useEffect, useState, type JSX, type RefObject } from 'react';

import './SaveBar.css';

/**
 * Whether an element is on screen. Without `IntersectionObserver` (an old browser, the tests), it counts as seen:
 * nothing then doubles it.
 */
export function useOnScreen(ref: RefObject<HTMLElement | null>): boolean {
  const [seen, setSeen] = useState(true);
  useEffect(() => {
    const element = ref.current;
    if (element === null || typeof IntersectionObserver !== 'function') return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries.at(-1);
      if (entry !== undefined) setSeen(entry.isIntersecting);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return seen;
}

/**
 * The save of a long sheet, kept at hand (recette 28/10, CREA-20): pinned to the bottom of the screen while the sheet
 * holds changes and its head, with the same buttons, has scrolled away. Never both at once: one neon on screen.
 */
export function SaveBar({
  show,
  warn,
  text,
  saveLabel,
  saving,
  blocked,
  onReset,
  onSave,
}: {
  show: boolean;
  /** Something to fix first: the dot is amber, and the save stays shut. */
  warn: boolean;
  /** What waits: « 2 modifications », « Une ligne à corriger ». */
  text: string;
  saveLabel: string;
  saving: boolean;
  /** Why saving is not possible now, or null when it is. */
  blocked: string | null;
  onReset: () => void;
  onSave: () => void;
}): JSX.Element | null {
  if (!show) return null;
  return (
    <div className="nv-glass nv-glass--float cr-savebar" role="region" aria-label="Modifications en attente">
      <span className="ps-dot" data-dot={warn ? 'warn' : 'ok'} />
      <span className="cr-savebar__text" aria-live="polite">
        {text}
      </span>
      <span className="cr-savebar__actions">
        {saving ? null : (
          <button
            type="button"
            className="nv-btn nv-btn--plain nv-btn--sm cr-savebar__reset"
            onClick={onReset}
          >
            Tout annuler
          </button>
        )}
        <button
          type="button"
          className="nv-btn nv-btn--neon nv-btn--sm"
          disabled={blocked !== null || saving}
          title={blocked ?? undefined}
          aria-busy={saving}
          onClick={onSave}
        >
          {saving ? 'Enregistrement…' : saveLabel}
        </button>
      </span>
    </div>
  );
}
