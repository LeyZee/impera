import {
  CRM_RAILS,
  CRM_SECTION_LABELS,
  CRM_SECTIONS,
  railKindOf,
  type CrmSection,
  type Me,
  type RailFamily,
  type RailKind,
} from '@impera/contracts';

import type { NavIconName } from './NavIcon';

/**
 * The rail of each role (ADR 0024): who sees which section, in which order, and what the phone keeps on its bar. A
 * pure function of `/v1/me`, so « Voir comme » (EQ-19) only has to hand it another `Me`. The server's refusals stay
 * the real barrier; this only keeps everyone from landing on a screen that is not theirs.
 */

/** Every section a rail can hold, by its address: the table shared with the extension (ADR 0066 § 6). */
export const SECTIONS = CRM_SECTIONS;
export type Section = CrmSection;

/** The sections whose screen exists: a tab appears only then, never empty nor greyed out (ADR 0024). */
export const READY_SECTIONS = [
  '/',
  '/aujourdhui',
  '/agenda',
  '/suivi',
  '/entrainer',
  '/planning',
  '/commissions',
  '/ventes',
  '/contenu',
  '/equipe',
  '/paie',
  '/creatrices',
  '/moi',
  '/reglages',
] as const;
export type ReadySection = (typeof READY_SECTIONS)[number];

export type Family = RailFamily;

export const FAMILY_LABELS: Readonly<Record<Family, string>> = { chatting: 'Chatting', agency: 'Agence' };

export interface NavItem {
  readonly to: ReadySection;
  readonly label: string;
  readonly icon: NavIconName;
  readonly family: Family | null;
}

const ICONS: Readonly<Record<Section, NavIconName>> = {
  '/': 'dashboard',
  '/aujourdhui': 'today',
  '/agenda': 'planning',
  '/suivi': 'tracking',
  '/entrainer': 'train',
  '/planning': 'planning',
  '/commissions': 'pay',
  '/ventes': 'pay',
  '/contenu': 'content',
  '/equipe': 'team',
  '/paie': 'pay',
  '/creatrices': 'creators',
  '/moi': 'me',
  '/reglages': 'settings',
};

const itemOf = (section: Section): { readonly label: string; readonly icon: NavIconName } => ({
  label: CRM_SECTION_LABELS[section],
  icon: ICONS[section],
});

export { railKindOf, type RailKind };

/** The phone shows five places at most: four sections and « Plus » once there are more. */
const PHONE_SLOTS = 5;

/** A rail laid out over any sections, ready or not: the rules alone, so they can be tested ahead of the screens. */
export interface RailLayout {
  readonly sections: readonly (readonly [Section, Family | null])[];
  readonly settings: boolean;
  /** The families that get a heading: those with two tabs or more, so a lone tab is not titled. */
  readonly headed: ReadonlySet<Family>;
  /** On the phone, the sections that go under « Plus »; empty when everything fits on the bar. */
  readonly more: ReadonlySet<Section>;
}

export function layoutRail(kind: RailKind, ready: (section: Section) => boolean): RailLayout {
  const plan = CRM_RAILS[kind];
  const sections = plan.sections.filter(([to]) => ready(to));
  const settings = plan.settings && ready('/reglages');
  const all: Section[] = sections.map(([to]) => to);
  if (settings) all.push('/reglages');

  const counts = new Map<Family, number>();
  for (const [, family] of sections) if (family !== null) counts.set(family, (counts.get(family) ?? 0) + 1);
  const headed = new Set([...counts].filter(([, count]) => count > 1).map(([family]) => family));

  const more = new Set<Section>();
  if (all.length > PHONE_SLOTS) {
    const kept = [
      ...all.filter((to) => plan.phone.includes(to)),
      ...all.filter((to) => !plan.phone.includes(to)),
    ];
    const bar = new Set(kept.slice(0, PHONE_SLOTS - 1));
    for (const to of all) if (!bar.has(to)) more.add(to);
  }
  return { sections, settings, headed, more };
}

export function isReady(section: Section): section is ReadySection {
  return READY_SECTIONS.some((ready) => ready === section);
}

export interface Rail {
  readonly kind: RailKind;
  /** The rail's tabs, in order, without Réglages. */
  readonly items: readonly NavItem[];
  readonly settings: NavItem | null;
  /** Where a signed-in account lands, and where a forbidden address sends it back: its first tab. */
  readonly home: ReadySection;
  readonly headed: ReadonlySet<Family>;
  /** On the phone, the tabs under « Plus ». */
  readonly more: ReadonlySet<ReadySection>;
  /**
   * Whether the phone's bar ends with « Plus »: only when tabs overflow, or when the rail has no Moi to hold the
   * appearance, the notifications and the way out (D-03: then they live in Moi › Préférences, never twice).
   */
  readonly phoneMenu: boolean;
}

