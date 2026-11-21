import type { LinkServiceStatus } from '@impera/contracts';

import { dayTime } from '@/settings/sales-feed/view';

/** The dot of the card: grey without a key, green with one, red when the key kept can no longer be read. */
export function dotOf(status: LinkServiceStatus): 'off' | 'ok' | 'bad' {
  if (status.state === 'connected') return 'ok';
  return status.state === 'needs_reconnect' ? 'bad' : 'off';
}

/** The one line under the title: what is true of the key now, and what to do about it. */
export function lineOf(status: LinkServiceStatus): string {
  switch (status.state) {
    case 'off':
      return 'Cette installation n’a pas encore l’adresse du service de liens : elle se règle au déploiement, pas ici.';
    case 'not_connected':
      return 'Aucune clé. Sans elle, les liens s’ajoutent à la main dans la fiche de chaque créatrice.';
    case 'needs_reconnect':
      return 'La clé gardée ne se lit plus. Colle-la de nouveau.';
    case 'connected':
      return status.connectedAt === null
        ? 'Clé acceptée par le service.'
        : `Clé acceptée par le service, connectée le ${dayTime(status.connectedAt)}.`;
  }
}
