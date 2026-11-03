/** What the open tab is, for the card under the account (ADR 0066 § 6). The URL comes from activeTab, never stored. */
export type Place = 'reveal' | 'instagram' | 'crm' | 'elsewhere';

function hostIs(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function placeOf(url: string | undefined, crmOrigin: string): Place {
  if (url === undefined) return 'elsewhere';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'elsewhere';
  }
  if (parsed.origin === crmOrigin) return 'crm';
  if (parsed.protocol !== 'https:') return 'elsewhere';
  if (hostIs(parsed.hostname, 'reveal.me')) return 'reveal';
  if (hostIs(parsed.hostname, 'instagram.com')) return 'instagram';
  return 'elsewhere';
}
