import type { Me } from './team';

/**
 * The table of the CRM's menus (ADR 0024, ADR 0066 § 6), shared by the CRM and the extension: every section a menu
 * can hold, the menu of each role and what its phone keeps on its bar, and the shortcuts the popup offers. One table,
 * so that a screen added to a role's menu is offered by the popup in the same PR, and a shortcut never opens a screen
 * that refuses. The server's refusals stay the real barrier; this only keeps everyone on the screens that are theirs.
 */

/** Every section a menu can hold, by its address (French, like the routes). */
export const CRM_SECTIONS = [
  '/',
  '/aujourdhui',
  '/agenda',
  '/suivi',
  '/entrainer',
  '/planning',
  '/commissions',
  '/ventes',
  '/equipe',
  '/paie',
  '/creatrices',
  '/moi',
  '/reglages',
] as const;
export type CrmSection = (typeof CRM_SECTIONS)[number];

/** What a section is called, in the CRM's menu, in a browser tab's title and in the popup. */
export const CRM_SECTION_LABELS: Readonly<Record<CrmSection, string>> = {
  '/': 'Dashboard',
  '/aujourdhui': 'Aujourd’hui',
  '/agenda': 'Agenda',
  '/suivi': 'Suivi',
  '/entrainer': 'Entraîner',
  '/planning': 'Planning',
  '/commissions': 'Commissions',
  '/ventes': 'Ventes',
  '/equipe': 'Équipe',
  '/paie': 'Paie',
  '/creatrices': 'Créatrices',
  '/moi': 'Moi',
  '/reglages': 'Réglages',
};

export type RailFamily = 'chatting' | 'agency';

/**
 * Which menu an account gets. `operator` is today's operator: no team row, so no team tab. `creator` is a creator in
 * her own space (ADR 0042 § 8).
 */
export type RailKind = 'owner' | 'manager' | 'chatter' | 'operator' | 'creator';

export interface RailPlan {
  /** In the order of ADR 0024, each with its family when the menu has families. */
  readonly sections: readonly (readonly [CrmSection, RailFamily | null])[];
  /** Réglages, apart at the foot of the menu. */
  readonly settings: boolean;
  /** What the phone keeps on its bar first when the menu does not fit in five (ADR 0024, column « Téléphone »). */
  readonly phone: readonly CrmSection[];
  /** What the extension's popup offers, four at most, each in this menu (ADR 0066 § 6). */
  readonly shortcuts: readonly CrmSection[];
}

export const CRM_RAILS: Readonly<Record<RailKind, RailPlan>> = {
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
    shortcuts: ['/', '/suivi', '/equipe', '/creatrices'],
  },
  manager: {
    sections: [
      ['/', null],
      ['/suivi', null],
      ['/equipe', null],
      ['/paie', null],
      // Her agenda alone (CR-05 lot c, Charles, 05/11): the other sheets of Créatrices stay the owner's.
      ['/creatrices', null],
      ['/moi', null],
    ],
    settings: false,
    phone: ['/', '/suivi', '/equipe', '/paie'],
    shortcuts: ['/', '/suivi', '/equipe', '/paie'],
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
    shortcuts: ['/aujourdhui', '/suivi', '/planning', '/commissions'],
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
    shortcuts: ['/', '/suivi', '/creatrices'],
  },
  // Contenu (CR-06) joins it with its screen; Agenda holds her tasks and dispos (CR-05); Ventes her fans first, then
  // her earnings and her sales (CR-04); her persona lives in Moi.
  creator: {
    sections: [
      ['/aujourdhui', null],
      ['/agenda', null],
      ['/ventes', null],
      ['/moi', null],
    ],
    settings: false,
    phone: ['/aujourdhui', '/agenda', '/ventes', '/moi'],
    shortcuts: ['/aujourdhui', '/agenda', '/ventes', '/moi'],
  },
};

/** The popup shows four shortcuts at most (ADR 0066 § 6). */
export const POPUP_SHORTCUTS_MAX = 4;

/**
 * The owner gets his menu; a manager gets his while his scope is `agency`; any other team member, a manager on leave
 * included, gets the chatter's, as his scope does. An operator without a team row keeps today's menu; a creator gets
 * her own space's.
 */
export function railKindOf(me: Pick<Me, 'role' | 'teamScope' | 'team'>): RailKind {
  if (me.role === 'owner') return 'owner';
  if (me.role === 'creator') return 'creator';
  if (me.teamScope === 'agency') return 'manager';
  if (me.team !== null) return 'chatter';
  return 'operator';
}
