/**
 * The install guide (CR-01): Impera on the home screen, which an iPhone needs to receive notifications. Offered on a
 * phone that does not run the installed app, once per opening, and never again after three « Plus tard ». The
 * count is a convenience of this browser (localStorage); without storage, it is offered once per opening.
 */

export const INSTALL_REFUSALS_KEY = 'impera.install.refusals';
export const MAX_REFUSALS = 3;

export type Platform = 'ios' | 'android' | 'other';

/** The phone's family, from the user agent: only to choose which steps to show, never to allow anything. */
export function platformOf(userAgent: string, maxTouchPoints: number): Platform {
  if (['iPhone', 'iPad', 'iPod'].some((device) => userAgent.includes(device))) return 'ios';
  // iPadOS presents itself as a Mac, with touch.
  if (userAgent.includes('Macintosh') && maxTouchPoints > 1) return 'ios';
  if (userAgent.includes('Android')) return 'android';
  return 'other';
}

export function parseRefusals(stored: string | null): number {
  const count = Number.parseInt(stored ?? '', 10);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

export interface NudgeInput {
  readonly platform: Platform;
  readonly standalone: boolean;
  readonly refusals: number;
  readonly dismissedThisOpening: boolean;
}

/** Whether the card shows: a phone, not the installed app, not refused three times, not dismissed this opening. */
export function shouldNudge({ platform, standalone, refusals, dismissedThisOpening }: NudgeInput): boolean {
  return platform !== 'other' && !standalone && refusals < MAX_REFUSALS && !dismissedThisOpening;
}

/** Whether the page runs as the installed app (Android and desktop, then iPhone's own flag). */
export function isStandalone(): boolean {
  if (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches)
    return true;
  return 'standalone' in navigator && navigator.standalone === true;
}

export function readRefusals(): number {
  try {
    return parseRefusals(window.localStorage.getItem(INSTALL_REFUSALS_KEY));
  } catch {
    return 0;
  }
}

export function addRefusal(): void {
  try {
    window.localStorage.setItem(INSTALL_REFUSALS_KEY, String(readRefusals() + 1));
  } catch {
    // Not remembered: offered again at the next opening, still never twice in one.
  }
}

/** Chrome's own install prompt (Android), kept from the moment the browser offers it until the person asks. */
export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function isInstallPrompt(event: Event): event is InstallPromptEvent {
  return 'prompt' in event && typeof event.prompt === 'function';
}

/** Once, at start: keeps the browser's install prompt instead of letting it show on its own. */
export function captureInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    if (!isInstallPrompt(event)) return;
    event.preventDefault();
    deferred = event;
    for (const listener of listeners) listener();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    for (const listener of listeners) listener();
  });
}

export function canPromptInstall(): boolean {
  return deferred !== null;
}

export function onInstallPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Opens Chrome's install dialog; true when the person installed. */
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (event === null) return false;
  deferred = null;
  for (const listener of listeners) listener();
  await event.prompt();
  return (await event.userChoice).outcome === 'accepted';
}
