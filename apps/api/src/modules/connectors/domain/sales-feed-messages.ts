import type { SalesFeedErrorKind, SalesFeedState } from '@nirvana/contracts';

/**
 * The one sentence for each problem of a sales feed: the key field, the Réglages line and the log say the same thing.
 * Never an HTTP code on screen.
 */
export const SALES_FEED_ERROR_MESSAGES: Readonly<Record<SalesFeedErrorKind, string>> = {
  malformed:
    'Ce n’est pas une clé de l’API CRM de Reveal : elle commence par « rvl_ ». Recopie-la depuis Paramètres › CRM / API.',
  unauthorized:
    'Reveal refuse cette clé : elle est inconnue, révoquée ou expirée. Crée-en une nouvelle dans Paramètres › CRM / API.',
  missing_access:
    'Il manque un accès à cette clé : coche « Statistiques » et « Ventes une par une » dans Paramètres › CRM / API, ou demande au support Reveal de les ouvrir.',
  rate_limited: 'Reveal demande d’attendre un peu avant le prochain appel. La lecture reprend toute seule.',
  unreachable: 'Reveal ne répond pas pour le moment. La lecture reprend toute seule, sans rien perdre.',
  unexpected_answer:
    'Reveal a répondu dans une forme que Nirvana ne sait pas lire. La lecture est en pause, aucune vente n’est perdue.',
};

const STATE_MESSAGES: Readonly<Record<SalesFeedState, string>> = {
  not_connected: 'Sans clé, les ventes de Reveal ne remontent pas dans Nirvana.',
  connected: 'Les ventes et les remboursements de Reveal remontent chaque minute.',
  needs_reconnect: 'La lecture des ventes est arrêtée : reconnecte la clé.',
};

/** The Réglages line: the state, or the last problem when it says more. */
export function salesFeedMessage(state: SalesFeedState, lastErrorKind: SalesFeedErrorKind | null): string {
  if (state === 'needs_reconnect' && lastErrorKind !== null) {
    return `${STATE_MESSAGES.needs_reconnect} ${SALES_FEED_ERROR_MESSAGES[lastErrorKind]}`;
  }
  if (state === 'connected' && lastErrorKind !== null) return SALES_FEED_ERROR_MESSAGES[lastErrorKind];
  return STATE_MESSAGES[state];
}
