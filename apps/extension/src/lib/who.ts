import type { Me } from '@impera/contracts';

/**
 * Who is signed in, in the popup's words, and where the CRM shortcuts lead for that person: the same places as the
 * CRM's own rail (apps/web/src/shell/nav.ts, ADR 0024), four at most, so a shortcut never opens a screen that refuses.
 */

export type Kind = 'owner' | 'manager' | 'chatter' | 'operator' | 'creator';

export function kindOf(me: Me): Kind {
  if (me.role === 'owner') return 'owner';
  if (me.role === 'creator') return 'creator';
  if (me.teamScope === 'agency') return 'manager';
  if (me.team !== null) return 'chatter';
  return 'operator';
}

const LABELS: Readonly<Record<Kind, string>> = {
  owner: 'Propriétaire',
  manager: 'Manager',
  chatter: 'Chatteur',
  operator: 'Équipe',
  creator: 'Créatrice',
};

export function kindLabel(kind: Kind): string {
  return LABELS[kind];
}

/** Two letters from the name (« Charles Altman » → « CA »), or the e-mail's first letter when there is no name. */
export function initialsOf(me: Pick<Me, 'name' | 'email'>): string {
  const words = me.name
    .trim()
    .split(/\s+/u)
    .filter((word) => word !== '');
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : [words[0] ?? me.email];
  return letters
    .map((word) => Array.from(word ?? '')[0] ?? '')
    .join('')
    .toLocaleUpperCase('fr-FR');
}

/** The first name the greeting uses: the first word of the name, or nothing. */
export function firstNameOf(me: Pick<Me, 'name'>): string {
  return me.name.trim().split(/\s+/u)[0] ?? '';
}

type ShortcutIcon = 'dashboard' | 'today' | 'tracking' | 'team' | 'creators' | 'planning' | 'pay' | 'me';

export interface Shortcut {
  readonly path: string;
  readonly label: string;
  readonly icon: ShortcutIcon;
}

const S = {
  dashboard: { path: '/', label: 'Dashboard', icon: 'dashboard' },
  today: { path: '/aujourdhui', label: 'Aujourd’hui', icon: 'today' },
  tracking: { path: '/suivi', label: 'Suivi', icon: 'tracking' },
  team: { path: '/equipe', label: 'Équipe', icon: 'team' },
  creators: { path: '/creatrices', label: 'Créatrices', icon: 'creators' },
  planning: { path: '/planning', label: 'Planning', icon: 'planning' },
  commissions: { path: '/commissions', label: 'Commissions', icon: 'pay' },
  pay: { path: '/paie', label: 'Paie', icon: 'pay' },
  sales: { path: '/ventes', label: 'Ventes', icon: 'pay' },
  me: { path: '/moi', label: 'Moi', icon: 'me' },
} as const satisfies Record<string, Shortcut>;

const SHORTCUTS: Readonly<Record<Kind, readonly Shortcut[]>> = {
  owner: [S.dashboard, S.tracking, S.team, S.creators],
  manager: [S.dashboard, S.tracking, S.team, S.pay],
  chatter: [S.today, S.tracking, S.planning, S.commissions],
  operator: [S.dashboard, S.tracking, S.creators],
  creator: [S.today, S.sales, S.me],
};

export function shortcutsFor(kind: Kind): readonly Shortcut[] {
  return SHORTCUTS[kind];
}
