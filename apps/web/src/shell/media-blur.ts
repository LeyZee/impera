import type { Me } from '@impera/contracts';
import { useSyncExternalStore } from 'react';

/**
 * Her media blurred or not on the agency's screens (SC-04 lot c4, ADR 0030 § 4: « affichée floutée par défaut »): a
 * choice of this browser, as Nuit and Jour are, so that the office screen can blur and the phone in hand not. Blurred
 * until it is turned off; anything stored but `off` is blurred. Applied on the root (`data-media-blur`), so that every
 * picture marked `nv-blurrable` follows it at once, and every control that shows it reads the same value.
 */

export const MEDIA_BLUR_KEY = 'impera.media-blur';

/**
 * Who has the switch: those who see her media on the agency's screens, the owner and an active manager (the media and
 * thumbnail routes answer them alone). A chatter and the creator herself would get a switch that changes nothing.
 */
export const seesHerMedia = (user: Pick<Me, 'teamScope'>): boolean =>
  user.teamScope === 'owner' || user.teamScope === 'agency';

/** What a stored value means: blurred unless it says `off` (nothing stored, an old value, storage refused). */
export const parseMediaBlur = (stored: string | null): boolean => stored !== 'off';

/** Storage can throw (private window, blocked site data): the media then stay blurred and the choice lasts the visit. */
function readStored(): string | null {
  try {
    return window.localStorage.getItem(MEDIA_BLUR_KEY);
  } catch {
    return null;
  }
}

let blurred = parseMediaBlur(readStored());
const listeners = new Set<() => void>();

function apply(): void {
  document.documentElement.dataset['mediaBlur'] = blurred ? 'on' : 'off';
}

export function isMediaBlurred(): boolean {
  return blurred;
}

export function setMediaBlur(on: boolean): void {
  blurred = on;
  try {
    window.localStorage.setItem(MEDIA_BLUR_KEY, on ? 'on' : 'off');
  } catch {
    // Not remembered, still applied.
  }
  apply();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The choice, kept in step everywhere it shows (the rail, the phone's sheet, a viewer). */
export function useMediaBlur(): boolean {
  return useSyncExternalStore(subscribe, isMediaBlurred);
}

/** Once, at start: the stored choice applied, and a choice made in another tab of this browser followed. */
export function startMediaBlur(): void {
  blurred = parseMediaBlur(readStored());
  apply();
  window.addEventListener('storage', (event) => {
    if (event.key !== MEDIA_BLUR_KEY) return;
    blurred = parseMediaBlur(event.newValue);
    apply();
    for (const listener of listeners) listener();
  });
}
