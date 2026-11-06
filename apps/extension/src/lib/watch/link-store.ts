import { ExtensionLinkTokenSchema } from '@impera/contracts';
import { browser } from 'wxt/browser';

/**
 * The person's watch link (VEI-01 « Relier l'extension », ADR 0066 § 7): the code pasted once in the popup's « Relier »,
 * kept in `chrome.storage.local` and read by the service worker alone. The popup hands it over and never reads it
 * back; the reader on instagram.com never touches storage. Removing the link in the CRM makes it worthless: the next
 * call answers 401, and the popup offers to paste a new code.
 */

const TOKEN_KEY = 'watchLink';
const REVOKED_KEY = 'watchLinkRevoked';

export type LinkState = 'none' | 'linked' | 'revoked';

/** Storage of the extension's own pages and worker only, where the browser allows it (Chrome 102+). */
export async function restrictToTrustedContexts(): Promise<void> {
  await browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => undefined);
}

export async function readLink(): Promise<string | null> {
  const stored: Record<string, unknown> = await browser.storage.local.get(TOKEN_KEY).catch(() => ({}));
  const token = ExtensionLinkTokenSchema.safeParse(stored[TOKEN_KEY]);
  return token.success ? token.data : null;
}

export async function linkState(): Promise<LinkState> {
  const stored: Record<string, unknown> = await browser.storage.local
    .get([TOKEN_KEY, REVOKED_KEY])
    .catch(() => ({}));
  if (stored[REVOKED_KEY] === true) return 'revoked';
  return ExtensionLinkTokenSchema.safeParse(stored[TOKEN_KEY]).success ? 'linked' : 'none';
}

export async function saveLink(token: string): Promise<void> {
  await browser.storage.local.set({
    [TOKEN_KEY]: ExtensionLinkTokenSchema.parse(token),
    [REVOKED_KEY]: false,
  });
}

/** The CRM answered 401: the code is dropped, and the popup says it was removed. */
export async function markRevoked(): Promise<void> {
  await browser.storage.local.remove(TOKEN_KEY);
  await browser.storage.local.set({ [REVOKED_KEY]: true });
}

export async function forgetLink(): Promise<void> {
  await browser.storage.local.remove([TOKEN_KEY, REVOKED_KEY]);
}
