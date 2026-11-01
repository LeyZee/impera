import {
  TelegramTopicSchema,
  type CreatorId,
  type TelegramBot,
  type TelegramChat,
  type TelegramChatId,
  type TelegramDelivery,
  type TelegramOverview,
  type TelegramRoute,
  type TelegramTopic,
} from '@nirvana/contracts';

/** View rules of Réglages › Telegram, kept out of the components so they are tested. */

/** « Toutes les créatrices » or one of them. A route of `all` is stored with `creatorId: null`. */
export type Scope = 'all' | CreatorId;

export interface TopicMeta {
  readonly label: string;
  readonly sub: string;
}

export const TOPICS: Record<TelegramTopic, TopicMeta> = {
  urgent: { label: 'Urgent', sub: 'Mineur, consentement, détresse, rencontre, manipulation' },
  important: { label: 'Important', sub: 'Plafond IA, session expirée, agent arrêté' },
  info: { label: 'Info', sub: 'Bilan du matin, retour à la normale, sans son' },
  sale: { label: 'Ventes', sub: 'Un message sans son à chaque vente' },
  keyword: { label: 'Mots-clés', sub: 'Un fan a écrit un mot surveillé de la Persona' },
  validation: { label: 'Validations', sub: 'Vocaux et brouillons qui attendent' },
  custom: { label: 'Alertes personnalisées', sub: 'Les alertes que tu as écrites, quand elles sonnent' },
};

export const ALERT_TOPICS = [
  'urgent',
  'important',
  'keyword',
  'info',
  'custom',
] as const satisfies readonly TelegramTopic[];

export interface ChatChoice {
  readonly chat: TelegramChat;
  readonly bot: TelegramBot;
  /** The bot is accepted by Telegram and may post in the group. */
  readonly isReachable: boolean;
}

/** Every group a bot sits in, the reachable ones first. A group it left or was banned from is not a choice. */
export function chatChoices(bots: readonly TelegramBot[]): ChatChoice[] {
  return bots
    .flatMap((bot) =>
      bot.chats
        .filter((chat) => chat.membership === 'member')
        .map((chat) => ({ chat, bot, isReachable: chat.canPost && bot.state === 'active' })),
    )
    .sort((a, b) => Number(b.isReachable) - Number(a.isReachable));
}

const creatorOf = (scope: Scope): CreatorId | null => (scope === 'all' ? null : scope);

/**
 * `on`: this scope sends the topic to the group. `inherited`: a creator's line, already sent there by the « toutes
 * les créatrices » route. `off`: nothing.
 */
export function routeState(
  routes: readonly TelegramRoute[],
  scope: Scope,
  topic: TelegramTopic,
  chatId: TelegramChatId,
): 'on' | 'inherited' | 'off' {
  const has = (creatorId: CreatorId | null): boolean =>
    routes.some((r) => r.creatorId === creatorId && r.topic === topic && r.chatId === chatId);
  if (has(creatorOf(scope))) return 'on';
  return scope !== 'all' && has(null) ? 'inherited' : 'off';
}

/** The routing table with one chip flipped; every other route is kept as is. */
export function toggleRoute(
  routes: readonly TelegramRoute[],
  scope: Scope,
  topic: TelegramTopic,
  chatId: TelegramChatId,
): TelegramRoute[] {
  const creatorId = creatorOf(scope);
  const isSame = (r: TelegramRoute): boolean =>
    r.creatorId === creatorId && r.topic === topic && r.chatId === chatId;
  return routes.some(isSame) ? routes.filter((r) => !isSame(r)) : [...routes, { creatorId, topic, chatId }];
}

/** The topics one group gets for every creator, in the order of `TOPICS`. */
export function topicsOfChat(routes: readonly TelegramRoute[], chatId: TelegramChatId): TelegramTopic[] {
  const topics = new Set(
    routes.filter((r) => r.chatId === chatId && r.creatorId === null).map((r) => r.topic),
  );
  return TelegramTopicSchema.options.filter((topic) => topics.has(topic));
}

