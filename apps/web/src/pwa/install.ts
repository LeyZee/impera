/**
 * The install guide (CR-01): Impera on the home screen, which an iPhone needs to receive notifications. Offered on a
 * phone that does not run the installed app, once per opening, and never again after three « Plus tard ». The
 * count is a convenience of this browser (localStorage); without storage, it is offered once per opening.
 */

export const INSTALL_REFUSALS_KEY = 'impera.install.refusals';
/** Set once this device is known to have the app: never offered again on it (choice of 21/11). */
export const INSTALLED_KEY = 'impera.install.installed';
export const MAX_REFUSALS = 3;

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

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
  /** The app is known to be installed on this device, even when this page runs in the browser. */
  readonly installed?: boolean;
}

/**
 * Whether the card shows: a phone, not the installed app nor a device known to have it, not refused three times, not
 * dismissed this opening.
 */
export function shouldNudge({
  platform,
  standalone,
  refusals,
  dismissedThisOpening,
  installed = false,
}: NudgeInput): boolean {
  return (
    platform !== 'other' && !standalone && !installed && refusals < MAX_REFUSALS && !dismissedThisOpening
  );
}

/** Whether the page runs as the installed app (Android and desktop, then iPhone's own flag). */
export function isStandalone(): boolean {
  if (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches)
    return true;
  return 'standalone' in navigator && navigator.standalone === true;
}

/**
 * What this browser knows of an install on the device. The installed app remembers itself at each opening, Chrome
 * says `appinstalled`, and `getInstalledRelatedApps` answers where it exists (Chrome on Android). An iPhone's Safari
 * knows none of it: its home-screen app keeps its own storage, and Safari has neither the event nor the question.
 */
export function readInstalled(): boolean {
  try {
    return window.localStorage.getItem(INSTALLED_KEY) === '1';
  } catch {
    return false;
  }
}

let installedThisOpening = false;

function rememberInstalled(): void {
  installedThisOpening = true;
  try {
    window.localStorage.setItem(INSTALLED_KEY, '1');
  } catch {
    // Not remembered: this opening still knows it.
  }
  for (const listener of listeners) listener();
}

/** Whether the app is installed on this device, as far as this page can know. */
export function isInstalled(): boolean {
  return installedThisOpening || isStandalone() || readInstalled();
}

/** `navigator.getInstalledRelatedApps`, where the browser has it (Chrome on Android). */
interface RelatedAppsNavigator {
  getInstalledRelatedApps?: () => Promise<readonly unknown[]>;
}

/** Asks the browser whether the app is installed (it finds it through the manifest's `related_applications`). */
async function askRelatedApps(): Promise<void> {
  const nav: Navigator & RelatedAppsNavigator = navigator;
  if (typeof nav.getInstalledRelatedApps !== 'function') return;
  try {
    const apps = await nav.getInstalledRelatedApps();
    if (apps.length > 0) rememberInstalled();
  } catch {
    // The browser would not say: nothing known.
  }
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
    rememberInstalled();
  });
  // The installed app tells the browser's tabs of the same storage (Android) that it is there.
  if (isStandalone()) rememberInstalled();
  else void askRelatedApps();
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
  const accepted = (await event.userChoice).outcome === 'accepted';
  if (accepted) rememberInstalled();
  return accepted;
}
