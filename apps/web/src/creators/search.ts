import { CreatorIdSchema, type CreatorId, type Me } from '@impera/contracts';

/**
 * The tab of Créatrices and the creator picked, in the address (`?onglet=heures&creatrice=<id>`), so that a link, a
 * reload or a step back lands on the same sheet of the same creator (lessons of #217 and of the recette 28/10).
 */
export interface CreatorsSearch {
  readonly onglet?:
    | 'heures'
    | 'acces'
    | 'pourcentage'
    | 'agenda'
    | 'idees'
    | 'demandes'
    | 'scripts'
    | 'sur-mesure'
    | 'contenu'
    | 'telegram'
    | 'alertes'
    | 'liens'
    | 'profil';
  readonly creatrice?: CreatorId;
  /**
   * The vault folder opened in Scripts (`dossier`, its platform id, `racine` for the vault's root): one the last sync no
   * longer lists shows the folders. Kept by nothing else: a tab or a creator changed leaves it out.
   */
  readonly dossier?: string;
}

/** The sheets of a creator, and their slug in the address; the persona has none. */
export type CreatorSheet =
  | 'persona'
  | 'hours'
  | 'access'
  | 'rate'
  | 'agenda'
  | 'ideas'
  | 'requests'
  | 'scripts'
  | 'custom'
  | 'content'
  | 'telegram'
  | 'alerts'
  | 'links'
  | 'profile';

const SLUGS = {
  hours: 'heures',
  access: 'acces',
  rate: 'pourcentage',
  agenda: 'agenda',
  ideas: 'idees',
  requests: 'demandes',
  scripts: 'scripts',
  custom: 'sur-mesure',
  content: 'contenu',
  telegram: 'telegram',
  alerts: 'alertes',
  links: 'liens',
  profile: 'profil',
} as const;
const SHEETS = {
  heures: 'hours',
  acces: 'access',
  pourcentage: 'rate',
  agenda: 'agenda',
  idees: 'ideas',
  demandes: 'requests',
  scripts: 'scripts',
  'sur-mesure': 'custom',
  contenu: 'content',
  telegram: 'telegram',
  alertes: 'alerts',
  liens: 'links',
  profil: 'profile',
} as const;

const ALL_SHEETS: readonly CreatorSheet[] = [
  'persona',
  'hours',
  'access',
  'rate',
  'agenda',
  'ideas',
  'requests',
  'scripts',
  'custom',
  'content',
  'telegram',
  'alerts',
  'links',
  'profile',
];

/**
 * The sheets a member opens: all of them for the owner; her agenda alone for an active manager (CR-05 lot c, Charles,
 * 05/11 17h22: « Ouvrir aux managers », the other sheets stay the owner's) and her ideas of the day (VEI-02, ADR 0060
 * § 5: the owner's and the managers') and what the agency asks of her (MED-09, the same) and her sent scripts (SC-03 c2b, the same) and her other drops (recette créatrice 1, the same) and her redirect links (INS-03, ADR 0121 § 1: the agency sets them); the persona alone for anyone else. The first one is where Créatrices opens.
 */
export function sheetsFor(user: Pick<Me, 'role' | 'teamScope'>): readonly CreatorSheet[] {
  if (user.role === 'owner') return ALL_SHEETS;
  return user.teamScope === 'agency'
    ? ['agenda', 'ideas', 'requests', 'scripts', 'content', 'links']
    : ['persona'];
}

/** Longest folder id read in the address: longer, none. */
const FOLDER_ID_MAX = 200;

/**
 * Anything but a known tab reads as the persona; anything but a creator id, as no creator picked; a folder only on
 * Scripts, as a short non-empty text.
 */
export function parseCreatorsSearch(search: Record<string, unknown>): CreatorsSearch {
  const creator = CreatorIdSchema.safeParse(search['creatrice']);
  const folder = search['dossier'];
  const tab = search['onglet'];
  return {
    ...(tab === SLUGS.hours ||
    tab === SLUGS.access ||
    tab === SLUGS.rate ||
    tab === SLUGS.agenda ||
    tab === SLUGS.ideas ||
    tab === SLUGS.requests ||
    tab === SLUGS.scripts ||
    tab === SLUGS.custom ||
    tab === SLUGS.content ||
    tab === SLUGS.telegram ||
    tab === SLUGS.alerts ||
    tab === SLUGS.links ||
    tab === SLUGS.profile
      ? { onglet: tab }
      : {}),
    ...(creator.success ? { creatrice: creator.data } : {}),
    ...(tab === SLUGS.scripts &&
    typeof folder === 'string' &&
    folder.trim() !== '' &&
    folder.length <= FOLDER_ID_MAX
      ? { dossier: folder }
      : {}),
  };
}

/** The sheet an address opens. */
export const sheetOf = (search: CreatorsSearch): CreatorSheet =>
  search.onglet === undefined ? 'persona' : SHEETS[search.onglet];

/**
 * The address of a sheet: the persona leaves `onglet` out, no creator leaves `creatrice` out, no folder (or another
 * sheet than Scripts) leaves `dossier` out.
 */
export function creatorsSearch(
  tab: CreatorSheet,
  creatorId: CreatorId | null,
  folderId: string | null = null,
): CreatorsSearch {
  return {
    ...(tab === 'persona' ? {} : { onglet: SLUGS[tab] }),
    ...(creatorId === null ? {} : { creatrice: creatorId }),
    ...(tab === 'scripts' && folderId !== null ? { dossier: folderId } : {}),
  };
}
