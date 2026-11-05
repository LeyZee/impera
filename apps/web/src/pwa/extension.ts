/**
 * The extension guide (/aide/extension, ADR 0067): which desktop browser opens the page, only to put its steps first,
 * never to allow anything. The file to download is built with the CRM (apps/web/Dockerfile) and served beside it.
 */

export const EXTENSION_ZIP = '/extension/impera.zip';

export type Browser = 'edge' | 'chrome' | 'other';

/** Edge says « Edg/ » in its user agent, besides Chrome's own words; a phone gets « other ». */
export function browserOf(userAgent: string): Browser {
  if (/Android|iPhone|iPad|iPod/u.test(userAgent)) return 'other';
  if (userAgent.includes('Edg/')) return 'edge';
  if (userAgent.includes('Chrome/')) return 'chrome';
  return 'other';
}

/** The popup's default address is localhost (ADR 0066 § 4): only a CRM elsewhere has to be told to it. */
export function isLocalCrm(origin: string): boolean {
  const { hostname } = new URL(origin);
  return hostname === 'localhost' || hostname === '127.0.0.1';
}
