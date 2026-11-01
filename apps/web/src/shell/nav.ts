import type { Me } from '@nirvana/contracts';

import type { NavIconName } from './NavIcon';

/**
 * The rail of each role (ADR 0024): who sees which section, in which order, and what the phone keeps on its bar. A
 * pure function of `/v1/me`, so « Voir comme » (EQ-19) only has to hand it another `Me`. The server's refusals stay
 * the real barrier; this only keeps everyone from landing on a screen that is not theirs.
 */

/** Every section a rail can hold, by its address (French, like the routes). */
export const SECTIONS = [
  '/',
  '/aujourdhui',
  '/suivi',
  '/entrainer',
  '/planning',
  '/commissions',
  '/equipe',
  '/paie',
  '/creatrices',
  '/moi',
  '/reglages',
] as const;
export type Section = (typeof SECTIONS)[number];

/** The sections whose screen exists: a tab appears only then, never empty nor greyed out (ADR 0024). */
export const READY_SECTIONS = [
  '/',
  '/aujourdhui',
  '/suivi',
  '/entrainer',
  '/planning',
  '/commissions',
  '/equipe',
  '/paie',
  '/creatrices',
  '/reglages',
] as const;
export type ReadySection = (typeof READY_SECTIONS)[number];

export type Family = 'chatting' | 'agency';

export const FAMILY_LABELS: Readonly<Record<Family, string>> = { chatting: 'Chatting', agency: 'Agence' };

export interface NavItem {
  readonly to: ReadySection;
  readonly label: string;
  readonly icon: NavIconName;
  readonly family: Family | null;
}

const ITEMS: Readonly<Record<Section, { readonly label: string; readonly icon: NavIconName }>> = {
  '/': { label: 'Dashboard', icon: 'dashboard' },
  '/aujourdhui': { label: 'Aujourd’hui', icon: 'today' },
  '/suivi': { label: 'Suivi', icon: 'tracking' },
  '/entrainer': { label: 'Entraîner', icon: 'train' },
  '/planning': { label: 'Planning', icon: 'planning' },
  '/commissions': { label: 'Commissions', icon: 'pay' },
  '/equipe': { label: 'Équipe', icon: 'team' },
  '/paie': { label: 'Paie', icon: 'pay' },
  '/creatrices': { label: 'Créatrices', icon: 'creators' },
  '/moi': { label: 'Moi', icon: 'me' },
  '/reglages': { label: 'Réglages', icon: 'settings' },
};

/**
 * Which rail an account gets. `operator` is today's operator: no team row, so no team tab. `creator` is a creator in
 * the CRM until her own app (EQ-09): never Suivi, since she never sees a conversation (ADR 0023).
 */
export type RailKind = 'owner' | 'manager' | 'chatter' | 'operator' | 'creator';

interface RailPlan {
  /** In the order of ADR 0024, each with its family when the rail has families. */
  readonly sections: readonly (readonly [Section, Family | null])[];
  /** Réglages, apart at the foot of the rail. */
  readonly settings: boolean;
  /** What the phone keeps on its bar first when the rail does not fit in five (ADR 0024, column « Téléphone »). */
  readonly phone: readonly Section[];
}

const RAILS: Readonly<Record<RailKind, RailPlan>> = {
  owner: {
    sections: [
      ['/', null],
      ['/suivi', 'chatting'],
      ['/entrainer', 'chatting'],
      ['/equipe', 'agency'],
      ['/paie', 'agency'],
      ['/creatrices', 'agency'],
    ],
    settings: true,
    phone: ['/', '/suivi', '/equipe', '/paie'],
  },
  manager: {
    sections: [
      ['/', null],
      ['/suivi', null],
      ['/equipe', null],
      ['/paie', null],
      ['/moi', null],
    ],
    settings: false,
    phone: ['/', '/suivi', '/equipe', '/paie'],
  },
  chatter: {
    sections: [
      ['/aujourdhui', null],
      ['/suivi', null],
      ['/planning', null],
      ['/commissions', null],
      ['/moi', null],
    ],
    settings: false,
    phone: ['/aujourdhui', '/suivi', '/planning', '/commissions'],
  },
  // No Entraîner for an operator nor a creator: the playground is the owner's alone on the server
  // (`requireRole('owner')`), and a tab never leads to a screen that can only refuse. Nor Réglages: every page of it
  // is the owner's, and the appearance lives in the account's menu (NAV-03, NAV-18).
  operator: {
    sections: [
      ['/', null],
      ['/suivi', 'chatting'],
      ['/creatrices', 'agency'],
    ],
    settings: false,
    phone: ['/', '/suivi', '/creatrices'],
  },
  creator: {
    sections: [
      ['/', null],
      ['/creatrices', 'agency'],
    ],
    settings: false,
    phone: ['/', '/creatrices'],
  },
};

