import {
  CREATOR_WEEK_NOT_FOUND,
  CREATOR_WEEK_PLAN_UNPROCESSABLE,
  CREATOR_WEEK_VALIDATED_CONFLICT,
  DomainError,
} from '@impera/contracts';

/** No week computed for her yet, or a week of a creator out of the member's reach. */
export class CreatorWeekNotFound extends DomainError {
  constructor() {
    super(CREATOR_WEEK_NOT_FOUND, 'Aucune semaine n’est encore préparée pour elle');
  }
}

/** Another plan on a week already validated: it is in her agenda. */
export class CreatorWeekValidated extends DomainError {
  constructor() {
    super(CREATOR_WEEK_VALIDATED_CONFLICT, 'Cette semaine est déjà validée et partie chez elle');
  }
}

/** A shooting day outside the week. */
export class CreatorWeekPlanInvalid extends DomainError {
  constructor() {
    super(CREATOR_WEEK_PLAN_UNPROCESSABLE, 'Chaque jour de tournage doit tomber dans la semaine');
  }
}

/** Only the owner validates her week (ADR 0140 § 13); an active manager reads it; a chatter neither. */
export class CreatorWeekForbidden extends DomainError {
  constructor(gesture: 'read' | 'validate') {
    super(
      'creator_week_forbidden',
      gesture === 'read'
        ? 'Sa semaine se lit par le propriétaire et les managers'
        : 'Seul le propriétaire valide la semaine',
    );
  }
}
