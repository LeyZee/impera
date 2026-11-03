import {
  AVAILABILITY_NOT_FOUND,
  CREATOR_TASK_CHANGED_CONFLICT,
  CREATOR_TASK_NOT_FOUND,
  CREATOR_TICK_DAY_UNPROCESSABLE,
  DomainError,
  SUGGESTION_DECLINED_RECENTLY_CONFLICT,
  SUGGESTION_NOT_FOUND,
  SUGGESTION_UNDATED_UNPROCESSABLE,
} from '@impera/contracts';

/** Her agenda's refusals (contracts `creator-tasks.ts`), in her words. */

export class CreatorTaskNotFound extends DomainError {
  constructor(details?: { readonly taskIds: readonly string[] }) {
    super(
      CREATOR_TASK_NOT_FOUND,
      'Cette tâche n’est pas dans ton agenda',
      details === undefined ? undefined : { details },
    );
  }
}

/** A creation replayed with the same id and another content: the id was already used. */
export class CreatorTaskChanged extends DomainError {
  constructor() {
    super(CREATOR_TASK_CHANGED_CONFLICT, 'Cet identifiant sert déjà à autre chose : recharge ton agenda');
  }
}

export class CreatorTickDayUnprocessable extends DomainError {
  constructor(taskIds: readonly string[]) {
    super(CREATOR_TICK_DAY_UNPROCESSABLE, 'Cette tâche n’est pas prévue ce jour-là', {
      details: { taskIds },
    });
  }
}

export class AvailabilityNotFound extends DomainError {
  constructor() {
    super(AVAILABILITY_NOT_FOUND, 'Cette dispo n’est pas dans ton agenda');
  }
}

export class SuggestionNotFound extends DomainError {
  constructor() {
    super(SUGGESTION_NOT_FOUND, 'Cette suggestion n’existe pas');
  }
}

/** An undated suggestion accepted without a time: she places it first. */
export class SuggestionUndated extends DomainError {
  constructor() {
    super(SUGGESTION_UNDATED_UNPROCESSABLE, 'Choisis d’abord un moment pour cette tâche');
  }
}

export class SuggestionDeclinedRecently extends DomainError {
  constructor() {
    super(
      SUGGESTION_DECLINED_RECENTLY_CONFLICT,
      'Elle a refusé cette tâche cette semaine ou la semaine d’avant : elle ne revient pas tout de suite',
    );
  }
}

/** A member who is neither the owner nor an active manager. */
export class SuggestionForbidden extends DomainError {
  constructor() {
    super('creator_suggestion_forbidden', 'Seuls le propriétaire et un manager actif suggèrent une tâche');
  }
}
