import { DomainError, type ConnectorErrorCode } from '@impera/contracts';

export class PlatformAccountNotFound extends DomainError {
  constructor() {
    super('platform_account_not_found', 'Compte plateforme introuvable');
  }
}

/** No adapter for the account's platform yet (Reveal arrives with phase 1). */
export class ConnectorUnavailable extends DomainError {
  constructor() {
    super('connector_unavailable', 'Aucun connecteur pour cette plateforme');
  }
}

/** `SESSION_ENCRYPTION_KEYS` is not set: a session cannot be stored nor read. */
export class SessionVaultMissing extends DomainError {
  constructor() {
    super('session_vault_unavailable', 'Clé de chiffrement des sessions absente');
  }
}

export class DeviceUnauthenticated extends DomainError {
  constructor() {
    super('device_unauthenticated', 'Appareil non reconnu');
  }
}

/** A connector failure as the rest of the core sees it: `connector_rate_limited`, `connector_session_expired`… */
export class ConnectorFailed extends DomainError {
  constructor(code: ConnectorErrorCode, options: { readonly cause?: unknown }) {
    super(`connector_${code}`, 'La plateforme a refusé l’opération', options);
  }
}

/** No sales feed for this platform (only Reveal's CRM API has one): 404. */
export class SalesFeedNotFound extends DomainError {
  constructor() {
    super('sales_feed_not_found', 'Aucune lecture des ventes pour cette plateforme');
  }
}

/** CREDENTIALS_ENCRYPTION_KEYS is not set: a key is never kept unsealed (503). */
export class SalesFeedVaultMissing extends DomainError {
  constructor() {
    super(
      'sales_feed_vault_unavailable',
      'Clé de chiffrement des clés absente : la clé ne peut pas être gardée',
    );
  }
}

/** The account is not one of this platform's, or does not exist (422). */
export class SalesFeedAccountUnprocessable extends DomainError {
  constructor() {
    super('sales_feed_account_unprocessable', 'Ce compte n’est pas un compte de cette plateforme');
  }
}

/**
 * The model already has sales recorded for another account, or the account is linked to another model (409): its
 * lines stay where they were recorded, so moving it would split its sales between two accounts.
 */
export class SalesFeedModelConflict extends DomainError {
  constructor() {
    super(
      'sales_feed_model_conflict',
      'Ce modèle a déjà des ventes enregistrées sur un autre compte, ou ce compte est déjà lié à un autre modèle',
    );
  }
}

/** The team member does not exist (422). */
export class SalesFeedMemberUnprocessable extends DomainError {
  constructor() {
    super('sales_feed_member_unprocessable', 'Ce membre de l’équipe n’existe pas');
  }
}

/** A webhook needs a connected key: it is registered with it (409). */
export class SalesFeedNotConnected extends DomainError {
  constructor() {
    super('sales_feed_not_connected_conflict', 'Connecte d’abord la clé de l’API CRM');
  }
}

/** The platform only posts to a public HTTPS address: AUTH_BASE_URL is not one (422). */
export class SalesFeedWebhookUrlUnprocessable extends DomainError {
  constructor() {
    super(
      'sales_feed_webhook_url_unprocessable',
      'L’adresse publique d’Impera n’est pas en HTTPS : Reveal ne peut pas y envoyer les ventes',
    );
  }
}

/** A delivery whose signature, time or shape does not pass (401): nothing of it is kept. */
export class SalesFeedDeliveryRefused extends DomainError {
  constructor() {
    super('sales_feed_delivery_unauthenticated', 'Envoi refusé');
  }
}

/** No webhook is registered for this platform: a delivery has no secret to be checked against (404). */
export class SalesFeedWebhookNotFound extends DomainError {
  constructor() {
    super('sales_feed_webhook_not_found', 'Aucun webhook enregistré pour cette plateforme');
  }
}

/**
 * The dashboard's export cannot be read (422): a column it needs is missing, or a cell is not a date or an amount.
 * `details` names the column and the line, never a cell's value.
 */
export class SalesFeedExportUnprocessable extends DomainError {
  constructor(problem: string, details: Readonly<Record<string, string | number>>) {
    super('sales_feed_export_unprocessable', `Export illisible : ${problem}`, { details });
  }
}

/** The days checked must be over in the platform's zone (422): today's sales still reach the register. */
export class SalesFeedCheckDaysUnprocessable extends DomainError {
  constructor() {
    super(
      'sales_feed_check_days_unprocessable',
      'Choisis des jours déjà terminés : la journée en cours bouge encore',
    );
  }
}

/** The platform's list of models could not be read now (a refusal, an outage): nothing is imported (503). */
export class SalesFeedListUnavailable extends DomainError {
  constructor() {
    super(
      'sales_feed_list_unavailable',
      'La liste des modèles de la plateforme ne répond pas : réessaie dans un instant',
    );
  }
}
