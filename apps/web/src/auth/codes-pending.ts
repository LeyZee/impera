/*
 * Backup codes shown at the activation and not yet said kept (COUV-08): a reload on that screen opens the app, and the
 * codes are never shown again. A mark in this tab's session storage (never the codes themselves) lets Sécurité say so
 * until new ones are made and kept. Storage may be refused (a private window): nothing is said then, nothing breaks.
 */

const KEY = 'impera.backupCodesUnconfirmed';

export function markCodesUnconfirmed(): void {
  try {
    window.sessionStorage.setItem(KEY, '1');
  } catch {
    // Storage refused: the screen still asks before it is left.
  }
}

export function clearCodesUnconfirmed(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Storage refused: there is no mark to clear.
  }
}

export function codesUnconfirmed(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
