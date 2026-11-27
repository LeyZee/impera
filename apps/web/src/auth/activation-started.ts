/*
 * The activation of the code reached its key (recette 27/11, A8): a reload there, or a return from the authenticator
 * app, comes back to the key instead of the first step. Only a mark in this tab's session storage, never the key nor
 * the codes: the server gives those back. Storage may be refused (a private window): the first step shows, as before.
 */

const KEY = 'impera.activationStarted';

export function markActivationStarted(): void {
  try {
    window.sessionStorage.setItem(KEY, '1');
  } catch {
    // Storage refused: a reload starts from the first step.
  }
}

export function clearActivationStarted(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Storage refused: there is no mark to clear.
  }
}

export function activationStarted(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
