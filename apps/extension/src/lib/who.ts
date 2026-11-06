import {
  CRM_RAILS,
  CRM_SECTION_LABELS,
  railKindOf,
  type CrmSection,
  type Me,
  type RailKind,
} from '@impera/contracts';

/**
 * Who is signed in, in the popup's words, and where the CRM shortcuts lead for that person: read in the table of the
 * CRM's menus (`@impera/contracts`, ADR 0066 § 6), four at most and each in that person's menu, so a shortcut never
 * opens a screen that refuses and a screen added to a menu is offered here in the same PR.
 */

export type Kind = RailKind;

export const kindOf = (me: Me): Kind => railKindOf(me);

const LABELS: Readonly<Record<Kind, string>> = {
  owner: 'Propriétaire',
  manager: 'Manager',
  chatter: 'Chatteur',
  operator: 'Opérateur',
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

/** The icon of each section, so that a shortcut added to the table has one; Entraîner and Réglages are no role's shortcut. */
const ICONS: Readonly<Record<CrmSection, ShortcutIcon>> = {
  '/': 'dashboard',
  '/aujourdhui': 'today',
  '/agenda': 'planning',
  '/suivi': 'tracking',
  '/entrainer': 'tracking',
  '/planning': 'planning',
  '/commissions': 'pay',
  '/ventes': 'pay',
  // Contenu is no role's shortcut today (her four stay Aujourd'hui, Agenda, Ventes, Moi).
  '/contenu': 'today',
  '/equipe': 'team',
  '/paie': 'pay',
  '/creatrices': 'creators',
  '/moi': 'me',
  '/reglages': 'me',
};

export function shortcutsFor(kind: Kind): readonly Shortcut[] {
  return CRM_RAILS[kind].shortcuts.map((section) => ({
    path: section,
    label: CRM_SECTION_LABELS[section],
    icon: ICONS[section],
  }));
}