/** Sets exactly `topics` for one group, for every creator; routes of other groups and creators stay. */
export function setTopicsOfChat(
  routes: readonly TelegramRoute[],
  chatId: TelegramChatId,
  topics: readonly TelegramTopic[],
): TelegramRoute[] {
  const kept = routes.filter((r) => !(r.chatId === chatId && r.creatorId === null));
  return [...kept, ...topics.map((topic) => ({ creatorId: null, topic, chatId }))];
}

/** How many groups the topic reaches for a scope, counting the « toutes » routes for a creator. */
function reachCount(
  routes: readonly TelegramRoute[],
  choices: readonly ChatChoice[],
  scope: Scope,
  topic: TelegramTopic,
): number {
  return choices.filter((c) => c.isReachable && routeState(routes, scope, topic, c.chat.id) !== 'off').length;
}

export interface Health {
  /** Red is kept for urgent alerts that reach no one; a bot or a group in trouble is a warning (amber). */
  readonly tone: 'ok' | 'warn' | 'bad' | 'empty';
  readonly label: string;
  /** The tab where the problem is fixed; the strip leads there. `null`: nothing to fix. */
  readonly fix: 'bots' | 'alerts' | null;
  readonly botCount: number;
  readonly groupCount: number;
  readonly lastSentAt: string | null;
}

/** The strip under the title: is anything broken, and the counts. */
export function healthOf(overview: TelegramOverview): Health {
  const choices = chatChoices(overview.bots);
  const lastSentAt =
    choices
      .map((c) => c.chat.lastSentAt)
      .filter((at): at is string => at !== null)
      .sort()
      .at(-1) ?? null;
  const base = {
    botCount: overview.bots.length,
    groupCount: choices.filter((c) => c.isReachable).length,
    lastSentAt,
  };
  if (overview.bots.length === 0)
    return { ...base, tone: 'empty', label: 'Aucun bot pour l’instant', fix: null };
  const isBotBroken = overview.bots.some((bot) => bot.state !== 'active');
  if (overview.coverage.some((c) => !c.urgentReachable)) {
    // No group can be written to: the fix is in Bots et groupes. Otherwise a group is to choose, in the routing.
    const isBotsFault = !choices.some((c) => c.isReachable);
    return {
      ...base,
      tone: 'bad',
      label: 'Les urgences n’arrivent nulle part',
      fix: isBotsFault ? 'bots' : 'alerts',
    };
  }
  if (isBotBroken) return { ...base, tone: 'warn', label: 'Un bot demande ton attention', fix: 'bots' };
  // A group the bot left or was banned from waits to be removed (REG-28): its line is amber, so is the strip.
  if (
    choices.some((c) => c.chat.lastError !== null || !c.isReachable) ||
    overview.bots.some((bot) => goneChats(bot).length > 0)
  )
    return { ...base, tone: 'warn', label: 'Un groupe demande ton attention', fix: 'bots' };
  return { ...base, tone: 'ok', label: 'Tout fonctionne', fix: null };
}

export interface Cover {
  readonly isOk: boolean;
  readonly title: string;
  readonly sub: string;
}

