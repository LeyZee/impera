import { CreatorIdSchema, type CreatorId, type Me } from '@impera/contracts';

/**
 * The tab of Créatrices and the creator picked, in the address (`?onglet=heures&creatrice=<id>`), so that a link, a
 * reload or a step back lands on the same sheet of the same creator (lessons of #217 and of the recette 28/10).
 */
export interface CreatorsSearch {
  readonly onglet?: 'heures' | 'acces' | 'pourcentage' | 'agenda' | 'idees' | 'scripts' | 'profil';
  readonly creatrice?: CreatorId;
}

/** The sheets of a creator, and their slug in the address; the persona has none. */
export type CreatorSheet =
  'persona' | 'hours' | 'access' | 'rate' | 'agenda' | 'ideas' | 'scripts' | 'profile';

const SLUGS = {
  hours: 'heures',
  access: 'acces',
  rate: 'pourcentage',
  agenda: 'agenda',
  ideas: 'idees',
  scripts: 'scripts',
  profile: 'profil',
} as const;
const SHEETS = {
  heures: 'hours',
  acces: 'access',
  pourcentage: 'rate',
  agenda: 'agenda',
  idees: 'ideas',
  scripts: 'scripts',
  profil: 'profile',
} as const;

const ALL_SHEETS: readonly CreatorSheet[] = [
  'persona',
  'hours',
  'access',
  'rate',
  'agenda',
  'ideas',
  'scripts',
  'profile',
];

/**
 * The sheets a member opens: all of them for the owner; her agenda alone for an active manager (CR-05 lot c, Charles,
 * 05/11 17h22: « Ouvrir aux managers », the other sheets stay the owner's) and her ideas of the day (VEI-02, ADR 0060
 * § 5: the owner's and the managers') and her sent scripts (SC-03 c2b, the same); the persona alone for anyone else. The first one is where Créatrices opens.
 */
export function sheetsFor(user: Pick<Me, 'role' | 'teamScope'>): readonly CreatorSheet[] {
  if (user.role === 'owner') return ALL_SHEETS;
  return user.teamScope === 'agency' ? ['agenda', 'ideas', 'scripts'] : ['persona'];
}

/** Anything but a known tab reads as the persona; anything but a creator id, as no creator picked. */
export function parseCreatorsSearch(search: Record<string, unknown>): CreatorsSearch {
  const creator = CreatorIdSchema.safeParse(search['creatrice']);
  const tab = search['onglet'];
  return {
    ...(tab === SLUGS.hours ||
    tab === SLUGS.access ||
    tab === SLUGS.rate ||
    tab === SLUGS.agenda ||
    tab === SLUGS.ideas ||
    tab === SLUGS.scripts ||
    tab === SLUGS.profile
      ? { onglet: tab }
      : {}),
    ...(creator.success ? { creatrice: creator.data } : {}),
  };
}

/** The sheet an address opens. */
export const sheetOf = (search: CreatorsSearch): CreatorSheet =>
  search.onglet === undefined ? 'persona' : SHEETS[search.onglet];

/** The address of a sheet: the persona leaves `onglet` out, no creator leaves `creatrice` out. */
export function creatorsSearch(tab: CreatorSheet, creatorId: CreatorId | null): CreatorsSearch {
  return {
    ...(tab === 'persona' ? {} : { onglet: SLUGS[tab] }),
    ...(creatorId === null ? {} : { creatrice: creatorId }),
  };
}
