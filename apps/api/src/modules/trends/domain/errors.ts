import { DomainError } from '@impera/contracts';

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

/** A link pasted for a creator the account does not reach (a creator for another creator, an unknown creator). */
export class TrendLinkForbidden extends DomainError {
  constructor() {
    super('trend_link_forbidden', 'Ce lien ne peut pas être collé pour cette créatrice');
  }
}

/** A post marked for a creator the watcher may not mark for (a creator for another creator, an unknown one). */
export class TrendReadingForbidden extends DomainError {
  constructor() {
    super('trend_reading_forbidden', 'Ce relevé ne peut pas être marqué pour cette créatrice');
  }
}
