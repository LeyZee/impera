import { DomainError, TELEGRAM_CHAT_MEMBER_CONFLICT } from '@impera/contracts';

/** Refusals of `/v1/settings/telegram` in the common error body (api.md § Erreurs): the suffix gives the HTTP status. */

/** No bot has this id (404). */
export class TelegramBotNotFound extends DomainError {
  constructor() {
    super('telegram_bot_not_found', 'Bot Telegram introuvable');
  }
}

/** No channel has this id (404). */
export class TelegramChatNotFound extends DomainError {
  constructor() {
    super('telegram_chat_not_found', 'Canal Telegram introuvable');
  }
}

/** REG-28: the bot still sits in this channel (409); only a channel it left or was banned from leaves the list. */
export class TelegramChatMemberConflict extends DomainError {
  constructor() {
    super(TELEGRAM_CHAT_MEMBER_CONFLICT, 'Le bot est encore dans ce canal');
  }
}

/** ADR 0080: the creator of a channel setting does not exist, or is archived (404). */
export class TelegramChannelCreatorNotFound extends DomainError {
  constructor() {
    super('telegram_channel_creator_not_found', 'Cette créatrice n’existe plus');
  }
}

/** The channels' store is not wired (a test or a server without it): 503. */
export class TelegramChannelsUnavailable extends DomainError {
  constructor() {
    super('service_unavailable', 'Les canaux Telegram ne sont pas disponibles sur ce serveur');
  }
}

/** ADR 0080 § 7: the server has no voice wired for her channel's posts (no LLM in this process). */
export class TelegramChannelWriterUnavailable extends DomainError {
  constructor() {
    super('service_unavailable', 'L’écriture des posts du canal n’est pas disponible sur ce serveur');
  }
}
