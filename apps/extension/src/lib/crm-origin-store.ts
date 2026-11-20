import { browser } from 'wxt/browser';

import { builtInCrmOf } from './built-in-crm';
import { crmOriginOf, DEFAULT_CRM_ADDRESS } from './crm-address';

/** The CRM address saved in the popup (ADR 0066 § 4), read by the popup, the copilot panel and the service worker. */
export const ADDRESS_KEY = 'crmOrigin';

/**
 * The address this build was made for (ADR 0067, second amendement), null on Charles's computer and in development.
 * The build already refused a bad one: this reads it back.
 */
export const BUILT_IN_CRM: string | null = builtInCrmOf(__IMPERA_BUILT_IN_CRM__);

async function readSaved(): Promise<string | null> {
  const stored: Record<string, unknown> = await browser.storage.local.get(ADDRESS_KEY).catch(() => ({}));
  const value = stored[ADDRESS_KEY];
  return typeof value === 'string' ? crmOriginOf(value) : null;
}

/**
 * The address in force, or null when none is (the popup then opens on its welcome, EXT-07): a saved one first, then the
 * built-in one. A saved address equal to the built-in one is never kept (`saveOrigin`), so a saved one is a change.
 */
export async function activeOrigin(builtIn: string | null = BUILT_IN_CRM): Promise<string | null> {
  return (await readSaved()) ?? builtIn;
}

/** The address the CRM is read at; this computer's when none is in force. */
export async function storedOrigin(builtIn: string | null = BUILT_IN_CRM): Promise<string> {
  return (await activeOrigin(builtIn)) ?? DEFAULT_CRM_ADDRESS;
}

/** Saves an address; the built-in one is not saved but the saved one removed, so that it is in force again. */
export function saveOrigin(origin: string, builtIn: string | null = BUILT_IN_CRM): Promise<void> {
  return origin === builtIn
    ? browser.storage.local.remove(ADDRESS_KEY)
    : browser.storage.local.set({ [ADDRESS_KEY]: origin });
}
