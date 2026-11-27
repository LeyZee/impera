import { useEffect, useId, useRef, type JSX, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { useRevealAlerts } from './reveal';

import { cn } from '@/lib/utils';

import './dialog.css';

/**
 * The app's floating panel, born on the planning (a new shift, one shift) and used by every screen since: the one
 * glass of the screen, modal, its focus kept inside, closed by Échap, by a tap outside or by its ×, and the focus
 * given back to what opened it. Its styles are `dialog.css`, beside it.
 *
 * The glass does not scroll: its content does, inside it (`tm-dialog__scroll`), so the glass's rim stays on the edge of
 * the panel instead of crossing what scrolls; and a message about what failed is brought into view when it appears.
 */
export function Dialog({
  title,
  lead,
  busy = false,
  className,
  onClose,
  children,
}: {
  title: ReactNode;
  lead?: ReactNode;
  /** While a write is under way, nothing closes it. */
  busy?: boolean;
  /** A screen's own width or layout for its panel (Paie's statement). */
  className?: string;
  onClose: () => void;
  children: ReactNode;
}): JSX.Element {
  const id = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useRevealAlerts(scroller);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // A tall dialog opens at its top, even when the field it focuses is lower down (a statement's « Valider »).
    // With nothing to focus but its ×, the dialog takes the focus itself, so Échap reaches it (recette 16/11, CHT-20).
    (
      dialog.current?.querySelector<HTMLElement>('[data-autofocus], select, input, button:not(.tm-close)') ??
      dialog.current
    )?.focus({ preventScroll: true });
    return () => {
      opener?.focus();
      guardClicksAfterClose();
    };
  }, []);

  const close = (): void => {
    if (!busy) onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab' || dialog.current === null) return;
    const focusable = [
      ...dialog.current.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input, select, textarea',
      ),
    ];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (document.activeElement === dialog.current) {
      // From the glass itself, Tab enters the window at either end, never the page behind it.
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return createPortal(
    <div
      className="tm-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialog}
        className={cn('nv-glass nv-glass--float tm-dialog', className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div ref={scroller} className="tm-dialog__scroll">
          <header className="tm-dialog__head">
            <div className="tm-dialog__title">
              <h2 className="nv-h2" id={`${id}-title`}>
                {title}
              </h2>
              {lead === undefined ? null : <p>{lead}</p>}
            </div>
            <button type="button" className="tm-close" aria-label="Fermer" disabled={busy} onClick={close}>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="m4 4 8 8M12 4l-8 8" />
              </svg>
            </button>
          </header>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** How long, once a panel closes, a click still belongs to it: the second half of a double click or tap. */
export const CLOSE_GUARD_MS = 400;

/**
 * Whether a click is the end of the gesture that closed a panel rather than a new one: a person's click (never one a
 * script dispatches) within `CLOSE_GUARD_MS` of the close.
 */
export const isClickThrough = (click: { readonly isTrusted: boolean }, sinceClose: number): boolean =>
  click.isTrusted && sinceClose >= 0 && sinceClose < CLOSE_GUARD_MS;

/**
 * A double click on a panel's last button closes it on the first click: the second would land on what lies under it, a
 * link or a switch (recette CHAT-05, MOD-10). For a moment after the close, such a click is swallowed. No timer: the
 * listener leaves at the first click past the moment, so nothing fires once the page is gone (a test's teardown).
 */
function guardClicksAfterClose(): void {
  const closedAt = performance.now();
  const swallow = (event: MouseEvent): void => {
    const since = performance.now() - closedAt;
    if (since >= CLOSE_GUARD_MS) {
      window.removeEventListener('click', swallow, true);
      return;
    }
    if (!isClickThrough(event, since)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener('click', swallow, true);
}