/**
 * The owner gets his rail; a manager gets his while his scope is `agency`; any other team member, a manager on leave
 * included, gets the chatter's, as his scope does. An operator without a team row keeps today's rail; a creator, until
 * her own app (EQ-09), keeps it without Suivi.
 */
export function railKindOf(me: Me): RailKind {
  if (me.role === 'owner') return 'owner';
  if (me.role === 'creator') return 'creator';
  if (me.teamScope === 'agency') return 'manager';
  if (me.team !== null) return 'chatter';
  return 'operator';
}

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
  const plan = RAILS[kind];
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
}

/** A creator's Créatrices is her own persona alone: her tab says so (NAV-18). */
function labelOf(kind: RailKind, section: Section): string {
  return kind === 'creator' && section === '/creatrices' ? 'Persona' : ITEMS[section].label;
}

/** The rail of the signed-in account, with the screens that exist today. */
export function railOf(me: Me): Rail {
  const kind = railKindOf(me);
  const layout = layoutRail(kind, isReady);
  const item = (to: ReadySection, family: Family | null): NavItem => ({
    to,
    family,
    ...ITEMS[to],
    label: labelOf(kind, to),
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
  };
}

/** The section an address belongs to, whatever the screen inside it; `null` outside every section. */
export function sectionOf(pathname: string): Section | null {
  const first = `/${pathname.split('/')[1] ?? ''}`;
  return SECTIONS.find((section) => section === first) ?? null;
}

/** What a section is called, in the rail and in the tab's title: as the account's own rail names it. */
export function sectionLabel(section: Section, kind?: RailKind): string {
  return kind === undefined ? ITEMS[section].label : labelOf(kind, section);
}

/**
 * The screens inside a section, by address: the names of their sub-tabs, and of the browser tab's title, which says
 * « Rapports · Équipe » so that Équipe › Rapports and Équipe › Planning read apart (NAV-12).
 */
const SCREENS = {
  '/suivi': 'Conversations',
  '/suivi/alertes': 'Historique des alertes',
  '/equipe/planning': 'Planning',
  '/equipe/rapports': 'Rapports',
  '/equipe/membres': 'Membres',
  '/paie/quinzaine': 'Quinzaine',
  '/paie/releves': 'Historique',
  '/paie/primes-malus': 'Primes et malus',
  '/paie/objectifs': 'Objectifs',
  '/reglages/modeles-ia': 'Modèles IA',
  '/reglages/alertes': 'Alertes',
  '/reglages/telegram': 'Telegram',
  '/reglages/regles-de-paie': 'Règles de paie',
  '/reglages/sauvegardes': 'Sauvegardes',
} as const;
export type ScreenPath = keyof typeof SCREENS;

/** The name of a screen inside its section, for its sub-tab. */
export const screenLabel = (to: ScreenPath): string => SCREENS[to];

const SCREEN_TITLES: ReadonlyMap<string, string> = new Map(Object.entries(SCREENS));

/** The browser tab's title: the screen, its section, then the app; « Page introuvable » outside every screen. */
export function documentTitle(pathname: string, section: Section | null, kind: RailKind): string {
  if (section === null) return 'Page introuvable · Nirvana';
  const path = pathname.replace(/\/+$/u, '');
  // A section's own page is no screen of its own: « Suivi · Nirvana », not « Conversations · Suivi ».
  const screen = path === section ? undefined : SCREEN_TITLES.get(path);
  const label = sectionLabel(section, kind);
  return `${screen === undefined ? '' : `${screen} · `}${label} · Nirvana`;
}

/** Whether the rail holds the section: what the route guard asks before every screen. */
export function canOpen(rail: Rail, section: Section): boolean {
  return [...rail.items, ...(rail.settings === null ? [] : [rail.settings])].some(({ to }) => to === section);
}
