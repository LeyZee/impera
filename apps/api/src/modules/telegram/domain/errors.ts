import { DomainError, TELEGRAM_CHAT_MEMBER_CONFLICT } from '@impera/contracts';

/** Refusals of `/v1/settings/telegram` in the common error body (api.md § Erreurs): the suffix gives the HTTP status. */

/** No bot has this id (404). */
export class TelegramBotNotFound extends DomainError {
  constructor() {
    super('telegram_bot_not_found', 'Bot Telegram introuvable');
  }
}

/** No group has this id (404). */
export class TelegramChatNotFound extends DomainError {
  constructor() {
    super('telegram_chat_not_found', 'Groupe Telegram introuvable');
  }
}

/** REG-28: the bot still sits in this group (409); only a group it left or was banned from leaves the list. */
export class TelegramChatMemberConflict extends DomainError {
  constructor() {
    super(TELEGRAM_CHAT_MEMBER_CONFLICT, 'Le bot est encore dans ce groupe');
  }
}

/** A route names a group no bot sees any more (400): nothing is saved. */
export class TelegramChatInvalid extends DomainError {
  constructor() {
    super('telegram_chat_invalid', 'Un groupe choisi n’existe plus : recharge la page');
  }
}

/** A sales setting names a creator who does not exist (400): nothing is saved. */
export class TelegramCreatorInvalid extends DomainError {
  constructor() {
    super('telegram_creator_invalid', 'Une créatrice choisie n’existe plus : recharge la page');
  }
}

/** ADR 0080: the creator of a channel setting does not exist, or is archived (404). */
export class TelegramChannelCreatorNotFound extends DomainError {
  constructor() {
    super('telegram_channel_creator_not_found', 'Cette créatrice n’existe plus');
  }
}

/** ADR 0080 § 6.1: an alert route points at a creator's channel (400); alerts never go to a public channel. */
export class TelegramRouteToChannel extends DomainError {
  constructor() {
    super(
      'telegram_route_channel_invalid',
      'Ce canal est celui d’une créatrice : il ne reçoit jamais d’alertes de l’agence',
    );
  }
}

/** The channels' store is not wired (a test or a server without it): 503. */
export class TelegramChannelsUnavailable extends DomainError {
  constructor() {
    super('service_unavailable', 'Les canaux Telegram ne sont pas disponibles sur ce serveur');
  }
}
