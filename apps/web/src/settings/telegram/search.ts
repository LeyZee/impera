import type { TelegramTopic } from '@nirvana/contracts';

/**
 * The tabs of Réglages › Telegram, one per kind of message, plus the bots. The keywords are a line of the alerts
 * tab: their words live in the Persona, so the only setting here is the group (REG-14, recette du 29/10).
 */
export type TelegramTab = 'alerts' | 'sales' | 'validations' | 'bots';

const SLUG_OF_TAB = {
  alerts: 'alertes',
  sales: 'ventes',
  validations: 'validations',
  bots: 'bots',
} as const satisfies Record<TelegramTab, string>;
type Slug = (typeof SLUG_OF_TAB)[TelegramTab];

const TAB_OF_SLUG: Readonly<Record<Slug, TelegramTab>> = {
  alertes: 'alerts',
  ventes: 'sales',
  validations: 'validations',
  bots: 'bots',
};

const isSlug = (value: unknown): value is Slug =>
  typeof value === 'string' && Object.hasOwn(TAB_OF_SLUG, value);

/** The tab in the address (`?onglet=ventes`), so that a link from another page or a reload lands on it. */
export interface TelegramSearch {
  readonly onglet?: Slug;
}

/** Anything but a known tab reads as the alerts, the first tab, which the address leaves out. */
export function parseTelegramSearch(search: Record<string, unknown>): TelegramSearch {
  const slug = search['onglet'];
  return isSlug(slug) && slug !== SLUG_OF_TAB.alerts ? { onglet: slug } : {};
}

export const tabOfSearch = (search: TelegramSearch): TelegramTab =>
  search.onglet === undefined ? 'alerts' : TAB_OF_SLUG[search.onglet];

export const searchOfTab = (tab: TelegramTab): TelegramSearch =>
  tab === 'alerts' ? {} : { onglet: SLUG_OF_TAB[tab] };

/** The tab that routes a topic: where « Choisir le groupe » of another page leads. */
export const TAB_OF_TOPIC: Readonly<Record<TelegramTopic, TelegramTab>> = {
  urgent: 'alerts',
  important: 'alerts',
  info: 'alerts',
  custom: 'alerts',
  sale: 'sales',
  keyword: 'alerts',
  validation: 'validations',
};
