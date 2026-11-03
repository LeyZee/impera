/**
 * The theme of the CRM, chosen in Réglages › Apparence: Nuit (the default), Jour, or as the device is set.
 * The choice belongs to the browser, not to the account: the office screen can be in Jour and the phone in Nuit.
 * `public/appearance.js`, loaded first by `index.html`, applies it before the first paint with the same key (a test
 * keeps both in step).
 */

export const APPEARANCES = ['night', 'day', 'device'] as const;
export type Appearance = (typeof APPEARANCES)[number];

export const APPEARANCE_KEY = 'impera.appearance';
const LIGHT_QUERY = '(prefers-color-scheme: light)';

/** What a stored value means: anything unknown (nothing stored, an old value) is the default, Nuit. */
export function parseAppearance(stored: string | null): Appearance {
  return APPEARANCES.find((appearance) => appearance === stored) ?? 'night';
}

/** Whether the page shows Jour. */
export function isDay(appearance: Appearance, deviceIsLight: boolean): boolean {
  return appearance === 'day' || (appearance === 'device' && deviceIsLight);
}

/** Storage can throw (private window, blocked site data): the CRM then stays in Nuit and the choice lasts the visit. */
function readStored(): string | null {
  try {
    return window.localStorage.getItem(APPEARANCE_KEY);
  } catch {
    return null;
  }
}

export function readAppearance(): Appearance {
  return parseAppearance(readStored());
}

/**
 * The colour of the browser's bar (and of the installed app's status bar) in each theme: `--nv-void`, as in
 * `public/appearance.js` and the manifest.
 */
export const THEME_COLORS = { night: '#060508', day: '#f6f1f3' } as const;

function apply(appearance: Appearance): void {
  const root = document.documentElement;
  const day = isDay(appearance, window.matchMedia(LIGHT_QUERY).matches);
  if (day) {
    root.dataset['theme'] = 'light';
  } else {
    delete root.dataset['theme'];
  }
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', day ? THEME_COLORS.day : THEME_COLORS.night);
}

let current: Appearance = 'night';

export function setAppearance(appearance: Appearance): void {
  current = appearance;
  try {
    window.localStorage.setItem(APPEARANCE_KEY, appearance);
  } catch {
    // Not remembered, still applied.
  }
  apply(appearance);
}

/** Once, at start: applies the stored choice and follows the device when it switches between light and dark. */
export function startAppearance(): void {
  current = readAppearance();
  apply(current);
  window.matchMedia(LIGHT_QUERY).addEventListener('change', () => {
    apply(current);
  });
}
