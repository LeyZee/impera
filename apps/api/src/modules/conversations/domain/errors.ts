import {
  DomainError,
  type AutomaticMissing,
  type ConversationState,
  type DraftStatus,
  type GuardCode,
} from '@nirvana/contracts';

import type { BlockedReason } from './ports';
import type { ConversationCommand } from './state-machine';

/** Error codes of the module (api.md § Erreurs): the suffix gives the HTTP status. */

/**
 * The platform must not be written to (the account's write guard, for instance): the send stops at once, without the
 * retries a transient failure gets. Thrown by the `OutboundSender`.
 */
export class SendRefused extends DomainError {}

export class ConversationNotFound extends DomainError {
  constructor() {
    super('conversation_not_found', 'Conversation introuvable');
  }
}

export class CreatorNotFound extends DomainError {
  constructor() {
    super('creator_not_found', 'Créatrice introuvable');
  }
}

export class DraftNotFound extends DomainError {
  constructor() {
    super('draft_not_found', 'Brouillon introuvable');
  }
}

/** Automatique stays locked until its server lock opens (ADR 0019); `details.missing` says what it waits for. */
export class AutomaticLocked extends DomainError {
  constructor(missing: readonly AutomaticMissing[]) {
    super(
      'agent_mode_conflict',
      'Le mode Automatique reste fermé tant qu’il manque une persona active, le taux en réel ou le test à l’aveugle',
      { details: { missing: [...missing] } },
    );
  }
}

/** Bubbles a hard guard refuses (revue 09, G5): nothing is approved, the draft stays as it was. */
export class DraftGuarded extends DomainError {
  constructor(codes: readonly GuardCode[]) {
    super(
      'draft_unprocessable',
      'Ce message ne peut pas partir : une garde le bloque (identité, rencontre, contact ou limite de la créatrice)',
      { details: { guards: [...codes] } },
    );
  }
}

/**
 * Her guards cannot be read without an active persona version (recette 28/10, G4): nothing is approved, the draft
 * stays as it was, until a version is active in Créatrices › Persona.
 */
export class PersonaInactive extends DomainError {
  constructor() {
    super(
      'persona_inactive_unprocessable',
      'Ce message ne peut pas partir : cette créatrice n’a pas de persona active, ses gardes ne se lisent pas',
    );
  }
}

/** A command the conversation's state does not allow (approving while a human holds it, for instance). */
export class TransitionConflict extends DomainError {
  constructor(state: ConversationState, command: ConversationCommand) {
    super('transition_conflict', `Action « ${command} » impossible dans l'état « ${state} »`);
  }
}

/** A draft that already left the status the action needs (approving a rejected draft, for instance). */
export class DraftConflict extends DomainError {
  constructor(from: DraftStatus, to: DraftStatus) {
    super('draft_conflict', `Brouillon « ${from} » : passage à « ${to} » impossible`);
  }
}

const BLOCKED_MESSAGES: Readonly<Record<BlockedReason, string>> = {
  kill_switch: 'Arrêt d’urgence actif : rien ne part tant qu’il n’est pas levé',
  session_expired: 'La session de la plateforme a expiré : rien ne part tant qu’elle n’est pas reconnectée',
};

/** An approval while nothing may leave (message-flow.md §6): the draft stays as it was. */
export class SendBlocked extends DomainError {
  constructor(reason: BlockedReason) {
    super(`${reason}_conflict`, BLOCKED_MESSAGES[reason]);
  }
}

/** Why a draft stopped before its send, in the words of its `draft_expired` event. */
export const BLOCKED_EXPIRY_REASONS: Readonly<Record<BlockedReason, string>> = {
  kill_switch: 'Arrêt d’urgence à l’envoi',
  session_expired: 'Session de la plateforme expirée à l’envoi',
};
