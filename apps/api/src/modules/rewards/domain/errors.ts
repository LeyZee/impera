import { DomainError } from '@impera/contracts';

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
