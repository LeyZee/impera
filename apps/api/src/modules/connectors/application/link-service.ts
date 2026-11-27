import type { DetectedLink, LinkServiceRefusalKind, LinkServiceStatus } from '@impera/contracts';

import { LinkServiceError, type LinkServiceKeyStore, type LinkServiceReader } from '../domain/link-service';
import type { KeyActor } from '../domain/sales-feed';

const REFUSALS: Readonly<Record<LinkServiceRefusalKind, string>> = {
  not_connected: 'Aucune clé du service de liens n’est enregistrée. Colle-la dans Réglages.',
  off: 'Le service de liens n’est pas encore installé : ajoute ses liens à la main.',
  unauthorized: 'Le service de liens refuse cette clé. Vérifie que tu as collé la clé entière.',
  forbidden: 'Le service de liens n’ouvre pas son accès à ce compte.',
  rate_limited: 'Le service de liens demande d’attendre. Réessaie dans quelques minutes.',
  unavailable: 'Le service de liens ne répond pas. Réessaie dans quelques minutes.',
  unexpected: 'Le service de liens a répondu autre chose que prévu. La clé n’a pas été gardée.',
};

interface LinkServiceRefusal {
  readonly kind: LinkServiceRefusalKind;
  readonly message: string;
}

/** The links of the agency's account at the service, or why they could not be read. */
export type DetectedLinks =
  | { readonly ok: true; readonly links: readonly DetectedLink[] }
  | { readonly ok: false; readonly error: LinkServiceRefusal };

type LinkServiceConnect =
  | { readonly ok: true; readonly value: LinkServiceStatus }
  | { readonly ok: false; readonly error: LinkServiceRefusal };

export interface LinkServiceSettings {
  status(): Promise<LinkServiceStatus>;
  /** Asks the service whether it accepts `key`, and keeps it only if it does. */
  connect(key: string, by: KeyActor): Promise<LinkServiceConnect>;
  disconnect(by: KeyActor): Promise<LinkServiceStatus>;
  /**
   * Every link of the agency's account at the service, read now with the kept key. Nothing is stored: the caller
   * shows them to the owner alone, who decides which is whose.
   */
  detectedLinks(): Promise<DetectedLinks>;
}

/**
 * The agency's key of the redirect service (ADR 0120 § 3). Without an address in the deployment, or without the keys
 * that seal a secret, the connector is off: nothing is asked of anyone and nothing is kept.
 */
export function createLinkServiceSettings(deps: {
  /** `null` when the deployment gives no address for the service, or no key to seal a secret with. */
  readonly keys: LinkServiceKeyStore | null;
  readonly readerOf: ((key: string) => LinkServiceReader) | null;
  readonly now: () => Date;
}): LinkServiceSettings {
  const { keys, readerOf, now } = deps;

  async function status(): Promise<LinkServiceStatus> {
    if (keys === null || readerOf === null) return { state: 'off', connectedAt: null };
    const stored = await keys.find();
    if (stored === null) return { state: 'not_connected', connectedAt: null };
    return {
      state: stored.key === null ? 'needs_reconnect' : 'connected',
      connectedAt: stored.connectedAt.toISOString(),
    };
  }

  const refusal = (kind: LinkServiceRefusalKind): LinkServiceRefusal => ({ kind, message: REFUSALS[kind] });
  const refused = (kind: LinkServiceRefusalKind): LinkServiceConnect => ({ ok: false, error: refusal(kind) });
  const kindOf = (error: unknown): LinkServiceRefusalKind =>
    error instanceof LinkServiceError ? error.kind : 'unavailable';

  return {
    status,

    async connect(key, by) {
      if (keys === null || readerOf === null) return refused('off');
      try {
        await readerOf(key).ping();
      } catch (error) {
        return refused(kindOf(error));
      }
      await keys.save(key, now(), by);
      return { ok: true, value: await status() };
    },

    async disconnect(by) {
      if (keys !== null) await keys.remove(by);
      return status();
    },

    async detectedLinks() {
      if (keys === null || readerOf === null) return { ok: false, error: refusal('off') };
      const stored = await keys.find();
      if (stored === null) return { ok: false, error: refusal('not_connected') };
      // A key no listed encryption key opens is one to paste again, as a key the service no longer accepts.
      if (stored.key === null) return { ok: false, error: refusal('unauthorized') };
      try {
        return { ok: true, links: await readerOf(stored.key).listLinks() };
      } catch (error) {
        return { ok: false, error: refusal(kindOf(error)) };
      }
    },
  };
}
