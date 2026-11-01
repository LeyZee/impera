import type { TelegramErrorKind } from '@nirvana/contracts';

/**
 * The single translation table: the sheet, the line of a group and the log say the same sentence for the same
 * problem. No HTTP code ever reaches the screen.
 */
export function describeTelegramError(kind: TelegramErrorKind): string {
  switch (kind) {
    case 'token_shape':
      return 'Ce n’est pas un jeton de bot. Il ressemble à 123456789:AAF… : des chiffres, deux-points, puis une longue suite de lettres.';
    case 'token_refused':
      return 'Telegram ne reconnaît pas ce jeton. Copie-le en entier depuis @BotFather, ou demande-lui un nouveau jeton avec /token.';
    case 'bot_exists':
      return 'Ce bot est déjà dans Nirvana.';
    case 'bot_mismatch':
      return 'Ce jeton appartient à un autre bot. Pour un nouveau bot, utilise « Ajouter un bot ».';
    case 'bot_conflict':
      return 'Un autre programme utilise déjà ce bot. Arrête-le, ou crée un bot réservé à Nirvana.';
    case 'chat_unreachable':
      return 'Le bot ne peut plus écrire dans ce groupe. Rajoute-le au groupe, puis réessaie.';
    case 'rate_limited':
      return 'Telegram demande de ralentir : le message partira dans quelques secondes.';
    case 'unreachable':
      return 'Telegram ne répond pas. Rien n’est perdu : Nirvana réessaie tout seul.';
    case 'routes_version_conflict':
      return 'Quelqu’un a changé ces réglages en même temps que toi. Recharge la page pour voir les siens.';
    case 'chat_removed':
      return 'Le groupe a été retiré de la liste avant l’envoi : ce message n’est pas parti.';
  }
}
