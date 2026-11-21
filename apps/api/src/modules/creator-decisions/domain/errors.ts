import { DomainError } from '@impera/contracts';

/** A decision that is not hers, that ended, or that was withdrawn: nothing to answer. */
export class DecisionNotFound extends DomainError {
  constructor() {
    super('creator_decision_not_found', 'Cette question n’attend plus de réponse');
  }
}

/** Already answered, and otherwise: an answer is given once. */
export class DecisionAnswered extends DomainError {
  constructor() {
    super('creator_decision_answered_conflict', 'Cette question a déjà sa réponse');
  }
}

/** An answer the decision does not offer. */
export class DecisionAnswerUnknown extends DomainError {
  constructor() {
    super('creator_decision_answer_unprocessable', 'Cette réponse n’est pas proposée');
  }
}

/** Only the owner answers in her place. */
export class DecisionForbidden extends DomainError {
  constructor() {
    super('creator_decision_forbidden', 'Seul le propriétaire répond à sa place');
  }
}
