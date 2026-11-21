import type { LinkServiceFailure, LinkServiceStatus } from '@impera/contracts';

import { LinkServiceError, type LinkServiceKeyStore, type LinkServiceReader } from '../domain/link-service';
import type { KeyActor } from '../domain/sales-feed';

type Refusal = LinkServiceFailure | 'off';

const REFUSALS: Readonly<Record<Refusal, string>> = {
  off: 'Le service de liens n’est pas configuré sur ce serveur.',
  unauthorized: 'Le service de liens refuse cette clé. Vérifie que tu as collé la clé entière.',
  forbidden: 'Le service de liens n’ouvre pas son accès à ce compte.',
  rate_limited: 'Le service de liens demande d’attendre. Réessaie dans quelques minutes.',
  unavailable: 'Le service de liens ne répond pas. Réessaie dans quelques minutes.',
  unexpected: 'Le service de liens a répondu autre chose que prévu. La clé n’a pas été gardée.',
};

type LinkServiceConnect =
  | { readonly ok: true; readonly value: LinkServiceStatus }
  | { readonly ok: false; readonly error: { readonly kind: Refusal; readonly message: string } };

export interface LinkServiceSettings {
  status(): Promise<LinkServiceStatus>;
  /** Asks the service whether it accepts `key`, and keeps it only if it does. */
  connect(key: string, by: KeyActor): Promise<LinkServiceConnect>;
  disconnect(by: KeyActor): Promise<LinkServiceStatus>;
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

  const refused = (kind: Refusal): LinkServiceConnect => ({
    ok: false,
    error: { kind, message: REFUSALS[kind] },
  });

  return {
    status,

    async connect(key, by) {
      if (keys === null || readerOf === null) return refused('off');
      try {
        await readerOf(key).ping();
      } catch (error) {
        return refused(error instanceof LinkServiceError ? error.kind : 'unavailable');
      }
      await keys.save(key, now(), by);
      return { ok: true, value: await status() };
    },

    async disconnect(by) {
      if (keys !== null) await keys.remove(by);
      return status();
    },
  };
}
