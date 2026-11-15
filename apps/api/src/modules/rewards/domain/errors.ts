import { DomainError } from '@impera/contracts';

/** The member is not one the viewer can see, or does not play (api.md § Erreurs: the suffix gives the HTTP status). */
export class MemberNotFound extends DomainError {
  constructor() {
    super('member_not_found', 'Membre introuvable');
  }
}

/** A `creator` session whose account is not linked to exactly one creator (the base forbids it): refused. */
export class CreatorTrophiesForbidden extends DomainError {
  constructor() {
    super('creator_forbidden', 'Ce compte n’est lié à aucune créatrice');
  }
}

/** Her trophy case asked by anyone but the owner or an active manager who has her on his list, or with no account. */
export class CreatorTrophyCaseNotFound extends DomainError {
  constructor() {
    super('creator_trophy_case_not_found', 'Cette créatrice n’a pas de trophées à montrer');
  }
}
