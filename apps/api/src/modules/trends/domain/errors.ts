import {
  DomainError,
  TREND_CAPTURE_READING_NOT_FOUND,
  TREND_CAPTURE_VISION_UNAVAILABLE,
  TREND_WATCH_BUDGET_LIMITED,
} from '@impera/contracts';

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
