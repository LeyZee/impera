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

/** She asked for other ideas as many times as a decision allows, or nothing proposes any for this one. */
export class DecisionNoMoreIdeas extends DomainError {
  constructor() {
    super('creator_decision_ideas_conflict', 'Il n’y a plus d’autres idées pour cette question');
  }
}

/** Other ideas are already being written for this question: one request at a time. */
export class DecisionIdeasPending extends DomainError {
  constructor() {
    super('creator_decision_ideas_pending_conflict', 'D’autres idées arrivent déjà pour cette question');
  }
}

/** Whoever proposes could not, for now (the day's AI budget, every model failing): she asks again later. */
export class DecisionIdeasUnavailable extends DomainError {
  constructor() {
    super('creator_decision_ideas_unavailable', 'Pas d’autres idées pour l’instant, réessaie plus tard');
  }
}

/** Only the owner answers in her place. */
export class DecisionForbidden extends DomainError {
  constructor() {
    super('creator_decision_forbidden', 'Seul le propriétaire répond à sa place');
  }
}
