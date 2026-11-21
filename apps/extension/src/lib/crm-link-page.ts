/**
 * The CRM's page « Relier l'extension à ce CRM » (ADR 0067, amendement du 19/11) as the popup sees it: only the
 * address of the open tab, never what the page shows. The popup offers to link itself to that CRM when the tab is
 * exactly on that page, on a safe origin, and only while no address was ever saved.
 */

/** The page of the CRM that offers the link, and the guide the tab goes back to once it is done. */
const LINK_PATH = '/extension/lier';
export const GUIDE_PATH = '/aide/extension';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
/** Letters, digits and hyphens, two labels at least, no final dot: a deployed CRM's name, in ASCII. */
const DNS_NAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;

export interface LinkOffer {
  /** The origin the popup will save, as the browser parsed it. */
  readonly origin: string;
  /** The host as the popup shows it, in full and in ASCII; null on this computer. */
  readonly host: string | null;
}

/**
 * The link the open tab offers, or null. Refused: anything but the exact path (case and final slash included), plain
 * HTTP off this computer, another port than the default one, credentials in the address, a name that is not plain
 * ASCII (the browser writes it `xn--…`), an IP address other than 127.0.0.1, a final dot.
 */
export function linkOfferOf(tabUrl: string | undefined): LinkOffer | null {
  if (tabUrl === undefined) return null;
  let url: URL;
  try {
    url = new URL(tabUrl);
  } catch {
    return null;
  }
  if (url.pathname !== LINK_PATH) return null;
  if (url.username !== '' || url.password !== '') return null;
  if (LOCAL_HOSTS.has(url.hostname)) {
    return url.protocol === 'http:' || url.protocol === 'https:' ? { origin: url.origin, host: null } : null;
  }
  if (url.protocol !== 'https:' || url.port !== '') return null;
  if (!DNS_NAME.test(url.hostname)) return null;
  if (url.hostname.split('.').some((label) => label.startsWith('xn--'))) return null;
  return { origin: url.origin, host: url.hostname };
}
