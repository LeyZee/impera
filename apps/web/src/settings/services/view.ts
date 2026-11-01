import type { ProviderNextAction, ProviderStatus } from '@nirvana/contracts';

import { GUIDES, isDashboardProvider, type DashboardProvider } from './guide';

/** Small view rules of the Services section, kept out of the components so they are tested. */

/** « vérifié à l'instant », « vérifié il y a 12 min », « vérifié il y a 3 h ». */
export function checkedAgo(verifiedAt: string | null, now: Date): string | null {
  if (verifiedAt === null) return null;
  const minutes = Math.floor((now.getTime() - new Date(verifiedAt).getTime()) / 60_000);
  if (minutes < 1) return 'vérifié à l’instant';
  if (minutes < 60) return `vérifié il y a ${String(minutes)} min`;
  return `vérifié il y a ${String(Math.floor(minutes / 60))} h`;
}

/** A key read from the environment (development only) works: the page must not say the agent is stopped. */
function isFromEnvironment(status: ProviderStatus): boolean {
  return status.source === 'environment';
}

/** A service that can write in Grok's place: Mistral, then Venice. */
const RELAYS = ['mistral', 'venice'] as const;
const RELAY_NAMES: Record<(typeof RELAYS)[number], string> = { mistral: 'Mistral', venice: 'Venice' };

const isWorking = (status: ProviderStatus): boolean =>
  isFromEnvironment(status) || status.state === 'connected' || status.state === 'low_credit';

/**
 * The title at the top. Grok's key refused says what it means for the agent, from the states on the same page:
 * without a working relay the agent writes no more; with one, the relay writes instead (recette du 29/10, REG-02).
 * Any other action keeps the server's words.
 */
export function leadOf(next: ProviderNextAction, services: readonly ProviderStatus[]): string {
  if (next.kind !== 'replace_key' || next.provider !== 'xai') return next.lead;
  const grok = services.find((s) => s.provider === 'xai');
  const relay = RELAYS.find((provider) => services.some((s) => s.provider === provider && isWorking(s)));
  if (relay === undefined) {
    const why =
      grok?.isUnreadable === true ? 'Nirvana ne peut plus lire la clé de Grok' : 'xAI refuse la clé de Grok';
    return `L’agent n’écrit plus : ${why} et aucun relais n’est branché.`;
  }
  return grok?.isUnreadable === true
    ? next.lead
    : `xAI refuse la clé. ${RELAY_NAMES[relay]} écrit à la place de Grok.`;
}

/**
 * The line of the service the top already explains, in two words: the full sentence is in the title just above
 * (REG-04). `null`: the row keeps its own line.
 */
export function shortStateOf(status: ProviderStatus): string | null {
  if (status.state === 'low_credit') return 'Crédit bas';
  if (status.state !== 'needs_reconnect') return null;
  return status.isUnreadable ? 'Clé illisible' : 'Clé refusée';
}

/** The label of the sheet's last button: the next service still to connect, or « Terminé ». */
export function nextAfter(
  services: readonly ProviderStatus[],
  current: DashboardProvider,
): { label: string; provider: DashboardProvider | null } {
  const next = services.find(
    (s) => s.provider !== current && s.state === 'not_connected' && !isFromEnvironment(s),
  );
  if (next === undefined || !isDashboardProvider(next.provider)) return { label: 'Terminé', provider: null };
  return { label: `Continuer avec ${GUIDES[next.provider].name}`, provider: next.provider };
}

export type Dot = 'ok' | 'off' | 'must' | 'low' | 'bad' | 'busy';

export function dotOf(status: ProviderStatus, isVerifying: boolean): Dot {
  if (isVerifying) return 'busy';
  if (isFromEnvironment(status)) return 'ok';
  switch (status.state) {
    case 'connected':
      return 'ok';
    case 'low_credit':
      return 'low';
    case 'needs_reconnect':
      return 'bad';
    case 'not_connected':
      return isDashboardProvider(status.provider) && GUIDES[status.provider].isRequired ? 'must' : 'off';
  }
}

export function dotOfNext(next: ProviderNextAction): Dot {
  switch (next.kind) {
    case 'all_set':
      return 'ok';
    case 'replace_key':
      return 'bad';
    case 'top_up':
      return 'low';
    case 'connect':
      return isDashboardProvider(next.provider) && GUIDES[next.provider].isRequired ? 'must' : 'off';
  }
}

/**
 * « Vérifier maintenant » answers with the status as it stands. When the provider could not be reached, the
 * server keeps the last verification: same `verifiedAt`. The page says so instead of saying nothing. A key Nirvana
 * can no longer decrypt is never sent: the provider was not called, and the notice says what to do instead.
 */
export function verifyNotice(
  provider: DashboardProvider,
  before: ProviderStatus,
  after: ProviderStatus,
): string | null {
  if (after.isUnreadable)
    return `Nirvana ne peut plus lire la clé enregistrée : ${GUIDES[provider].vendor} n’a pas été contacté. Colle la clé à nouveau.`;
  // Every answer of the provider, a refusal included, moves `verifiedAt` (domain/credential.ts on the API).
  if (before.verifiedAt !== after.verifiedAt) return null;
  return `${GUIDES[provider].vendor} n’a pas répondu. L’état affiché est celui de la dernière vérification.`;
}

/** A key never contains whitespace: a key pasted with a line break or spaces in it still works. */
export function normalizeKey(raw: string): string {
  return raw.replace(/\s+/g, '');
}
