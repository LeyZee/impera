import { DomainError, type CreatorId } from '@nirvana/contracts';

/** Error codes of the module (`TEAM_MEMBER_ERROR_CODES`, api.md § Erreurs): the suffix gives the HTTP status. */
export class MemberNotFound extends DomainError {
  constructor() {
    super('member_not_found', 'Membre introuvable');
  }
}

export class MemberConflict extends DomainError {
  constructor() {
    super('member_conflict', 'Un compte existe déjà avec cet e-mail');
  }
}

export class MemberLeftConflict extends DomainError {
  constructor() {
    super('member_left_conflict', 'Ce membre a quitté l’équipe : sa fiche ne change plus');
  }
}

export class CommissionPresetNotFound extends DomainError {
  constructor() {
    super('commission_preset_not_found', 'Préréglage de commission introuvable');
  }
}

export class CommissionPresetConflict extends DomainError {
  constructor() {
    super('commission_preset_conflict', 'Ce préréglage a déjà un taux qui commence ce jour-là');
  }
}

export class CommissionRateConflict extends DomainError {
  constructor() {
    super('commission_rate_conflict', 'Ce membre a déjà un taux qui commence ce jour-là');
  }
}

export class CommissionDateInvalid extends DomainError {
  constructor() {
    super('commission_date_invalid', 'Un taux commence aujourd’hui au plus tôt, jamais avant');
  }
}

/** A new rate starts a period (Charles, 28/10): no period is paid at two rates, nothing is computed again backwards. */
export class CommissionStartInvalid extends DomainError {
  constructor() {
    super(
      'commission_date_invalid',
      'Un nouveau taux commence le 1er ou le 16 d’un mois, aujourd’hui au plus tôt',
    );
  }
}

/** A change of role starts a period, like a rate (Charles, 28/10): no period is paid under two roles. */
export class RoleDateInvalid extends DomainError {
  constructor() {
    super(
      'role_date_invalid',
      'Un changement de rôle commence le 1er ou le 16 d’un mois, aujourd’hui au plus tôt',
    );
  }
}

export class RoleChangeConflict extends DomainError {
  constructor() {
    super('role_change_conflict', 'Ce membre a déjà un rôle qui commence ce jour-là');
  }
}

export class TeamShareInvalid extends DomainError {
  constructor() {
    super('team_share_invalid', 'Seul un manager a une part du net de l’équipe');
  }
}

export class CreatorNotFound extends DomainError {
  constructor(missing: readonly CreatorId[]) {
    super('creator_not_found', 'Créatrice introuvable', { details: { missing } });
  }
}

/**
 * The notes and the presets are read by the owner and the active managers (ADR 0024): a chatter, or a manager who is
 * not `active`, is refused rather than shown an empty list. Same code as the role guard of `auth.ts`.
 */
export class TeamScopeForbidden extends DomainError {
  constructor() {
    super('role_forbidden', 'Réservé au propriétaire et aux managers actifs');
  }
}

/** The notes about a member are never his to read or write (ADR 0024), whatever his scope. */
export class OwnNotesForbidden extends DomainError {
  constructor() {
    super('role_forbidden', 'Les notes sur toi ne te sont pas lisibles');
  }
}

/** Members, rates and presets are written by the owner only. */
export class OwnerOnly extends DomainError {
  constructor() {
    super('role_forbidden', 'Réservé au propriétaire');
  }
}