/** The one thing that dominates the Alertes tab: does an urgent alert reach someone, for every creator. */
export function coverOf(overview: TelegramOverview): Cover {
  const choices = chatChoices(overview.bots);
  const missing = overview.coverage.filter((c) => !c.urgentReachable);
  if (overview.bots.length === 0) {
    return {
      isOk: false,
      title: 'Personne n’est prévenu la nuit',
      sub: 'Ajoute un bot et mets-le dans un groupe : les urgences y arriveront, même à 3 h du matin.',
    };
  }
  // Groups exist but none can be written to: the bot is what to fix, not the choice of a group (recette du 28/10).
  if (missing.length > 0 && choices.length > 0 && !choices.some((c) => c.isReachable)) {
    const isBotBroken = overview.bots.some((bot) => bot.state !== 'active');
    return {
      isOk: false,
      title: 'Les alertes ne partent plus',
      sub: isBotBroken
        ? overview.bots.some((bot) => bot.state === 'refused')
          ? 'Telegram refuse le jeton d’un bot : remplace-le dans Bots et groupes.'
          : 'Un autre programme lit le bot : arrête-le, ou remplace le jeton dans Bots et groupes.'
        : 'Le bot n’a le droit d’écrire dans aucun de ses groupes : fais-le administrateur du groupe.',
    };
  }
  // No group at all to choose: the fix is to put a bot in one, not to pick one (REG-28, a bot out of its only group).
  if (missing.length > 0 && choices.length === 0) {
    const isOut = overview.bots.some((bot) => goneChats(bot).length > 0);
    return {
      isOk: false,
      title: 'Les alertes ne partent plus',
      sub: isOut
        ? 'Le bot n’est plus dans aucun de ses groupes : rajoute-le à un groupe dans Bots et groupes.'
        : 'Le bot n’est dans aucun groupe : ajoute-le à un groupe dans Bots et groupes.',
    };
  }
  if (missing.length > 0) {
    const names = missing.map((c) => c.displayName).join(', ');
    return {
      isOk: false,
      title: 'Personne n’est prévenu la nuit',
      sub: `Choisis au moins un groupe pour Urgent (${names}). Sans ça, une alerte de nuit reste dans le CRM.`,
    };
  }
  const groups = reachCount(overview.routes, choices, 'all', 'urgent');
  const sub =
    groups > 0
      ? `Les urgences arrivent dans ${plural(groups, 'groupe')}. L’agent n’écrit plus au fan tant qu’un humain n’a pas repris.`
      : 'Chaque créatrice a son groupe pour les urgences. L’agent n’écrit plus au fan tant qu’un humain n’a pas repris.';
  return { isOk: true, title: 'Quelqu’un est prévenu, même la nuit', sub };
}

export function plural(count: number, word: string): string {
  return `${String(count)} ${word}${count > 1 ? 's' : ''}`;
}

const graphemes = new Intl.Segmenter('fr', { granularity: 'grapheme' });

/** A title that starts with an emoji (« 💰 Ventes ») is drawn by that emoji alone. */
const LEADING_EMOJI = /^\p{Extended_Pictographic}/u;

/** Two letters for the round avatar of a group, or its leading emoji alone. */
export function initials(title: string): string {
  const first = graphemes.segment(title.trim())[Symbol.iterator]().next().value?.segment ?? '';
  if (LEADING_EMOJI.test(first)) return first;
  const firsts = title
    .split(/\s+/)
    .map((word) => graphemes.segment(word)[Symbol.iterator]().next().value?.segment ?? '')
    .filter((first) => first !== '')
    .slice(0, 2);
  return firsts.length === 0 ? '?' : firsts.join('').toLocaleUpperCase('fr');
}

const two = (n: number): string => String(n).padStart(2, '0');

/** « 23 h 12 », in the browser's time zone. */
export function hourLabel(iso: string): string {
  const at = new Date(iso);
  return `${two(at.getHours())} h ${two(at.getMinutes())}`;
}

/** « 23:12 », for the journal column. */
export function clockLabel(iso: string): string {
  const at = new Date(iso);
  return `${two(at.getHours())}:${two(at.getMinutes())}`;
}

/** « à 23 h 12 », « hier à 08 h 00 », « le 15/10 ». */
export function whenLabel(iso: string, now: Date): string {
  const at = new Date(iso);
  const dayOf = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((dayOf(now) - dayOf(at)) / 86_400_000);
  if (days <= 0) return `à ${hourLabel(iso)}`;
  if (days === 1) return `hier à ${hourLabel(iso)}`;
  return `le ${two(at.getDate())}/${two(at.getMonth() + 1)}`;
}

const KIND_LABEL: Record<TelegramChat['kind'], string> = {
  group: 'Groupe',
  supergroup: 'Supergroupe',
  channel: 'Canal',
};

