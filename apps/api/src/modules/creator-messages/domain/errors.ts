import { CREATOR_MESSAGE_ANSWERED_CONFLICT, DomainError } from '@impera/contracts';

/** Answered already with other words: the first answer stands. */
export class MessageAnsweredConflict extends DomainError {
  constructor() {
    super(CREATOR_MESSAGE_ANSWERED_CONFLICT, 'Ce message a déjà sa réponse');
  }
}

export class MessageNotFound extends DomainError {
  constructor() {
    super('creator_message_not_found', 'Message introuvable');
  }
}

/** Not her owner (answer), nor her owner or an active manager (read). */
export class MessagesForbidden extends DomainError {
  constructor(gesture: 'read' | 'answer') {
    super(
      'creator_message_forbidden',
      gesture === 'answer'
        ? 'Seul le propriétaire répond aux messages des créatrices'
        : 'Les messages des créatrices se lisent par le propriétaire et les managers',
    );
  }
}

/** A `creator` session whose account is not linked to exactly one creator. */
export class CreatorAccountForbidden extends DomainError {
  constructor() {
    super('creator_forbidden', 'Ce compte n’est lié à aucune créatrice');
  }
}
