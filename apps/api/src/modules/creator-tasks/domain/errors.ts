import {
  AVAILABILITY_NOT_FOUND,
  CREATOR_TASK_CHANGED_CONFLICT,
  CREATOR_TASK_NOT_FOUND,
  CREATOR_TICK_DAY_UNPROCESSABLE,
  CREATOR_TICK_LATE_UNPROCESSABLE,
  DomainError,
  SUGGESTION_DECLINED_RECENTLY_CONFLICT,
  SUGGESTION_GUARD_UNPROCESSABLE,
  SUGGESTION_ID_CONFLICT,
  SUGGESTION_KIND_UNPROCESSABLE,
  SUGGESTION_NOT_FOUND,
  SUGGESTION_OPEN_CONFLICT,
  SUGGESTION_PAST_UNPROCESSABLE,
  SUGGESTION_UNDATED_UNPROCESSABLE,
} from '@impera/contracts';

import type { ShootGuardFault } from './ports';

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

/** A tick too old, or a routine tick for another day than the one she ticked it (ADR 0042 § 8). */
export class CreatorTickLateUnprocessable extends DomainError {
  constructor(taskIds: readonly string[]) {
    super(
      CREATOR_TICK_LATE_UNPROCESSABLE,
      'Une coche compte le jour où tu la fais, et au plus 48 heures après',
      { details: { taskIds } },
    );
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

/** Placed, or kept, at a moment already over: it would land in her past as a task she missed (CREA-09). */
export class SuggestionInPast extends DomainError {
  constructor() {
    super(SUGGESTION_PAST_UNPROCESSABLE, 'Ce moment est déjà passé : choisis-en un à venir');
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

/** The same task already waits for her answer that week (CREA-16): a second card would be noise. */
export class SuggestionAlreadyOpen extends DomainError {
  constructor() {
    super(
      SUGGESTION_OPEN_CONFLICT,
      'Cette tâche lui est déjà proposée cette semaine : elle n’a pas encore répondu',
    );
  }
}

/** A member who is neither the owner nor an active manager. */
export class SuggestionForbidden extends DomainError {
  constructor() {
    super('creator_suggestion_forbidden', 'Seuls le propriétaire et un manager actif suggèrent une tâche');
  }
}

/** Moved to another kind of task: a dated suggestion never becomes her routine, nor her routine a day (Bilan, #497). */
export class SuggestionKindChanged extends DomainError {
  constructor() {
    super(SUGGESTION_KIND_UNPROCESSABLE, 'Tu peux la déplacer, pas en changer la sorte');
  }
}

/** The id of a suggestion already used, for her or for another creator. */
export class SuggestionIdTaken extends DomainError {
  constructor() {
    super(SUGGESTION_ID_CONFLICT, 'Cet identifiant de suggestion sert déjà : recharge la page');
  }
}

/**
 * A shoot suggested by hand for a drop category that touches one of her limits or breaks a guard of that output
 * (ADR 0082 § 3): corrected, or not suggested. `field` names the field at fault, `null` without a persona.
 */
export class SuggestionGuarded extends DomainError {
  constructor(fault: ShootGuardFault) {
    const messages = {
      no_persona: 'Sans persona active, aucun tournage pour une sortie ne part chez elle',
      limit: 'Ce tournage touche une de ses limites : corrige-le',
      nudity: 'Ce tournage parle de nu pour une sortie publique : corrige-le',
      instagram_guard: 'Ce tournage enfreint la garde Instagram : corrige-le',
    };
    super(SUGGESTION_GUARD_UNPROCESSABLE, messages[fault.reason], {
      details: { reason: fault.reason, field: fault.field },
    });
  }
}
