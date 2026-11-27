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

/**
 * Whether the extension this CRM serves was built with its own address (ADR 0067, second amendement): the image passes
 * the same deployment value to both builds. Then the extension is linked from the install, and the guide has no link
 * step to show; without it, or for another address, the step stays.
 */
export function extensionKnowsThisCrm(origin: string = window.location.origin): boolean {
  const builtIn: unknown = import.meta.env['VITE_EXTENSION_CRM_ORIGIN'];
  return typeof builtIn === 'string' && builtIn.trim().replace(/\/$/u, '') === origin;
}
