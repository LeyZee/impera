import {
  AGE_DISPUTE_FORBIDDEN,
  AGE_DISPUTE_REASON_INVALID,
  DomainError,
  FAN_CARD_VALUE_INVALID,
  FAN_CARD_VALUE_UNPROCESSABLE,
} from '@impera/contracts';

/** Error codes of the module (api.md § Erreurs): the suffix gives the HTTP status. */
export class FanNotFound extends DomainError {
  constructor() {
    super('fan_not_found', 'Fan introuvable');
  }
}

/**
 * A disputed age (a sign of a minor, P3-09) is lifted only by the owner or an active manager (SUIVI-04, accepted by
 * Charles on 29/10): the gravest guard, and a mistake costs the account.
 */
export class AgeDisputeForbidden extends DomainError {
  constructor() {
    super(AGE_DISPUTE_FORBIDDEN, 'Seuls le propriétaire et les managers confirment un âge contesté');
  }
}

/** Confirming a disputed age says why, in writing: the reason is kept with the event. */
export class AgeDisputeReasonInvalid extends DomainError {
  constructor() {
    super(AGE_DISPUTE_REASON_INVALID, 'Écris pourquoi tu confirmes son âge malgré le soupçon');
  }
}

/** A value that does not fit its field of the card (ADR 0085 § 3): a list for one value, outside a closed list, too long. */
export class FanCardValueInvalid extends DomainError {
  constructor() {
    super(FAN_CARD_VALUE_INVALID, 'Cette valeur ne va pas dans cette case');
  }
}

/** What the card never keeps (ADR 0085 § 8): nothing that finds him outside the platform. Nothing is written. */
export class FanCardValueRefused extends DomainError {
  constructor() {
    super(
      FAN_CARD_VALUE_UNPROCESSABLE,
      'La fiche ne garde ni adresse, ni numéro, ni e-mail, ni compte ailleurs que sur la plateforme',
    );
  }
}
