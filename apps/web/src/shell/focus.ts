import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/** What Tab can reach in a dialog: links, enabled fields and buttons, a <summary>, and anything given a tab stop. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * The `onKeyDown` of a modal dialog: Tab and Shift+Tab go round its own controls and never leave it for the page
 * under it (WAI-ARIA dialog pattern).
 */
export function keepTabInside(event: ReactKeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Tab') return;
  const all = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const head = all[0];
  const tail = all[all.length - 1];
  if (head === undefined || tail === undefined) return;
  if (event.shiftKey && document.activeElement === head) {
    event.preventDefault();
    tail.focus();
  } else if (!event.shiftKey && document.activeElement === tail) {
    event.preventDefault();
    head.focus();
  }
}
