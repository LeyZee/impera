import {
  DomainError,
  type AutomaticMissing,
  type ConversationState,
  type DraftStatus,
  type GuardCode,
} from '@impera/contracts';

import type { BlockedReason } from './ports';
import type { StepCut } from './rules';
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

/**
 * His age is in doubt: the agent writes nothing to him until the owner or a manager confirms it (Charles, 16/11), so
 * the hand is not given back to it meanwhile.
 */
export class AgeInDoubtConflict extends DomainError {
  constructor() {
    super(
      'age_in_doubt_conflict',
      'Son âge est en doute : l’IA ne lui écrit plus tant que le propriétaire ou un manager ne l’a pas confirmé',
    );
  }
}

/** A pause ends in the future, within a week (ADR 0148 § 1); past that, it is an Arrêt lifted by hand. */
export class AgentPauseInvalid extends DomainError {
  constructor() {
    super('agent_pause_invalid', 'Une pause finit plus tard, dans la semaine au plus');
  }
}

/**
 * A pause never lifts an Arrêt sooner (Sécurité, relecture de #865): an Arrêt without an end, an archived creator, or a
 * pause asked to end before the one in force refuses; she is resumed first, behind the resume's own checks.
 */
export class AgentPauseConflict extends DomainError {
  constructor(reason: 'stopped' | 'archived' | 'sooner') {
    super(
      'agent_pause_conflict',
      reason === 'archived'
        ? 'Une créatrice archivée reste arrêtée : pas de pause'
        : reason === 'stopped'
          ? 'L’IA est déjà arrêtée sans fin : reprends-la d’abord, puis mets-la en pause'
          : 'Une pause ne finit pas plus tôt que celle en cours : reprends l’IA d’abord',
      { details: { reason } },
    );
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

/**
 * « Il va mieux » is for whoever reads the whole creator (ADR 0088 § 7): the owner, or a manager she is given; never a
 * chatter, even with an open access window. He is told so, not that she is out of reach.
 */
export class CareCloseForbidden extends DomainError {
  constructor() {
    super('care_close_forbidden', 'Seuls le propriétaire et un manager peuvent fermer le mode soin');
  }
}

/** A conversation of her that was not given to him, for a member who reads only what he holds (ADR 0024): 403. */
export class ConversationForbidden extends DomainError {
  constructor() {
    super('conversation_forbidden', 'Cette conversation ne t’a pas été confiée');
  }
}

const STEP_CUT_WORDS: Readonly<Record<StepCut, string>> = {
  care: 'il traverse un moment difficile',
  do_not_contact: 'il ne doit plus recevoir de message',
  sales_frozen: 'ses ventes sont gelées',
  age_disputed: 'son âge est en doute',
  limits_unreadable: 'ses limites sont illisibles',
};

/** Why a draft stopped before its paid step, in the words of its `draft_expired` event. */
export function stepCutExpiryReason(cut: StepCut): string {
  return `Étape payante retenue à l’envoi : ${STEP_CUT_WORDS[cut]}`;
}

/**
 * A draft that carries a paid step of her script, approved while his limits keep it (relecture Sécurité de #812):
 * nothing is approved, the draft stays as it was. A human answers him without the step.
 */
export class ScriptStepCut extends DomainError {
  constructor(cut: StepCut) {
    super(
      'script_step_cut_unprocessable',
      `Ce message porte une étape payante qui ne peut plus partir : ${STEP_CUT_WORDS[cut]}`,
      { details: { cut } },
    );
  }
}
