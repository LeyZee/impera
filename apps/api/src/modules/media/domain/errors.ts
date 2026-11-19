import { DomainError } from '@impera/contracts';

/**
 * Her vault by choice (ADR 0145 § 5) is read by the owner and an active manager of her list; ticking what enters the
 * CRM and asking a description are the owner's alone (403).
 */
export class VaultChoiceForbidden extends DomainError {
  constructor(gesture: 'read' | 'choose') {
    super(
      'vault_choice_forbidden',
      gesture === 'read'
        ? 'Réservé au propriétaire et au manager actif qui suit cette créatrice'
        : 'Seul le propriétaire choisit ce qui entre dans le CRM et ce qui est décrit',
    );
  }
}

/** A platform account that is not hers (404): nothing is ticked nor asked. */
export class VaultAccountNotFound extends DomainError {
  constructor() {
    super('vault_account_not_found', 'Compte de plateforme introuvable pour cette créatrice');
  }
}

/** A confirmed run of descriptions dearer than what is left of the day's AI ceiling: refused, nothing asked (422). */
export class VaultDescribeOverCap extends DomainError {
  constructor() {
    super(
      'vault_describe_over_cap_unprocessable',
      'Plus cher que ce qui reste du plafond IA du jour : réduis la sélection ou attends demain',
    );
  }
}
