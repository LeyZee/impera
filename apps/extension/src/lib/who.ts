import {
  CRM_RAILS,
  CRM_SECTION_LABELS,
  railKindOf,
  type CrmSection,
  type Me,
  type RailKind,
  type TeamMemberStatus,
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

/**
 * Who takes part in the Instagram watch from the extension: the owner alone (ADR 0024, amendement du 16/11, point 2).
 * A creator watches from her PWA; a manager or a chatter keeps the copilot and is never shown the watch.
 */
export const watchesInstagram = (kind: Kind): boolean => kind === 'owner';

export function kindLabel(kind: Kind): string {
  return LABELS[kind];
}

/** The words of a name that hold a letter or a digit: an emoji alone is no name (recette du 16/11, EXT-22). */
function wordsOf(name: string): readonly string[] {
  return name
    .trim()
    .split(/\s+/u)
    .filter((word) => /[\p{L}\p{N}]/u.test(word));
}

/** The first letter or digit of a word (« 🌸Lou » → « L »). */
function letterOf(word: string): string {
  return /[\p{L}\p{N}]/u.exec(word)?.[0] ?? '';
}

/** Two letters from the name (« Charles Altman » → « CA »), or the e-mail's first letter when there is no name. */
export function initialsOf(me: Pick<Me, 'name' | 'email'>): string {
  const words = wordsOf(me.name);
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : [words[0] ?? me.email];
  return letters
    .map((word) => letterOf(word ?? ''))
    .join('')
    .toLocaleUpperCase('fr-FR');
}

/** The first name the greeting uses: the first word of the name that holds a letter, or nothing. */
export function firstNameOf(me: Pick<Me, 'name'>): string {
  return wordsOf(me.name)[0] ?? '';
}

/**
 * A member who is not at work (recette du 16/11, EXT-10): his status in the team, the way the CRM writes it (Équipe,
 * `STATUS_LABELS`), and the card the popup shows in place of the copilot. No shift can be set for him, so the copilot
 * has nothing to open; the server refuses him anyway. Null for an active member, the owner and a creator.
 */
export type Away = Exclude<TeamMemberStatus, 'active'>;

export function awayOf(me: Pick<Me, 'team'>): Away | null {
  const status = me.team?.status ?? 'active';
  return status === 'active' ? null : status;
}

const AWAY_LABELS: Readonly<Record<Away, string>> = {
  on_leave: 'En congé',
  sick: 'Malade',
  travelling: 'En déplacement',
  suspended: 'Suspendu',
  left: 'Parti',
};

const AWAY_TITLES: Readonly<Record<Away, string>> = {
  on_leave: 'Tu es en congé',
  sick: 'Tu es noté malade',
  travelling: 'Tu es en déplacement',
  suspended: 'Ton compte est suspendu',
  left: 'Tu as quitté l’équipe',
};

export function awayLabel(away: Away): string {
  return AWAY_LABELS[away];
}

export function awayTitle(away: Away): string {
  return AWAY_TITLES[away];
}

type ShortcutIcon =
  'dashboard' | 'today' | 'tracking' | 'train' | 'team' | 'creators' | 'planning' | 'pay' | 'me' | 'settings';

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
  '/entrainer': 'train',
  '/planning': 'planning',
  '/commissions': 'pay',
  '/ventes': 'pay',
  // Contenu is no role's shortcut today (her four stay Aujourd'hui, Agenda, Ventes, Moi).
  '/contenu': 'today',
  '/equipe': 'team',
  '/paie': 'pay',
  '/creatrices': 'creators',
  '/moi': 'me',
  '/reglages': 'settings',
};

/** The icon of a section, the CRM menu's own (apps/web/src/shell/nav.ts): Entraîner a target, Réglages a gear. */
export function shortcutIconOf(section: CrmSection): ShortcutIcon {
  return ICONS[section];
}

export function shortcutsFor(kind: Kind): readonly Shortcut[] {
  return CRM_RAILS[kind].shortcuts.map((section) => ({
    path: section,
    label: CRM_SECTION_LABELS[section],
    icon: shortcutIconOf(section),
  }));
}
