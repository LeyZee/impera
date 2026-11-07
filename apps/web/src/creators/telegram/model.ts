import {
  CHANNEL_POSTS_PER_DAY_MAX,
  CHANNEL_SLOT_GAP_MINUTES,
  CHANNEL_SLOTS_MAX,
  RedirectLinkIdSchema,
  REDIRECT_LINKS_MAX,
  isRedirectUrl,
  labelHasAddress,
  type ChannelChoice,
  type ChannelSlot,
  type ChannelWarning,
  type RedirectLink,
  type TelegramChannelConfig,
} from '@impera/contracts';

/** Réglages › Créatrices › Canal Telegram (ADR 0080 § 6): what the screen says and checks before the server does. */

export const DAY_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] as const;
export const DAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;
const NBSP = ' ';

/** What keeps her posts from going out, in amber, with what to do. */
export const WARNING_TEXT: Readonly<Record<ChannelWarning, string>> = {
  no_bot: 'Aucun bot Telegram n’est branché : crée-le dans Réglages › Telegram.',
  no_channel: 'Aucun canal choisi : ajoute le bot comme administrateur de son canal, puis choisis-le ici.',
  channel_gone: 'Le bot n’est plus dans son canal : remets-le administrateur.',
  bot_cannot_post:
    'Le bot est dans son canal mais ne peut pas publier : donne-lui le droit « Publier des messages ».',
  no_link: 'Aucun lien du canal : sans lui, aucun post ne part.',
  no_slot: 'Aucun créneau allumé : aucun post ne part.',
};

/** « 19 h », « 19 h 30 ». */
export const clockWords = (minute: number): string => {
  const m = minute % 60;
  return `${String(Math.floor(minute / 60))}${NBSP}h${m === 0 ? '' : `${NBSP}${String(m).padStart(2, '0')}`}`;
};

/** « tous les jours », « en semaine », « le week-end », or the days by name. */
export function daysWords(days: readonly number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  const key = sorted.join(',');
  if (key === '1,2,3,4,5,6,7') return 'tous les jours';
  if (key === '1,2,3,4,5') return 'en semaine';
  if (key === '6,7') return 'le week-end';
  const names = sorted.map((day) => DAY_NAMES[day - 1] ?? '');
  return names.length === 1
    ? `le ${names[0] ?? ''}`
    : `${names.slice(0, -1).join(', ')} et ${names.at(-1) ?? ''}`;
}

/** The number of posts of her busiest day, the switched-on slots only. */
export function postsPerDay(slots: readonly ChannelSlot[]): number {
  let most = 0;
  for (let day = 1; day <= 7; day += 1) {
    most = Math.max(most, slots.filter((slot) => slot.enabled && slot.days.includes(day)).length);
  }
  return most;
}

/** One sentence of her rhythm, for the head of the screen. */
export function rhythmWords(slots: readonly ChannelSlot[]): string {
  const on = slots.filter((slot) => slot.enabled);
  if (on.length === 0) return 'Aucun post prévu';
  return on.map((slot) => `${clockWords(slot.minute)} ${daysWords(slot.days)}`).join(' · ');
}

const DAY_MINUTES = 1440;
const gapOf = (a: number, b: number): number => {
  const gap = Math.abs(a - b);
  return Math.min(gap, DAY_MINUTES - gap);
};

/**
 * A new slot, every day: 19 h for the first, then the first half hour from three hours after the last one added that
 * stands three hours from every other (round the clock), or that hour when none does. Null when the list is full.
 */
export function nextSlot(slots: readonly ChannelSlot[]): ChannelSlot | null {
  if (slots.length >= CHANNEL_SLOTS_MAX) return null;
  const last = slots.at(-1);
  if (last === undefined) return { minute: 19 * 60, days: [1, 2, 3, 4, 5, 6, 7], enabled: true };
  const start = (last.minute + CHANNEL_SLOT_GAP_MINUTES) % DAY_MINUTES;
  for (let step = 0; step < DAY_MINUTES; step += 30) {
    const minute = (start + step) % DAY_MINUTES;
    if (slots.every((slot) => gapOf(slot.minute, minute) >= CHANNEL_SLOT_GAP_MINUTES)) {
      return { minute, days: [1, 2, 3, 4, 5, 6, 7], enabled: true };
    }
  }
  return { minute: start, days: [1, 2, 3, 4, 5, 6, 7], enabled: true };
}

