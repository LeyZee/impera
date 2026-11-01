import { AGE_DISPUTE_FORBIDDEN, AGE_DISPUTE_REASON_INVALID, DomainError } from '@nirvana/contracts';

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