/** The rail of the signed-in account, with the screens that exist today. */
export function railOf(me: Me): Rail {
  const kind = railKindOf(me);
  const layout = layoutRail(kind, isReady);
  const item = (to: ReadySection, family: Family | null): NavItem => ({
    to,
    family,
    ...itemOf(to),
  });
  const items: NavItem[] = [];
  for (const [to, family] of layout.sections) if (isReady(to)) items.push(item(to, family));
  const settings = layout.settings ? item('/reglages', null) : null;
  return {
    kind,
    items,
    settings,
    home: items[0]?.to ?? '/suivi',
    headed: layout.headed,
    more: new Set([...layout.more].filter(isReady)),
    phoneMenu: layout.more.size > 0 || !items.some((one) => one.to === '/moi'),
  };
}

/** The section an address belongs to, whatever the screen inside it; `null` outside every section. */
export function sectionOf(pathname: string): Section | null {
  const first = `/${pathname.split('/')[1] ?? ''}`;
  return SECTIONS.find((section) => section === first) ?? null;
}

/** What a section is called, in the rail and in the tab's title. */
export function sectionLabel(section: Section): string {
  return CRM_SECTION_LABELS[section];
}

/**
 * The screens inside a section, by address: the names of their sub-tabs, and of the browser tab's title, which says
 * « Rapports · Équipe » so that Équipe › Rapports and Équipe › Planning read apart (NAV-12).
 */
const SCREENS = {
  '/creatrices/structures': 'Structures',
  '/suivi': 'Conversations',
  '/suivi/alertes': 'Historique des alertes',
  '/equipe/planning': 'Planning',
  '/equipe/rapports': 'Rapports',
  '/equipe/membres': 'Membres',
  '/paie/quinzaine': 'Quinzaine',
  '/paie/releves': 'Historique',
  '/paie/primes-malus': 'Primes et malus',
  '/paie/objectifs': 'Objectifs',
  '/paie/factures': 'Factures',
  '/paie/exports': 'Exports',
  '/commissions/factures': 'Factures',
  '/moi/dossier': 'Dossier',
  '/moi/persona': 'Persona',
  '/moi/factures': 'Factures',
  '/moi/calendrier': 'Calendrier',
  '/moi/securite': 'Sécurité',
  '/moi/preferences': 'Préférences',
  '/reglages/modeles-ia': 'Modèles IA',
  '/reglages/ventes': 'Ventes',
  '/reglages/alertes': 'Alertes',
  '/reglages/telegram': 'Telegram',
  '/reglages/regles-de-paie': 'Règles de paie',
  '/reglages/facturation': 'Facturation',
  '/reglages/sauvegardes': 'Sauvegardes',
  '/reglages/securite': 'Sécurité',
} as const;
export type ScreenPath = keyof typeof SCREENS;

/**
 * Where an account finds its own sessions and backup codes (SEC-04), from its menu: the owner in Réglages, a manager or
 * a chatter or a creator in Moi, an operator on a page outside the rail.
 */
export const ACCOUNT_SECURITY = '/compte/securite';
export function securityPathOf(me: Me): '/reglages/securite' | '/moi/securite' | typeof ACCOUNT_SECURITY {
  if (me.role === 'owner') return '/reglages/securite';
  return canOpen(railOf(me), '/moi') ? '/moi/securite' : ACCOUNT_SECURITY;
}

/** The name of a screen inside its section, for its sub-tab. */
export const screenLabel = (to: ScreenPath): string => SCREENS[to];

const SCREEN_TITLES: ReadonlyMap<string, string> = new Map(Object.entries(SCREENS));

/** Pages open to every role outside the rail: help and the account's notifications (CR-01), its security (SEC-04). */
const OFF_RAIL_TITLES: ReadonlyMap<string, string> = new Map([
  ['/aide/installer', 'Installer Impera'],
  ['/notifications', 'Notifications'],
  [ACCOUNT_SECURITY, 'Sécurité'],
]);

/** The browser tab's title: the screen, its section, then the app; « Page introuvable » outside every screen. */
export function documentTitle(pathname: string, section: Section | null): string {
  const offRail = OFF_RAIL_TITLES.get(pathname.replace(/\/+$/u, ''));
  if (offRail !== undefined) return `${offRail} · Impera`;
  if (section === null) return 'Page introuvable · Impera';
  const path = pathname.replace(/\/+$/u, '');
  // A section's own page is no screen of its own: « Suivi · Impera », not « Conversations · Suivi ».
  const screen = path === section ? undefined : SCREEN_TITLES.get(path);
  const label = sectionLabel(section);
  return `${screen === undefined ? '' : `${screen} · `}${label} · Impera`;
}

/** Whether the rail holds the section: what the route guard asks before every screen. */
export function canOpen(rail: Rail, section: Section): boolean {
  return [...rail.items, ...(rail.settings === null ? [] : [rail.settings])].some(({ to }) => to === section);
}