export const SLOTS_FULL = `${String(CHANNEL_SLOTS_MAX)} créneaux au plus.`;
export const LINKS_FULL = `${String(REDIRECT_LINKS_MAX)} liens au plus.`;
export const TOO_MANY = `${String(CHANNEL_POSTS_PER_DAY_MAX)} posts par jour au plus.`;

export function newLink(): RedirectLink {
  return { id: RedirectLinkIdSchema.parse(crypto.randomUUID()), name: '', url: '', destination: '' };
}

/** What a line of the form says is wrong, by its key (`link:<id>:name`, `link:<id>:url`, `slot:<rank>`, `label`). */
export function issuesOf(config: TelegramChannelConfig): Map<string, string> {
  const issues = new Map<string, string>();
  config.slots.forEach((slot, rank) => {
    if (slot.days.length === 0) issues.set(`slot:${String(rank)}`, 'Choisis au moins un jour.');
  });
  if (postsPerDay(config.slots) > CHANNEL_POSTS_PER_DAY_MAX) issues.set('slots', TOO_MANY);
  const names = new Set<string>();
  for (const link of config.links) {
    const name = link.name.trim().toLocaleLowerCase('fr');
    if (name === '') issues.set(`link:${link.id}:name`, 'Donne-lui un nom.');
    else if (names.has(name)) issues.set(`link:${link.id}:name`, 'Un autre lien porte ce nom.');
    names.add(name);
    if (!isRedirectUrl(link.url.trim())) {
      issues.set(`link:${link.id}:url`, 'Une adresse complète qui commence par https://, sans espace.');
    }
    if (labelHasAddress(link.destination)) {
      issues.set(
        `link:${link.id}:destination`,
        'Dis l’endroit en mots, sans adresse : le lien s’ajoute seul.',
      );
    }
  }
  const label = config.linkLabel.trim();
  if (config.linkForm === 'label' && label === '') issues.set('label', 'Écris le texte du lien.');
  else if (labelHasAddress(label)) issues.set('label', 'Le texte du lien ne contient pas d’adresse.');
  return issues;
}

/** The setting as it is sent: names, addresses and the text of the link trimmed. */
export function trimmed(config: TelegramChannelConfig): TelegramChannelConfig {
  return {
    ...config,
    linkLabel: config.linkLabel.trim(),
    links: config.links.map((link) => ({
      ...link,
      name: link.name.trim(),
      url: link.url.trim(),
      destination: link.destination.trim(),
    })),
  };
}

export const sameConfig = (a: TelegramChannelConfig, b: TelegramChannelConfig): boolean =>
  JSON.stringify(trimmed(a)) === JSON.stringify(trimmed(b));

/** How a channel reads in the list: its title, and why it cannot be chosen when it cannot. */
export function choiceHint(choice: ChannelChoice): string | undefined {
  if (choice.takenByOther) return 'Canal d’une autre créatrice';
  if (choice.routedForAlerts) return 'Reçoit des alertes de l’agence';
  if (choice.membership !== 'member') return 'Le bot n’y est plus';
  if (!choice.canPost) return 'Le bot ne peut pas y publier';
  return undefined;
}

/** How the end of a post will read, as Telegram shows it. */
export function linkPreview(config: TelegramChannelConfig): { text: string; url: string } | null {
  const link = config.links.find((candidate) => candidate.id === config.channelLinkId);
  if (link === undefined) return null;
  return { text: config.linkForm === 'label' ? config.linkLabel.trim() : link.url, url: link.url };
}
