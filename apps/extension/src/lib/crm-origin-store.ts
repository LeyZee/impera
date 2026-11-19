import { browser } from 'wxt/browser';

import { crmOriginOf, DEFAULT_CRM_ADDRESS } from './crm-address';

/** The CRM address saved in the popup (ADR 0066 § 4), read by the popup and the copilot panel alike. */
export const ADDRESS_KEY = 'crmOrigin';

export async function storedOrigin(): Promise<string> {
  const stored: Record<string, unknown> = await browser.storage.local.get(ADDRESS_KEY).catch(() => ({}));
  const value = stored[ADDRESS_KEY];
  return typeof value === 'string' ? (crmOriginOf(value) ?? DEFAULT_CRM_ADDRESS) : DEFAULT_CRM_ADDRESS;
}

/** The address as saved, or null when none ever was: the popup then opens on its welcome (EXT-07). */
export async function savedOrigin(): Promise<string | null> {
  const stored: Record<string, unknown> = await browser.storage.local.get(ADDRESS_KEY).catch(() => ({}));
  const value = stored[ADDRESS_KEY];
  return typeof value === 'string' ? crmOriginOf(value) : null;
}
