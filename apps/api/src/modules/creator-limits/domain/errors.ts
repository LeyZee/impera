import { ABSENCE_IN_PAST_UNPROCESSABLE, DomainError } from '@impera/contracts';

/** An absence that starts before today in her zone: she tells it ahead, or on the day. */
export class AbsenceInPast extends DomainError {
  constructor() {
    super(ABSENCE_IN_PAST_UNPROCESSABLE, 'Une absence se dit à l’avance, ou le jour même');
  }
}

/** Neither hers nor on his list, nor on shift for her: refused. */
export class LimitsForbidden extends DomainError {
  constructor() {
    super('creator_forbidden', 'Créatrice hors de ton périmètre');
  }
}

/** A `creator` session whose account is not linked to exactly one creator. */
export class CreatorAccountForbidden extends DomainError {
  constructor() {
    super('creator_forbidden', 'Ce compte n’est lié à aucune créatrice');
  }
}
