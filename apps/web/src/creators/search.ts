import { CreatorIdSchema, type CreatorId } from '@impera/contracts';

/**
 * The tab of Créatrices and the creator picked, in the address (`?onglet=heures&creatrice=<id>`), so that a link, a
 * reload or a step back lands on the same sheet of the same creator (lessons of #217 and of the recette 28/10).
 */
export interface CreatorsSearch {
  readonly onglet?: 'heures' | 'acces' | 'pourcentage';
  readonly creatrice?: CreatorId;
}

/** The sheets of a creator, and their slug in the address; the persona has none. */
export type CreatorSheet = 'persona' | 'hours' | 'access' | 'rate';

const SLUGS = { hours: 'heures', access: 'acces', rate: 'pourcentage' } as const;
const SHEETS = { heures: 'hours', acces: 'access', pourcentage: 'rate' } as const;

/** Anything but a known tab reads as the persona; anything but a creator id, as no creator picked. */
export function parseCreatorsSearch(search: Record<string, unknown>): CreatorsSearch {
  const creator = CreatorIdSchema.safeParse(search['creatrice']);
  const tab = search['onglet'];
  return {
    ...(tab === SLUGS.hours || tab === SLUGS.access || tab === SLUGS.rate ? { onglet: tab } : {}),
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
