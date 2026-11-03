/**
 * The address of the CRM the popup reads the session from (ADR 0066 § 4). Kept in chrome.storage.local: an address,
 * not a secret. Plain HTTP only on this computer; anywhere else the session cookie must travel over HTTPS.
 */

export const DEFAULT_CRM_ADDRESS = 'http://localhost:5173';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
/** Two labels at least, letters, digits and hyphens: what a deployed CRM's address looks like. */
const DNS_NAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;

/** The origin an address names, or null if it cannot be a CRM: not a web address, or plain HTTP off this computer. */
export function crmOriginOf(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed)
    ? trimmed
    : `${LOCAL_HOSTS.has(trimmed.split(/[:/]/u)[0] ?? '') ? 'http' : 'https'}://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.username !== '' || url.password !== '') return null;
  // Chrome percent-encodes what a host cannot hold (« crm impera » → crm%20impera): only plain DNS names pass.
  if (!LOCAL_HOSTS.has(url.hostname) && !DNS_NAME.test(url.hostname)) return null;
  if (url.protocol === 'https:') return url.origin;
  if (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)) return url.origin;
  return null;
}

/** Whether the manifest already lets the popup read this origin (localhost), with no question from the browser. */
export function isGrantedAtInstall(origin: string): boolean {
  return LOCAL_HOSTS.has(new URL(origin).hostname) && origin.startsWith('http://');
}

/** The match pattern the browser is asked for: this site alone, every path. */
export function permissionPatternOf(origin: string): string {
  return `${origin}/*`;
}

/** The address as the footer shows it: no scheme, no trailing slash. */
export function shortAddress(origin: string): string {
  return origin.replace(/^https?:\/\//u, '');
}
