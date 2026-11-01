import { useEffect, useId, useRef, type JSX, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/utils';

/**
 * The floating panel of the planning (a new shift, one shift): the one glass of the screen, modal, its focus kept
 * inside, closed by Échap, by a tap outside or by its ×, and the focus given back to what opened it.
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

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // A tall dialog opens at its top, even when the field it focuses is lower down (a statement's « Valider »).
    dialog.current
      ?.querySelector<HTMLElement>('[data-autofocus], select, input, button:not(.tm-close)')
      ?.focus({ preventScroll: true });
    return () => {
      opener?.focus();
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
    if (event.shiftKey && document.activeElement === first) {
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
        onKeyDown={onKeyDown}
      >
        <header className="tm-dialog__head">
          <div className="tm-dialog__title">
            <h2 id={`${id}-title`}>{title}</h2>
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
    </div>,
    document.body,
  );
}