/** The second line of a group: its kind, then why it is broken or when it last got a message. */
export function chatLine(choice: ChatChoice, now: Date): { text: string; isWarning: boolean } {
  const kind = KIND_LABEL[choice.chat.kind];
  if (choice.bot.state !== 'active')
    return { text: `${kind} · rien ne part tant que le bot n’est pas réparé`, isWarning: true };
  if (!choice.chat.canPost) return { text: `${kind} · le bot n’a pas le droit d’y écrire`, isWarning: true };
  if (choice.chat.lastError !== null) return { text: choice.chat.lastError, isWarning: true };
  if (choice.chat.lastSentAt === null) return { text: `${kind} · rien d’envoyé encore`, isWarning: false };
  return { text: `${kind} · dernier envoi ${whenLabel(choice.chat.lastSentAt, now)}`, isWarning: false };
}

/** The groups a bot left or was banned from: listed under its groups, to remove (REG-28). */
export function goneChats(bot: TelegramBot): TelegramChat[] {
  return bot.chats.filter((chat) => chat.membership !== 'member');
}

/** The second line of a group the bot is out of. */
export function goneLine(chat: TelegramChat): string {
  const kind = KIND_LABEL[chat.kind];
  return chat.membership === 'kicked'
    ? `${kind} · le bot a été exclu de ce groupe`
    : `${kind} · le bot n’est plus dans ce groupe`;
}

/** The line under a bot's name: its @identifier, or what is wrong with it. */
export function botLine(bot: TelegramBot): { text: string; isWarning: boolean } {
  switch (bot.state) {
    case 'refused':
      return { text: 'Telegram refuse ce jeton : remplace-le', isWarning: true };
    case 'conflict':
      return { text: 'Un autre programme lit ce bot', isWarning: true };
    case 'active':
      // Its identifier alone: when Nirvana last asked Telegram for news helps no one (recette du 29/10).
      return { text: `@${bot.username}`, isWarning: false };
  }
}

/** The end of a journal line: delivered, taken over, or why not. */
export function deliveryLabel(delivery: TelegramDelivery): { text: string; isOk: boolean } {
  if (delivery.closedBy !== null) return { text: `Pris en main par ${delivery.closedBy}`, isOk: true };
  switch (delivery.status) {
    case 'sent':
      return { text: 'Livrée', isOk: true };
    case 'pending':
    case 'sending':
      return { text: 'En route', isOk: false };
    case 'failed':
      return { text: 'Non livrée', isOk: false };
    case 'unknown':
      return { text: 'Incertaine', isOk: false };
  }
}

/**
 * The groups a bot sits in when the sheet starts waiting for a new one. A group it left or was banned from is not one
 * of them: added back, it is found again (REG-28).
 */
export function knownChatIds(bot: TelegramBot): ReadonlySet<string> {
  return new Set(bot.chats.filter((chat) => chat.membership === 'member').map((chat) => chat.id));
}

/** The groups a bot entered while the sheet was waiting for one. */
export function newChats(bot: TelegramBot | undefined, knownIds: ReadonlySet<string>): TelegramChat[] {
  return bot?.chats.filter((chat) => chat.membership === 'member' && !knownIds.has(chat.id)) ?? [];
}

/** A bot token, as @BotFather gives it; the server checks it again (`token_shape`). */
export function looksLikeToken(value: string): boolean {
  return /^\d{5,15}:[A-Za-z0-9_-]{30,}$/.test(value.trim());
}

/** Telegram's limit on a bot's identifier. */
const USERNAME_MAX = 32;

/**
 * The identifier @BotFather will accept for a name: starts with a letter, lowercase, underscores, ends in `bot`,
 * 32 characters at most. A name that already ends in « bot » gets no second one.
 */
export function suggestedUsername(name: string): string {
  const words = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const base = words === '' ? 'nirvana' : /^[a-z]/.test(words) ? words : `nirvana_${words}`;
  if (base.endsWith('bot') && base.length >= 5 && base.length <= USERNAME_MAX) return base;
  const stem = base
    .replace(/_?bot$/, '')
    .slice(0, USERNAME_MAX - '_bot'.length)
    .replace(/_+$/, '');
  return `${stem === '' ? 'nirvana' : stem}_bot`;
}
