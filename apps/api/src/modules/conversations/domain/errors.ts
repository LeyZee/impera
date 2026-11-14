import {
  DomainError,
  type AutomaticMissing,
  type ConversationState,
  type DraftStatus,
  type GuardCode,
} from '@impera/contracts';

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

/** A gesture of the copilot panel on a draft already settled otherwise: sent, expired, or rejected then placed. */
export class CopilotDraftConflict extends DomainError {
  constructor() {
    super('copilot_draft_conflict', 'Ce brouillon a déjà été traité');
  }
}

/** The copilot panel opens a creator only to the chatter on shift on her, margin included (ADR 0086 § 7). */
export class CopilotOffShift extends DomainError {
  constructor() {
    super('copilot_shift_forbidden', 'Tu n’es pas en poste sur cette créatrice.');
  }
}

/** The extension's link missing, unknown or revoked: it asks for « Relier l'extension » again (ADR 0066 § 7). */
export class CopilotLinkUnauthenticated extends DomainError {
  constructor() {
    super('extension_link_unauthenticated', 'Extension non reliée : relie-la depuis le CRM');
  }
}

/** A creator's own link: she has no copilot panel (ADR 0063, ADR 0086 § 7). */
export class CopilotForbidden extends DomainError {
  constructor() {
    super('copilot_forbidden', 'Le panneau copilote est réservé à l’agence');
  }
}

/** Two of the reader's creators have a conversation of that id on the platform: the panel names the creator. */
export class CopilotCreatorConflict extends DomainError {
  constructor() {
    super('copilot_creator_conflict', 'Deux créatrices ont cette conversation : précise laquelle');
  }
}

const BLOCKED_MESSAGES: Readonly<Record<BlockedReason, string>> = {
  creator_archived: 'Cette créatrice est archivée : rien ne part en son nom',
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
  creator_archived: 'Créatrice archivée à l’envoi',
  kill_switch: 'Arrêt d’urgence à l’envoi',
  session_expired: 'Session de la plateforme expirée à l’envoi',
};

/** A creator outside the reader's scope (ADR 0026 § 1): 403. */
export class CreatorForbidden extends DomainError {
  constructor() {
    super('creator_forbidden', 'Créatrice hors de ton périmètre');
  }
}

/** A conversation of her that was not given to him, for a member who reads only what he holds (ADR 0024): 403. */
export class ConversationForbidden extends DomainError {
  constructor() {
    super('conversation_forbidden', 'Cette conversation ne t’a pas été confiée');
  }
}
