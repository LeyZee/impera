import {
  CONTENT_IDEA_DECIDED_CONFLICT,
  CONTENT_IDEA_FORBIDDEN,
  CONTENT_IDEA_GUARD_UNPROCESSABLE,
  CONTENT_IDEA_NOT_FOUND,
  CONTENT_IDEA_REEL_BRIEF_INVALID,
  DomainError,
  TREND_CAPTURE_READING_NOT_FOUND,
  TREND_CAPTURE_VISION_UNAVAILABLE,
  TREND_WATCH_BUDGET_LIMITED,
} from '@impera/contracts';

import type { GuardFault } from './ideas';

/** A token missing, unknown or revoked: the extension asks for « Relier l'extension » again. */
export class ExtensionLinkUnauthenticated extends DomainError {
  constructor() {
    super('extension_link_unauthenticated', 'Extension non reliée : relie-la depuis le CRM');
  }
}

/** An account that cannot have a link (gone, or neither of the team nor a creator). */
export class ExtensionLinkForbidden extends DomainError {
  constructor() {
    super('extension_link_forbidden', 'Ce compte ne peut pas relier d’extension');
  }
}

/** Past `EXTENSION_LINKS_LIVE_MAX` live links: one is to be removed first. */
export class ExtensionLinksFull extends DomainError {
  constructor() {
    super('extension_links_full_conflict', 'Trois navigateurs sont déjà reliés : retire-en un d’abord');
  }
}

/** A live link of hers of that id, there is none (revoked, or another person's). */
export class ExtensionLinkNotFound extends DomainError {
  constructor() {
    super('extension_link_not_found', 'Liaison introuvable');
  }
}

/** A link pasted for a creator the account does not reach (a creator for another creator, an unknown creator). */
export class TrendLinkForbidden extends DomainError {
  constructor() {
    super('trend_link_forbidden', 'Ce lien ne peut pas être collé pour cette créatrice');
  }
}

/** A post marked for a creator the watcher may not mark for (a creator for another creator, an unknown one). */
export class TrendReadingForbidden extends DomainError {
  /** `creatorIds`: the marks refused, so that the extension drops them and sends the batch again. */
  constructor(creatorIds: readonly string[]) {
    super('trend_reading_forbidden', 'Ce relevé ne peut pas être marqué pour cette créatrice', {
      details: { creatorIds },
    });
  }
}

/** Captures of a post that is not, in this watch session, a reading of the holder marked for a creator. */
export class TrendCaptureReadingNotFound extends DomainError {
  constructor() {
    super(TREND_CAPTURE_READING_NOT_FOUND, 'Marque ce post pour une créatrice avant d’envoyer ses captures');
  }
}

/** The trend watch's cap of the day, or the daily one, is spent (ADR 0060 § 7): no vision until midnight. */
export class TrendWatchBudgetLimited extends DomainError {
  constructor() {
    super(TREND_WATCH_BUDGET_LIMITED, 'Le budget de la veille est épuisé pour aujourd’hui');
  }
}

/** No vision model answered: the captures are dropped, the reading and its mark stay. */
export class TrendCaptureVisionUnavailable extends DomainError {
  constructor() {
    super(TREND_CAPTURE_VISION_UNAVAILABLE, 'La description des captures est indisponible pour le moment');
  }
}

/** No idea of hers of that id (none, or another creator's). */
export class ContentIdeaNotFound extends DomainError {
  constructor() {
    super(CONTENT_IDEA_NOT_FOUND, 'Idée introuvable');
  }
}

/** « Idées du jour » is the owner's and an active manager's: a chatter, or a manager who left, is refused. */
export class ContentIdeaForbidden extends DomainError {
  constructor() {
    super(CONTENT_IDEA_FORBIDDEN, 'Les idées du jour sont réservées au propriétaire et aux managers');
  }
}

/** The other gesture on an idea already decided: a refused idea is never validated, a validated one never refused. */
export class ContentIdeaDecided extends DomainError {
  constructor() {
    super(CONTENT_IDEA_DECIDED_CONFLICT, 'Cette idée a déjà été décidée');
  }
}

/** The idea, as corrected, breaks one of the code's guards (ADR 0060 § 4): it does not leave for her agenda. */
export class ContentIdeaGuarded extends DomainError {
  /** `field`: the field at fault (`hook`, `toShoot`…), `null` without a persona. */
  constructor(fault: Pick<GuardFault, 'reason' | 'field'>) {
    const messages = {
      no_persona: 'Sans persona active, aucune idée ne part chez elle',
      limit: 'Cette idée touche une de ses limites : corrige-la ou refuse-la',
      nudity: 'Cette idée parle de nu pour une sortie publique : corrige-la ou refuse-la',
      instagram_guard: 'Cette idée enfreint la garde Instagram : corrige-la ou refuse-la',
    };
    super(CONTENT_IDEA_GUARD_UNPROCESSABLE, messages[fault.reason], {
      details: { reason: fault.reason, field: fault.field },
    });
  }
}

/** A correction that leaves a reel sheet on an idea that is no longer a Reel Insta (ADR 0082 § 3). */
export class ContentIdeaReelBriefInvalid extends DomainError {
  constructor() {
    super(
      CONTENT_IDEA_REEL_BRIEF_INVALID,
      'Une fiche reel va seulement avec un Reel Insta : retire-la ou garde le Reel',
    );
  }
}
