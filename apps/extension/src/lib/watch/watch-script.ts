import { browser } from 'wxt/browser';

/**
 * Where the watch's reader runs (VEI-02, ADR 0060 § 1): instagram.com, asked of the browser at the first « Veille »
 * (`optional_host_permissions`), so installing the extension asks nothing about Instagram. The reader is registered
 * then, at run time, in the extension's isolated world (never `MAIN`), top frame only, and never on messages, stories
 * or account pages. No file of the extension is exposed to the page (no `web_accessible_resources`).
 */

export const INSTAGRAM_PATTERN = 'https://www.instagram.com/*';

export const WATCH_SCRIPT = {
  id: 'impera-watch',
  js: ['/watch.js'],
  matches: [INSTAGRAM_PATTERN],
  excludeMatches: [
    'https://www.instagram.com/direct/*',
    'https://www.instagram.com/stories/*',
    'https://www.instagram.com/accounts/*',
  ],
  allFrames: false,
  runAt: 'document_idle',
  world: 'ISOLATED',
  persistAcrossSessions: true,
} as const;

export async function instagramAllowed(): Promise<boolean> {
  return browser.permissions.contains({ origins: [INSTAGRAM_PATTERN] }).catch(() => false);
}

/** Registers the reader once Instagram is allowed; unregisters it if the permission was taken back. */
export async function syncWatchScript(): Promise<void> {
  const allowed = await instagramAllowed();
  const registered = await browser.scripting
    .getRegisteredContentScripts({ ids: [WATCH_SCRIPT.id] })
    .catch(() => []);
  if (allowed && registered.length === 0) {
    await browser.scripting
      .registerContentScripts([
        {
          ...WATCH_SCRIPT,
          js: [...WATCH_SCRIPT.js],
          matches: [...WATCH_SCRIPT.matches],
          excludeMatches: [...WATCH_SCRIPT.excludeMatches],
        },
      ])
      .catch(() => undefined);
  }
  if (!allowed && registered.length > 0) {
    await browser.scripting.unregisterContentScripts({ ids: [WATCH_SCRIPT.id] }).catch(() => undefined);
  }
}

/** Puts the reader in a tab opened before Instagram was allowed (the registered script runs from the next load). */
export async function injectInto(tabId: number): Promise<boolean> {
  return browser.scripting
    .executeScript({ target: { tabId, allFrames: false }, files: [...WATCH_SCRIPT.js], world: 'ISOLATED' })
    .then(() => true)
    .catch(() => false);
}
